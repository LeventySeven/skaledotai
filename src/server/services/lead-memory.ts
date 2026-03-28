import "@/lib/server-runtime";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { internalLeads, leads } from "@/db/schema";
import type { XProfile } from "@/lib/validations/search";
import type { XLeadCandidate } from "@/lib/x";
import {
  isTurboPufferConfigured,
  buildNamespace,
  getWarmNamespace,
  getColdNamespace,
  upsertRows,
  multiQuery,
  type TurboPufferRow,
  type TurboPufferHit,
  type TurboPufferAttributeValue,
} from "@/lib/turbopuffer";
import OpenAI from "openai";

// ── Constants ────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const HIGH_QUALITY_THRESHOLD = 70;
const MEMORY_SEARCH_TOP_K = 30;

// ── Types ────────────────────────────────────────────────────────────────────

export type LeadMemoryDocument = {
  id: string;
  handle: string;
  name: string;
  bio: string;
  deliverables: string[];
  tags: string[];
  url: string | null;
  email: string | null;
  priceCents: number | null;
  relevancy: string;
  followers: number;
  searchText: string;
  sourceLeadId: string | null;
  updatedAt: string;
};

export type LeadMemoryHit = {
  document: LeadMemoryDocument;
  score: number;
};

// ── OpenAI embeddings ────────────────────────────────────────────────────────

let openaiClient: OpenAI | null | undefined;

function getOpenAI(): OpenAI | null {
  if (openaiClient !== undefined) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  openaiClient = apiKey ? new OpenAI({ apiKey }) : null;
  return openaiClient;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAI();
  if (!openai) {
    // Return zero vector if OpenAI not configured — BM25 will still work
    return new Array(EMBEDDING_DIMENSIONS).fill(0);
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
    });
    return response.data[0].embedding;
  } catch (error) {
    console.warn("[lead-memory][embedding] Failed, using zero vector:", error instanceof Error ? error.message : String(error));
    return new Array(EMBEDDING_DIMENSIONS).fill(0);
  }
}

// ── Search text builder ──────────────────────────────────────────────────────

export function buildLeadMemorySearchText(doc: {
  name: string;
  handle: string;
  bio: string;
  deliverables: string[];
  tags: string[];
}): string {
  return [
    doc.name,
    `@${doc.handle}`,
    doc.bio,
    doc.deliverables.join(", "),
    doc.tags.join(", "),
  ]
    .filter(Boolean)
    .join(" | ");
}

// ── Tag/deliverable extraction ───────────────────────────────────────────────

export function extractTagsFromBio(bio: string, query?: string): string[] {
  const tags: string[] = [];
  const lowerBio = bio.toLowerCase();

  // Extract role-like phrases from bio
  const rolePatterns = [
    /\b(founder|ceo|cto|coo|cmo|vp|director|head of|lead|senior|staff|principal|manager)\b/gi,
    /\b(designer|developer|engineer|marketer|consultant|researcher|writer|analyst|creator|photographer)\b/gi,
    /\b(product|ux|ui|motion|graphic|web|mobile|full.?stack|front.?end|back.?end|devops|data|ml|ai)\b/gi,
  ];

  for (const pattern of rolePatterns) {
    const matches = bio.match(pattern);
    if (matches) {
      tags.push(...matches.map((m) => m.toLowerCase().trim()));
    }
  }

  // Add query terms as tags if they appear in bio
  if (query) {
    const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    for (const term of queryTerms) {
      if (lowerBio.includes(term) && !tags.includes(term)) {
        tags.push(term);
      }
    }
  }

  return [...new Set(tags)].slice(0, 10);
}

// ── Relevancy scoring ────────────────────────────────────────────────────────

export function computeRelevancy(candidate: XLeadCandidate, query: string): number {
  let score = 0;
  const lowerBio = candidate.account.bio.toLowerCase();
  const lowerName = candidate.account.name.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Bio contains query terms
  const queryTerms = lowerQuery.split(/\s+/).filter((t) => t.length > 2);
  const phraseMatch = lowerBio.includes(lowerQuery) || lowerName.includes(lowerQuery);
  if (phraseMatch) score += 50;

  const termMatches = queryTerms.filter((t) => lowerBio.includes(t) || lowerName.includes(t)).length;
  score += Math.min(30, termMatches * 10);

  // Has substantive bio
  if (candidate.account.bio.trim().length >= 30) score += 10;

  // Is a person (not org)
  if (/\bi\s|my\s|founder|building|working/i.test(candidate.account.bio)) score += 10;

  return Math.min(100, score);
}

