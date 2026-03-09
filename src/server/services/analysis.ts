import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { leads, postStats, projectLeads, projects } from "@/db/schema";
import { analyzeLeadPoolForProject } from "@/lib/openai";
import { getUserTweets, mapTweetsToMetrics } from "@/lib/x-api";
import type {
  ProjectAnalysisResult,
  ProjectPreviewLead,
} from "@/lib/validations/projects";
import { ANALYSIS_AI_FALLBACK_SIZE, ANALYSIS_SHORTLIST_SIZE } from "@/lib/constants";
import { createProject, rowToPreviewLead } from "./projects";
import { upsertPostStats } from "./stats";

type NormalizedStats = {
  postCount: number;
  avgViews: number;
  avgLikes: number;
  avgReplies: number;
  avgReposts: number;
  topTopics: string[];
};

function normalizeStats(row: typeof postStats.$inferSelect): NormalizedStats {
  return {
    postCount: row.postCount,
    avgViews: row.avgViews ? Number(row.avgViews) : 0,
    avgLikes: row.avgLikes ? Number(row.avgLikes) : 0,
    avgReplies: row.avgReplies ? Number(row.avgReplies) : 0,
    avgReposts: row.avgReposts ? Number(row.avgReposts) : 0,
    topTopics: row.topTopics ?? [],
  };
}

function estimatePricingSignal(input: {
  bio: string;
  followers: number;
  avgLikes: number;
  avgReplies: number;
  postCount: number;
}): string {
  const bio = input.bio.toLowerCase();
  const seniorityKeywords = ["founder", "ceo", "agency", "consult", "fractional", "coach", "advisor"];
  const hasSeniority = seniorityKeywords.some((keyword) => bio.includes(keyword));

  if (input.followers >= 50_000 || input.avgLikes >= 500 || hasSeniority) {
    return "Likely premium pricing power";
  }

  if (input.followers >= 5_000 || input.avgReplies >= 20 || input.postCount >= 20) {
    return "Likely mid-market pricing power";
  }

  return "Likely emerging pricing power";
}

function heuristicScore(input: {
  followers: number;
  postCount: number;
  avgViews: number;
  avgLikes: number;
  avgReplies: number;
  avgReposts: number;
}): number {
  const scale = (value: number) => Math.log10(value + 1);
  return (
    scale(input.followers) * 40
    + scale(input.avgViews) * 14
    + scale(input.avgLikes) * 18
    + scale(input.avgReplies) * 12
    + scale(input.avgReposts) * 8
    + Math.min(input.postCount, 30)
  );
}

