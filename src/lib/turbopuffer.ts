import "@/lib/server-runtime";
import Turbopuffer from "@turbopuffer/turbopuffer";

// ── Client singleton ─────────────────────────────────────────────────────────

let client: Turbopuffer | null | undefined;

function getClient(): Turbopuffer | null {
  if (client !== undefined) return client;
  const apiKey = process.env.TURBOPUFFER_API_KEY?.trim();
  if (!apiKey) { client = null; return null; }
  const region = process.env.TURBOPUFFER_REGION?.trim() || "gcp-us-central1";
  client = new Turbopuffer({ apiKey, region });
  return client;
}

export function isTurboPufferConfigured(): boolean {
  return !!process.env.TURBOPUFFER_API_KEY?.trim();
}

// ── Types ────────────────────────────────────────────────────────────────────

export type TurboPufferAttributeValue = string | number | boolean | string[] | null;

export type TurboPufferRow = {
  id: string;
  vector: number[];
  attributes: Record<string, TurboPufferAttributeValue>;
};

export type TurboPufferHit = {
  id: string;
  dist?: number;
  attributes: Record<string, TurboPufferAttributeValue>;
};

// ── Namespace helpers ────────────────────────────────────────────────────────

const NS_PREFIX = process.env.TURBOPUFFER_NAMESPACE_PREFIX ?? "skale";

/**
 * Build a TurboPuffer namespace from a user ID.
 * Sanitized to alphanumeric + hyphens + dots + underscores, max 64 chars.
 */
export function buildNamespace(userId: string): string {
  const sanitized = userId.replace(/[^A-Za-z0-9\-_.]/g, "-").slice(0, 50);
  return `${NS_PREFIX}-${sanitized}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Upsert rows into a TurboPuffer namespace using the official SDK.
 * Uses full document upserts (not patch) per TurboPuffer docs.
 * Schema with full_text_search on search_text is set on first write.
 */
export async function upsertRows(
  namespace: string,
  rows: TurboPufferRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const tpuf = getClient();
  if (!tpuf) throw new Error("TURBOPUFFER_API_KEY is not configured.");

  const ns = tpuf.namespace(namespace);

  await ns.write({
    upsert_rows: rows.map((r) => ({
      id: r.id,
      vector: r.vector,
      ...r.attributes,
    })),
    distance_metric: "cosine_distance",
    schema: {
      search_text: { type: "string", full_text_search: true },
      bio: { type: "string", full_text_search: true },
      tags: "[]string",
      deliverables: "[]string",
      name: "string",
      handle: "string",
      relevancy: "int",
      url: "string",
      email: "string",
      price_cents: "int",
      updated_at: "datetime",
    },
  });
}

/**
 * Hybrid search: run vector ANN + BM25 full-text in one multi-query call,
 * then fuse results client-side with reciprocal rank fusion.
 */
export async function multiQuery(
  namespace: string,
  queryVector: number[],
  queryText: string,
  topK: number,
): Promise<TurboPufferHit[]> {
  const tpuf = getClient();
  if (!tpuf) throw new Error("TURBOPUFFER_API_KEY is not configured.");

  const ns = tpuf.namespace(namespace);

  const response = await ns.multiQuery({
    queries: [
      {
        rank_by: ["vector", "ANN", queryVector],
        top_k: topK,
        include_attributes: true,
      },
      {
        rank_by: ["search_text", "BM25", queryText],
        top_k: topK,
        include_attributes: true,
      },
    ],
  });

  // Client-side reciprocal rank fusion
  const resultSets = response.results.map((r) => r.rows ?? []);
  return reciprocalRankFusion(resultSets, topK);
}

// ── Rank Fusion ──────────────────────────────────────────────────────────────

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion — merges ranked lists from multiple queries.
 * Score = sum(1 / (k + rank_i)) across all query result lists.
 */
export function reciprocalRankFusion(
  resultSets: Array<Array<{ id: string | number; $dist?: number; [k: string]: unknown }>>,
  topK: number,
): TurboPufferHit[] {
  const scores = new Map<string, { score: number; hit: TurboPufferHit }>();

  for (const results of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const row = results[rank];
      const id = String(row.id);
      const rrfScore = 1 / (RRF_K + rank + 1);

      // Extract attributes (everything except id, vector, $dist)
      const attributes: Record<string, TurboPufferAttributeValue> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key === "id" || key === "vector" || key === "$dist") continue;
        attributes[key] = value as TurboPufferAttributeValue;
      }

      const existing = scores.get(id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(id, {
          score: rrfScore,
          hit: { id, dist: row.$dist, attributes },
        });
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((entry) => entry.hit);
}