// ── Core: Upsert leads into memory ──────────────────────────────────────────

export async function upsertLeadMemoryRows(
  userId: string,
  candidates: XLeadCandidate[],
  query: string,
): Promise<{ synced: number; skipped: number }> {
  if (candidates.length === 0) return { synced: 0, skipped: 0 };

  let synced = 0;
  let skipped = 0;

  // Filter to high-quality leads only
  const qualifying = candidates
    .map((c) => ({ candidate: c, relevancy: computeRelevancy(c, query) }))
    .filter((item) => item.relevancy >= HIGH_QUALITY_THRESHOLD);

  if (qualifying.length === 0) {
    return { synced: 0, skipped: candidates.length };
  }

  const now = new Date();

  // 1. Upsert into Postgres (canonical store)
  for (const { candidate, relevancy } of qualifying) {
    const handle = candidate.account.handle.replace(/^@/, "").toLowerCase();
    const bio = candidate.account.bio;
    const tags = extractTagsFromBio(bio, query);

    try {
      await db
        .insert(internalLeads)
        .values({
          userId,
          name: candidate.account.name,
          handle,
          platform: "twitter",
          bio,
          tags,
          relevancy,
          deliverables: [],
          url: candidate.account.profileUrl ?? null,
          updatedAt: now,
          lastSyncedAt: null, // Will be set after TurboPuffer sync
        })
        .onConflictDoUpdate({
          target: [internalLeads.userId, internalLeads.handle, internalLeads.platform],
          set: {
            name: candidate.account.name,
            bio,
            tags,
            relevancy,
            url: candidate.account.profileUrl ?? null,
            updatedAt: now,
          },
        });
      synced++;
    } catch (error) {
      console.warn("[lead-memory][upsert] PG upsert failed:", handle, error instanceof Error ? error.message : String(error));
      skipped++;
    }
  }

  // 2. Mirror to TurboPuffer (non-blocking, failure-tolerant)
  if (isTurboPufferConfigured() && synced > 0) {
    try {
      const namespace = buildNamespace(userId);
      const rows: TurboPufferRow[] = [];

      for (const { candidate, relevancy } of qualifying) {
        const handle = candidate.account.handle.replace(/^@/, "").toLowerCase();
        const bio = candidate.account.bio;
        const tags = extractTagsFromBio(bio, query);
        const searchText = buildLeadMemorySearchText({
          name: candidate.account.name,
          handle,
          bio,
          deliverables: [],
          tags,
        });

        const vector = await generateEmbedding(searchText);

        rows.push({
          id: handle,
          vector,
          attributes: {
            name: candidate.account.name,
            handle,
            bio: bio.slice(0, 1000),
            search_text: searchText.slice(0, 2000),
            tags,
            deliverables: [],
            relevancy,
            url: candidate.account.profileUrl ?? "",
            email: "",
            price_cents: 0,
            updated_at: now.toISOString(),
          },
        });
      }

      await upsertRows(namespace, rows);

      // Mark as synced in Postgres
      for (const row of rows) {
        await db
          .update(internalLeads)
          .set({ lastSyncedAt: now })
          .where(
            and(
              eq(internalLeads.userId, userId),
              eq(internalLeads.handle, row.id),
              eq(internalLeads.platform, "twitter"),
            ),
          );
      }

      console.log("[lead-memory][upsert] success", JSON.stringify({
        userId: userId.slice(0, 8),
        namespace,
        synced: rows.length,
      }));
    } catch (error) {
      console.warn("[lead-memory][upsert] TurboPuffer sync failed (non-fatal):", error instanceof Error ? error.message : String(error));
    }
  }

  return { synced, skipped };
}

// ── Core: Search lead memory ─────────────────────────────────────────────────

