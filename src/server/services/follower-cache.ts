import "@/lib/server-runtime";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { followerCache } from "@/db/schema";
import type { XProfile } from "@/lib/validations/search";
import {
  getTwitterApiVerifiedFollowersPage,
  lookupTwitterApiUserByUsername,
} from "@/lib/x/twitterapi";
import { isTurboPufferConfigured } from "@/lib/turbopuffer";
import Turbopuffer from "@turbopuffer/turbopuffer";
import OpenAI from "openai";

// ── Constants ────────────────────────────────────────────────────────────────

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const EMBEDDING_MODEL = "text-embedding-3-small";
const TPUF_BATCH_SIZE = 50;
const MAX_PAGES = 250; // 20 per page × 250 = up to 5000 verified followers

// ── Clients ──────────────────────────────────────────────────────────────────

function getTpuf(): Turbopuffer {
  const apiKey = process.env.TURBOPUFFER_API_KEY?.trim();
  if (!apiKey) throw new Error("TURBOPUFFER_API_KEY is not set.");
  const region = process.env.TURBOPUFFER_REGION?.trim() || "gcp-us-central1";
  return new Turbopuffer({ apiKey, region });
}

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return apiKey ? new OpenAI({ apiKey }) : null;
}

function followersNamespace(seedHandle: string) {
  return getTpuf().namespace(`followers-${seedHandle.toLowerCase()}`);
}

// ── Embedding ────────────────────────────────────────────────────────────────

async function embedBatch(texts: string[]): Promise<number[][]> {
  const openai = getOpenAI();
  if (!openai || texts.length === 0) {
    return texts.map(() => new Array(1536).fill(0));
  }
  try {
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts.map((t) => t.slice(0, 8000)),
    });
    return res.data.map((d) => d.embedding);
  } catch {
    return texts.map(() => new Array(1536).fill(0));
  }
}

// ── Cache Status ─────────────────────────────────────────────────────────────

export type FollowerCacheStatus =
  | { state: "ready"; totalFetched: number }
  | { state: "stale"; totalFetched: number }
  | { state: "fetching"; totalFetched: number }
  | { state: "missing" }
  | { state: "failed"; error: string };

export async function getFollowerCacheStatus(seedHandle: string): Promise<FollowerCacheStatus> {
  const handle = seedHandle.replace(/^@/, "").toLowerCase();
  const record = await db.query.followerCache.findFirst({
    where: eq(followerCache.seedHandle, handle),
  });

  if (!record) return { state: "missing" };
  if (record.status === "failed") return { state: "failed", error: record.errorMessage ?? "Unknown error" };
  if (record.status === "fetching") return { state: "fetching", totalFetched: record.totalFetched };

  const isExpired = record.expiresAt ? record.expiresAt < new Date() : true;
  if (record.status === "ready" && isExpired) return { state: "stale", totalFetched: record.totalFetched };
  if (record.status === "ready") return { state: "ready", totalFetched: record.totalFetched };

  return { state: "missing" };
}

// ── Fetch & Cache All Verified Followers ─────────────────────────────────────

export async function fetchAndCacheFollowers(seedHandle: string): Promise<{ total: number }> {
  const handle = seedHandle.replace(/^@/, "").toLowerCase();

  if (!isTurboPufferConfigured()) {
    throw new Error("TurboPuffer is not configured.");
  }

  // Resolve username → userId (needed for verifiedFollowers endpoint)
  const profile = await lookupTwitterApiUserByUsername(handle);
  if (!profile?.xUserId) {
    throw new Error(`Could not resolve @${handle} to a user ID.`);
  }
  const userId = profile.xUserId;

  // Upsert cache record as "fetching"
  await db
    .insert(followerCache)
    .values({
      seedHandle: handle,
      seedUserId: userId,
      status: "fetching",
      totalFetched: 0,
      expiresAt: new Date(Date.now() + TWO_WEEKS_MS),
    })
    .onConflictDoUpdate({
      target: [followerCache.seedHandle],
      set: {
        status: "fetching",
        seedUserId: userId,
        totalFetched: 0,
        errorMessage: null,
        lastUpdatedAt: new Date(),
      },
    });

  const ns = followersNamespace(handle);

  try {
    let cursor: string | undefined;
    let total = 0;
    let batch: XProfile[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await getTwitterApiVerifiedFollowersPage(userId, cursor);
      batch.push(...result.profiles);

      // Flush batch to TurboPuffer when big enough
      if (batch.length >= TPUF_BATCH_SIZE) {
        await upsertFollowerBatch(ns, batch);
        total += batch.length;
        batch = [];

        // Update progress in DB
        await db
          .update(followerCache)
          .set({ totalFetched: total })
          .where(eq(followerCache.seedHandle, handle));
      }

      if (!result.nextToken) break;
      cursor = result.nextToken;

      // Rate limit — twitterapi.io + turbopuffer
      await sleep(1200);
    }

    // Flush remaining
    if (batch.length > 0) {
      await upsertFollowerBatch(ns, batch);
      total += batch.length;
    }

    // Mark as ready
    await db
      .update(followerCache)
      .set({
        status: "ready",
        totalFetched: total,
        lastUpdatedAt: new Date(),
        expiresAt: new Date(Date.now() + TWO_WEEKS_MS),
      })
      .where(eq(followerCache.seedHandle, handle));

    console.log("[follower-cache] done", JSON.stringify({ handle, total }));
    return { total };
  } catch (error) {
    await db
      .update(followerCache)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(followerCache.seedHandle, handle));
    throw error;
  }
}