export async function analyzeProjectsIntoNewProject(input: {
  userId: string;
  projectIds: string[];
  name?: string;
}): Promise<ProjectAnalysisResult> {
  const uniqueProjectIds = [...new Set(input.projectIds)];
  if (uniqueProjectIds.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select at least one project." });
  }

  const ownedProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, input.userId), inArray(projects.id, uniqueProjectIds)));

  if (ownedProjects.length !== uniqueProjectIds.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "One or more projects were not found." });
  }

  const candidateRows = await db
    .select({
      lead: leads,
      stats: postStats,
    })
    .from(projectLeads)
    .innerJoin(leads, eq(projectLeads.leadId, leads.id))
    .leftJoin(postStats, eq(postStats.leadId, leads.id))
    .innerJoin(projects, eq(projects.id, projectLeads.projectId))
    .where(and(eq(projects.userId, input.userId), inArray(projectLeads.projectId, uniqueProjectIds)))
    .orderBy(desc(leads.followers));

  const deduped = new Map<string, { lead: typeof leads.$inferSelect; stats: NormalizedStats | null }>();
  for (const row of candidateRows) {
    if (!deduped.has(row.lead.id)) {
      deduped.set(row.lead.id, { lead: row.lead, stats: row.stats ? normalizeStats(row.stats) : null });
    }
  }

  const shortlisted = [...deduped.values()]
    .map((row) => {
      const s = row.stats;
      return {
        ...row,
        score: heuristicScore({
          followers: row.lead.followers,
          postCount: s?.postCount ?? 0,
          avgViews: s?.avgViews ?? 0,
          avgLikes: s?.avgLikes ?? 0,
          avgReplies: s?.avgReplies ?? 0,
          avgReposts: s?.avgReposts ?? 0,
        }),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, ANALYSIS_SHORTLIST_SIZE);

  if (shortlisted.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No leads available in the selected projects." });
  }

  const enrichedCandidates: Array<{
    id: string;
    name: string;
    handle: string;
    bio: string;
    followers: number;
    postCount: number;
    avgViews: number;
    avgLikes: number;
    avgReplies: number;
    avgReposts: number;
    topics: string[];
    samplePosts: string[];
    pricingSignal: string;
  }> = [];

  for (const candidate of shortlisted) {
    let stats: NormalizedStats | null = candidate.stats;
    let samplePosts: string[] = [];

    if (!stats && candidate.lead.xUserId) {
      try {
        const tweets = await getUserTweets(candidate.lead.xUserId, 12);
        const metrics = mapTweetsToMetrics(tweets);
        samplePosts = metrics.map((tweet) => tweet.text).filter(Boolean).slice(0, 3);

        if (metrics.length > 0) {
          const fresh = await upsertPostStats({
            leadId: candidate.lead.id,
            postCount: metrics.length,
            avgViews: Math.round(metrics.reduce((sum, tweet) => sum + tweet.viewCount, 0) / metrics.length),
            avgLikes: Math.round(metrics.reduce((sum, tweet) => sum + tweet.likeCount, 0) / metrics.length),
            avgReplies: Math.round(metrics.reduce((sum, tweet) => sum + tweet.replyCount, 0) / metrics.length),
            avgReposts: Math.round(metrics.reduce((sum, tweet) => sum + tweet.repostCount, 0) / metrics.length),
            topTopics: [],
          });
          stats = {
            postCount: fresh.postCount,
            avgViews: fresh.avgViews ?? 0,
            avgLikes: fresh.avgLikes ?? 0,
            avgReplies: fresh.avgReplies ?? 0,
            avgReposts: fresh.avgReposts ?? 0,
            topTopics: fresh.topTopics ?? [],
          };
        }
      } catch {
        samplePosts = [];
      }
    }

    const postCount = stats?.postCount ?? 0;
    const avgViews = stats?.avgViews ?? 0;
    const avgLikes = stats?.avgLikes ?? 0;
    const avgReplies = stats?.avgReplies ?? 0;
    const avgReposts = stats?.avgReposts ?? 0;
    const topics = stats?.topTopics ?? [];

    enrichedCandidates.push({
      id: candidate.lead.id,
      name: candidate.lead.name,
      handle: candidate.lead.handle,
      bio: candidate.lead.bio,
      followers: candidate.lead.followers,
      postCount,
      avgViews,
      avgLikes,
      avgReplies,
      avgReposts,
      topics,
      samplePosts,
      pricingSignal: estimatePricingSignal({
        bio: candidate.lead.bio,
        followers: candidate.lead.followers,
        avgLikes,
        avgReplies,
        postCount,
      }),
    });
  }

  const analysis = await analyzeLeadPoolForProject({
    projectNames: ownedProjects.map((project) => project.name),
    candidates: enrichedCandidates,
  });

  const selectedLeadIds = analysis.selectedLeadIds.length > 0
    ? analysis.selectedLeadIds
    : enrichedCandidates.slice(0, ANALYSIS_AI_FALLBACK_SIZE).map((candidate) => candidate.id);

  const project = await createProject(input.userId, {
    name: input.name?.trim() || `AI analysis • ${ownedProjects.length} projects`,
    query: analysis.summary,
  });

  await db
    .insert(projectLeads)
    .values(selectedLeadIds.map((leadId) => ({
      projectId: project.id,
      leadId,
    })))
    .onConflictDoNothing();

  const previewLeadMap = new Map(
    shortlisted.map((candidate) => [candidate.lead.id, rowToPreviewLead(candidate.lead)]),
  );

  return {
    summary: analysis.summary,
    selectedLeadIds,
    project,
    previewLeads: selectedLeadIds
      .map((leadId) => previewLeadMap.get(leadId))
      .filter((lead): lead is ProjectPreviewLead => Boolean(lead)),
    analyzedProjectIds: uniqueProjectIds,
  };
}
