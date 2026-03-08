import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { postStats } from "@/db/schema";
import type { PostStats } from "@/lib/types";

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

export async function getPostStats(leadId: string): Promise<PostStats | null> {
  const [row] = await db
    .select()
    .from(postStats)
    .where(eq(postStats.leadId, leadId))
    .limit(1);

  return row ? rowToPostStats(row) : null;
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