function buildFollowerSearchText(p: XProfile): string {
  return [
    p.displayName,
    `@${p.username}`,
    p.bio,
    (p as Record<string, unknown>).location ?? "",
    p.profileUrl ?? "",
  ].filter(Boolean).join(" | ");
}

async function upsertFollowerBatch(
  ns: ReturnType<Turbopuffer["namespace"]>,
  profiles: XProfile[],
): Promise<void> {
  const texts = profiles.map(buildFollowerSearchText);
  const vectors = await embedBatch(texts);

  await ns.write({
    upsert_rows: profiles.map((p, i) => ({
      id: p.xUserId ?? p.username.toLowerCase(),
      vector: vectors[i],
      handle: p.username.toLowerCase(),
      name: p.displayName,
      bio: p.bio.slice(0, 1000),
      search_text: texts[i].slice(0, 2000),
      followers: p.followersCount,
      following: p.followingCount,
      verified: p.verified ?? false,
      location: (p as Record<string, unknown>).location ?? "",
      profile_url: p.profileUrl ?? "",
      avatar_url: p.avatarUrl ?? "",
    })),
    distance_metric: "cosine_distance",
    schema: {
      search_text: { type: "string", full_text_search: true },
      bio: { type: "string", full_text_search: true },
      handle: "string",
      name: "string",
      followers: "int",
      following: "int",
      verified: "bool",
      location: "string",
      profile_url: "string",
      avatar_url: "string",
    },
  });
}

// ── Search Within Followers ──────────────────────────────────────────────────

export async function searchWithinFollowers(options: {
  seedHandle: string;
  query: string;
  topK?: number;
  minFollowers?: number;
}): Promise<XProfile[]> {
  const { seedHandle, query, topK = 50, minFollowers = 0 } = options;
  const handle = seedHandle.replace(/^@/, "").toLowerCase();
  const ns = followersNamespace(handle);

  const openai = getOpenAI();
  let queryVector: number[];
  if (openai) {
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query.slice(0, 8000),
    });
    queryVector = res.data[0].embedding;
  } else {
    queryVector = new Array(1536).fill(0);
  }

  // Build filters
  const attrs = ["handle", "name", "bio", "followers", "following", "verified", "location", "profile_url", "avatar_url"];

  const vectorQuery: Record<string, unknown> = {
    rank_by: ["vector", "ANN", queryVector],
    top_k: topK,
    include_attributes: attrs,
  };
  const bm25Query: Record<string, unknown> = {
    rank_by: ["bio", "BM25", query],
    top_k: topK,
    include_attributes: attrs,
  };

  if (minFollowers > 0) {
    const f = ["followers", "Gte", minFollowers];
    vectorQuery.filters = f;
    bm25Query.filters = f;
  }

  const response = await ns.multiQuery({
    queries: [vectorQuery, bm25Query] as Parameters<typeof ns.multiQuery>[0]["queries"],
  });

  // RRF fusion
  const allRows = new Map<string, Record<string, unknown>>();
  const scores = new Map<string, number>();
  const K = 60;

  for (const resultSet of response.results) {
    for (let rank = 0; rank < (resultSet.rows?.length ?? 0); rank++) {
      const row = resultSet.rows![rank];
      const id = String(row.id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (K + rank + 1));
      if (!allRows.has(id)) allRows.set(id, row as Record<string, unknown>);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => allRows.get(id)!)
    .filter(Boolean);

  return ranked.map((row) => ({
    xUserId: String(row.id ?? ""),
    username: String(row.handle ?? ""),
    displayName: String(row.name ?? ""),
    bio: String(row.bio ?? ""),
    followersCount: typeof row.followers === "number" ? row.followers : 0,
    followingCount: typeof row.following === "number" ? row.following : 0,
    verified: row.verified === true,
    profileUrl: row.profile_url ? String(row.profile_url) : undefined,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
  }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
