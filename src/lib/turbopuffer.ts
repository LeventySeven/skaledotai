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

/**
 * Single shared namespace for all leads.
 * TurboPuffer lead memory is a global pool — every user searches the same leads.
 */
export function buildNamespace(_userId?: string): string {
  return process.env.TURBOPUFFER_NAMESPACE ?? "skale-leads";
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
      tags: { type: "[]string", full_text_search: true },
      deliverables: "[]string",
      name: "string",
      handle: "string",
      relevancy: "string",
      url: "string",
      site: "string",
      linkedin_url: "string",
      email: "string",
      price_cents: "int",
      notes: "string",
      platform: "string",
      source_lead_id: "string",
      followers: "int",
      updated_at: "datetime",
    },
  });
}

/**
 * Hybrid search: run vector ANN + BM25 full-text in one multi-query call,
 * then fuse results client-side with reciprocal rank fusion.
 */
const ALL_ATTRIBUTES = ["name", "handle", "bio", "search_text", "tags", "deliverables", "relevancy", "url", "site", "linkedin_url", "email", "price_cents", "notes", "platform", "source_lead_id", "updated_at", "followers"];

// ── Tag generalization ─────────────────────────────────────────────────────

const TAG_GENERALIZATIONS: Record<string, string[]> = {
  designer: ["designers", "design", "creative"],
  developer: ["developers", "dev", "engineering", "engineers"],
  engineer: ["engineers", "engineering", "developers", "tech people"],
  founder: ["founders", "solopreneurs", "operators"],
  marketer: ["marketers", "growth", "marketing"],
  researcher: ["researchers", "research", "data scientists"],
  investor: ["investors", "vc", "angel"],
  creator: ["creators", "creative", "content"],
  writer: ["writers", "content", "journalists"],
  product: ["product people", "product", "pm"],
};

/**
 * Generalize specific query terms into broader tag categories.
 * "product designer" → ["designers", "design", "creative", "product people", "product", "pm"]
 */
export function generalizeToTags(terms: string[]): string[] {
  const tags = new Set<string>();
  for (const term of terms) {
    const lower = term.toLowerCase();
    // Add the term itself
    tags.add(lower);
    // Check each generalization key
    for (const [key, expansions] of Object.entries(TAG_GENERALIZATIONS)) {
      if (lower.includes(key)) {
        for (const tag of expansions) tags.add(tag);
      }
    }
  }
  return [...tags];
}

/**
 * Hybrid search: vector ANN + BM25 on search_text + BM25 on tags + BM25 on bio.
 * Tags are generalized so "product designer" matches the "designers" tag.
 * Results are fused client-side with reciprocal rank fusion.
 */
export async function multiQuery(
  namespace: string,
  queryVector: number[],
  queryText: string,
  topK: number,
  options?: { tags?: string[]; minFollowers?: number },
): Promise<TurboPufferHit[]> {
  const tpuf = getClient();
  if (!tpuf) throw new Error("TURBOPUFFER_API_KEY is not configured.");

  const ns = tpuf.namespace(namespace);

  // Generalize tags: "product designer" → ["designers", "design", "creative", ...]
  const generalizedTags = generalizeToTags(options?.tags ?? [queryText]);
  const tagQuery = generalizedTags.join(" ");

  // Use a high top_k for the tag query to get ALL matching leads
  const tagTopK = Math.max(topK, 200);

  const queries: Array<Record<string, unknown>> = [
    // 1. Vector ANN — semantic similarity
    {
      rank_by: ["vector", "ANN", queryVector],
      top_k: topK,
      include_attributes: ALL_ATTRIBUTES,
    },
    // 2. BM25 on search_text — keyword match on full profile text
    {
      rank_by: ["search_text", "BM25", queryText],
      top_k: topK,
      include_attributes: ALL_ATTRIBUTES,
    },
    // 3. BM25 on tags — niche category match (generalized)
    // High top_k to return ALL leads with matching tags
    {
      rank_by: ["tags", "BM25", tagQuery],
      top_k: tagTopK,
      include_attributes: ALL_ATTRIBUTES,
    },
    // 4. BM25 on bio — direct bio text match
    {
      rank_by: ["bio", "BM25", queryText],
      top_k: topK,
      include_attributes: ALL_ATTRIBUTES,
    },
  ];

  const response = await ns.multiQuery({
    queries: queries as Parameters<typeof ns.multiQuery>[0]["queries"],
  });

  // Separate tag results from the rest — tag matches are ALL included, not just top-k
  const [vectorRows, searchRows, tagRows, bioRows] = response.results.map((r) => r.rows ?? []);

  // RRF fusion on vector + search_text + bio (ranked results)
  const rankedHits = reciprocalRankFusion([vectorRows, searchRows, bioRows], topK);
  const rankedIds = new Set(rankedHits.map((h) => h.id));

  // Add ALL tag-matched leads that weren't already in ranked results
  const tagOnlyHits: TurboPufferHit[] = [];
  for (const row of tagRows) {
    const id = String(row.id);
    if (rankedIds.has(id)) continue;
    const attributes: Record<string, TurboPufferAttributeValue> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "id" || key === "vector" || key === "$dist") continue;
      attributes[key] = value as TurboPufferAttributeValue;
    }
    tagOnlyHits.push({ id, dist: row.$dist, attributes });
  }

  // Merge: ranked results first, then remaining tag matches
  let allHits = [...rankedHits, ...tagOnlyHits];

  // Post-filter by minFollowers if specified
  if (options?.minFollowers && options.minFollowers > 0) {
    const min = options.minFollowers;
    allHits = allHits.filter((hit) => {
      const followers = typeof hit.attributes.followers === "number"
        ? hit.attributes.followers : 0;
      return followers >= min;
    });
  }

  return allHits;
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
