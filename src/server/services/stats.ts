import "server-only";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { leads, postStats } from "@/db/schema";
import { X_PROVIDER_STATS_TWEET_LIMIT } from "@/lib/constants";
import { extractTopicsAndPriority } from "@/lib/openai";
import { getXDataClient, mapTweetsToMetrics } from "@/lib/x/client";
import type { XDataProvider } from "@/lib/x";
import type { PostStats } from "@/lib/validations/stats";
import { getLeadById, updateLead } from "./leads";

function rowToPostStats(row: typeof postStats.$inferSelect): PostStats {
  return {
    id: row.id,
    leadId: row.leadId,
    fetchedAt: row.fetchedAt.toISOString(),
    postCount: row.postCount,
    avgViews: row.avgViews ? Number(row.avgViews) : undefined,
    avgLikes: row.avgLikes ? Number(row.avgLikes) : undefined,
    avgReplies: row.avgReplies ? Number(row.avgReplies) : undefined,
    avgReposts: row.avgReposts ? Number(row.avgReposts) : undefined,
    topTopics: row.topTopics ?? undefined,
  };
}

export async function getPostStats(userId: string, leadId: string): Promise<PostStats | null> {
  const [row] = await db
    .select()
    .from(postStats)
    .innerJoin(leads, eq(leads.id, postStats.leadId))
    .where(and(eq(postStats.leadId, leadId), eq(leads.userId, userId)))
    .limit(1);

  return row ? rowToPostStats(row.post_stats) : null;
}

export async function upsertPostStats(input: {
  leadId: string;
  postCount: number;
  avgViews?: number;
  avgLikes?: number;
  avgReplies?: number;
  avgReposts?: number;
  topTopics?: string[];
}): Promise<PostStats> {
  const [row] = await db
    .insert(postStats)
    .values({
      leadId: input.leadId,
      postCount: input.postCount,
      avgViews: input.avgViews !== undefined ? String(input.avgViews) : null,
      avgLikes: input.avgLikes !== undefined ? String(input.avgLikes) : null,
      avgReplies: input.avgReplies !== undefined ? String(input.avgReplies) : null,
      avgReposts: input.avgReposts !== undefined ? String(input.avgReposts) : null,
      topTopics: input.topTopics,
    })
    .onConflictDoUpdate({
      target: postStats.leadId,
      set: {
        postCount: input.postCount,
        avgViews: input.avgViews !== undefined ? String(input.avgViews) : null,
        avgLikes: input.avgLikes !== undefined ? String(input.avgLikes) : null,
        avgReplies: input.avgReplies !== undefined ? String(input.avgReplies) : null,
        avgReposts: input.avgReposts !== undefined ? String(input.avgReposts) : null,
        topTopics: input.topTopics,
        fetchedAt: new Date(),
      },
    })
    .returning();

  return rowToPostStats(row);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export async function refreshProfileStats(
  userId: string,
  input: { profileId: string; crmId?: string; niche?: string },
  provider: XDataProvider = "x-api",
): Promise<{ stats: PostStats; priority: "P0" | "P1" }> {
  const client = getXDataClient(provider);
  const profile = await getLeadById(userId, input.profileId);
  if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found." });
  if (!profile.xUserId && !profile.handle) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Lead has no X identifier." });
  }

  const tweets = await client.getUserTweets({
    userId: profile.xUserId,
    username: profile.handle,
    maxResults: X_PROVIDER_STATS_TWEET_LIMIT,
  });
  if (tweets.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "No recent X posts found." });

  const metrics = mapTweetsToMetrics(tweets);
  const ai = await extractTopicsAndPriority(
    input.niche,
    profile.bio,
    metrics.map((t) => t.text).filter(Boolean),
  );

  const stats = await upsertPostStats({
    leadId: input.profileId,
    postCount: metrics.length,
    avgViews: avg(metrics.map((t) => t.viewCount)),
    avgLikes: avg(metrics.map((t) => t.likeCount)),
    avgReplies: avg(metrics.map((t) => t.replyCount)),
    avgReposts: avg(metrics.map((t) => t.repostCount)),
    topTopics: ai.topics,
  });

  if (input.crmId) {
    await updateLead(userId, input.crmId, { priority: ai.priority });
  }

  return { stats, priority: ai.priority };
}