export async function searchLeadMemory(
  userId: string,
  query: string,
  options?: { topK?: number; tags?: string[]; minFollowers?: number },
): Promise<LeadMemoryHit[]> {
  if (!isTurboPufferConfigured()) {
    console.log("[lead-memory][lookup] TurboPuffer not configured, skipping");
    return [];
  }

  const topK = options?.topK ?? MEMORY_SEARCH_TOP_K;
  const startMs = Date.now();

  try {
    // Skip embedding for fast BM25-only search — tags + bio + search_text
    // Vector search is optional and slow (adds ~2s for embedding generation)
    const queryOpts = { tags: options?.tags, minFollowers: options?.minFollowers };

    // Search BOTH namespaces in parallel — warm (curated) + cold (bulk scraped)
    const [warmHits, coldHits] = await Promise.all([
      searchNamespaceSafe(getWarmNamespace(), null, query, topK, queryOpts),
      searchNamespaceSafe(getColdNamespace(), null, query, topK, queryOpts),
    ]);

    // Merge: warm leads first (priority), then cold leads that aren't duplicates
    const seenHandles = new Set<string>();
    const allHits: LeadMemoryHit[] = [];

    for (const hit of warmHits) {
      const handle = hit.document.handle.toLowerCase();
      if (seenHandles.has(handle)) continue;
      seenHandles.add(handle);
      allHits.push(hit);
    }

    for (const hit of coldHits) {
      const handle = hit.document.handle.toLowerCase();
      if (seenHandles.has(handle)) continue;
      seenHandles.add(handle);
      allHits.push(hit);
    }

    const latencyMs = Date.now() - startMs;

    console.log("[lead-memory][lookup]", JSON.stringify({
      userId: userId.slice(0, 8),
      query: query.slice(0, 50),
      warmHits: warmHits.length,
      coldHits: coldHits.length,
      totalHits: allHits.length,
      latencyMs,
    }));

    return allHits;
  } catch (error) {
    const latencyMs = Date.now() - startMs;
    console.warn("[lead-memory][lookup] error", JSON.stringify({
      userId: userId.slice(0, 8),
      query: query.slice(0, 50),
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
    }));
    return [];
  }
}

async function searchNamespaceSafe(
  namespace: string,
  queryVector: number[] | null,
  queryText: string,
  topK: number,
  options: { tags?: string[]; minFollowers?: number },
): Promise<LeadMemoryHit[]> {
  try {
    const hits = await multiQuery(namespace, queryVector, queryText, topK, options);
    return hits
      .map((hit) => hitToMemoryResult(hit))
      .filter((h): h is LeadMemoryHit => h !== null);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes("404") || errMsg.includes("not found")) {
      // Namespace doesn't exist yet — not an error
      return [];
    }
    console.warn(`[lead-memory][${namespace}] search failed:`, errMsg);
    return [];
  }
}

// ── Hit mapping ──────────────────────────────────────────────────────────────

function hitToMemoryResult(hit: TurboPufferHit): LeadMemoryHit | null {
  const attrs = hit.attributes;
  if (!attrs.handle) return null;

  return {
    document: {
      id: hit.id,
      handle: String(attrs.handle ?? ""),
      name: String(attrs.name ?? ""),
      bio: String(attrs.bio ?? ""),
      deliverables: Array.isArray(attrs.deliverables) ? attrs.deliverables as string[] : [],
      tags: Array.isArray(attrs.tags) ? attrs.tags as string[] : [],
      url: attrs.url ? String(attrs.url) : null,
      email: attrs.email ? String(attrs.email) : null,
      priceCents: typeof attrs.price_cents === "number" ? attrs.price_cents : null,
      relevancy: String(attrs.relevancy ?? ""),
      followers: typeof attrs.followers === "number" ? attrs.followers : 0,
      searchText: String(attrs.search_text ?? ""),
      sourceLeadId: attrs.source_lead_id ? String(attrs.source_lead_id) : null,
      updatedAt: String(attrs.updated_at ?? ""),
    },
    // RRF fusion already ranked by position, so use a flat score.
    // hit.dist is cosine_distance for vector hits, BM25 score for text hits — not comparable.
    score: 0.5,
  };
}

/**
 * Convert a TurboPuffer memory hit into an XLeadCandidate for pipeline integration.
 */
export function mapMemoryHitToCandidate(hit: LeadMemoryHit, niche: string): XLeadCandidate {
  const doc = hit.document;
  return {
    source: "multiagent",
    niche,
    discoverySource: "profile_search",
    account: {
      handle: doc.handle,
      name: doc.name,
      bio: doc.bio,
      followers: doc.followers ?? 0,
      following: 0,
      profileUrl: doc.url ?? undefined,
      xUserId: doc.handle.toLowerCase(),
    },
    metrics: {
      avgLikes: 0,
      avgReplies: 0,
      avgReposts: 0,
      postsSampleSize: 0,
    },
    posts: [],
  };
}
