import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { leads, postStats, projectLeads, projects } from "@/db/schema";
import { analyzeLeadPoolForProject } from "@/lib/openai";
import { getUserTweets, mapTweetsToMetrics } from "@/lib/x-api";
import type {
  Project,
  ProjectAnalysisResult,
  ProjectOverview,
  ProjectPreviewLead,
} from "@/lib/types";
import { upsertPostStats } from "./stats";

function rowToProject(row: typeof projects.$inferSelect, leadCount?: number): Project {
  return {
    id: row.id,
    name: row.name,
    query: row.query ?? undefined,
    seedUsername: row.seedUsername ?? undefined,
    createdAt: row.createdAt.toISOString(),
    leadCount,
  };
}

function rowToPreviewLead(row: typeof leads.$inferSelect): ProjectPreviewLead {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    bio: row.bio,
    followers: row.followers,
    priority: row.priority as ProjectPreviewLead["priority"],
    avatarUrl: row.avatarUrl ?? undefined,
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

export async function getProjects(userId: string): Promise<Project[]> {
  const rows = await db
    .select({
      project: projects,
      leadCount: sql<number>`count(${projectLeads.leadId})::int`,
    })
    .from(projects)
    .leftJoin(projectLeads, eq(projects.id, projectLeads.projectId))
    .where(eq(projects.userId, userId))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));

  return rows.map((r) => rowToProject(r.project, r.leadCount));
}

export async function getProjectOverviews(userId: string): Promise<ProjectOverview[]> {
  const baseProjects = await getProjects(userId);
  if (baseProjects.length === 0) return [];

  const projectIds = baseProjects.map((project) => project.id);

  const metricRows = await db
    .select({
      projectId: projectLeads.projectId,
      avgFollowers: sql<number>`coalesce(avg(${leads.followers}), 0)::int`,
      topFollowers: sql<number>`coalesce(max(${leads.followers}), 0)::int`,
      p0LeadCount: sql<number>`count(*) filter (where ${leads.priority} = 'P0')::int`,
    })
    .from(projectLeads)
    .innerJoin(leads, eq(projectLeads.leadId, leads.id))
    .innerJoin(projects, eq(projects.id, projectLeads.projectId))
    .where(and(eq(projects.userId, userId), inArray(projectLeads.projectId, projectIds)))
    .groupBy(projectLeads.projectId);

  const previewRows = await db
    .select({
      projectId: projectLeads.projectId,
      lead: leads,
    })
    .from(projectLeads)
    .innerJoin(leads, eq(projectLeads.leadId, leads.id))
    .innerJoin(projects, eq(projects.id, projectLeads.projectId))
    .where(and(eq(projects.userId, userId), inArray(projectLeads.projectId, projectIds)))
    .orderBy(projectLeads.projectId, desc(leads.followers));

  const metricsByProject = new Map(metricRows.map((row) => [row.projectId, row]));
  const previewByProject = new Map<string, ProjectPreviewLead[]>();

  for (const row of previewRows) {
    const current = previewByProject.get(row.projectId) ?? [];
    if (current.length < 4) {
      current.push(rowToPreviewLead(row.lead));
      previewByProject.set(row.projectId, current);
    }
  }

  return baseProjects.map((project) => {
    const metrics = metricsByProject.get(project.id);
    return {
      ...project,
      leadCount: project.leadCount ?? 0,
      avgFollowers: metrics?.avgFollowers ?? 0,
      topFollowers: metrics?.topFollowers ?? 0,
      p0LeadCount: metrics?.p0LeadCount ?? 0,
      previewLeads: previewByProject.get(project.id) ?? [],
    };
  });
}

export async function getProjectById(userId: string, projectId: string): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  return row ? rowToProject(row) : null;
}

export async function assertProject(userId: string, projectId: string): Promise<Project> {
  const project = await getProjectById(userId, projectId);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  return project;
}

export async function createProject(
  userId: string,
  data: { name: string; query?: string; seedUsername?: string },
): Promise<Project> {
  const [row] = await db
    .insert(projects)
    .values({ userId, ...data })
    .returning();

  return rowToProject(row);
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}

export async function queueProjectInfluencers(userId: string, projectId: string): Promise<number> {
  await assertProject(userId, projectId);

  const projectLeadRows = await db
    .select({ leadId: projectLeads.leadId })
    .from(projectLeads)
    .where(eq(projectLeads.projectId, projectId));

  if (projectLeadRows.length === 0) return 0;

  const leadIds = projectLeadRows.map((r) => r.leadId);
  const result = await db
    .update(leads)
    .set({ inOutreach: true, updatedAt: new Date() })
    .where(
      and(
        eq(leads.userId, userId),
        eq(leads.inOutreach, false),
        sql`${leads.id} = ANY(ARRAY[${sql.join(leadIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
      ),
    )
    .returning({ id: leads.id });

  return result.length;
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

  const deduped = new Map<string, { lead: typeof leads.$inferSelect; stats: typeof postStats.$inferSelect | null }>();
  for (const row of candidateRows) {
    if (!deduped.has(row.lead.id)) {
      deduped.set(row.lead.id, { lead: row.lead, stats: row.stats });
    }
  }

  const shortlisted = [...deduped.values()]
    .map((row) => {
      const stats = row.stats;
      const postCount = stats?.postCount ?? 0;
      const avgViews = stats?.avgViews ? Number(stats.avgViews) : 0;
      const avgLikes = stats?.avgLikes ? Number(stats.avgLikes) : 0;
      const avgReplies = stats?.avgReplies ? Number(stats.avgReplies) : 0;
      const avgReposts = stats?.avgReposts ? Number(stats.avgReposts) : 0;

      return {
        ...row,
        score: heuristicScore({
          followers: row.lead.followers,
          postCount,
          avgViews,
          avgLikes,
          avgReplies,
          avgReposts,
        }),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);

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
    let stats = candidate.stats;
    let samplePosts: string[] = [];

    if (!stats && candidate.lead.xUserId) {
      try {
        const tweets = await getUserTweets(candidate.lead.xUserId, 12);
        const metrics = mapTweetsToMetrics(tweets);
        samplePosts = metrics.map((tweet) => tweet.text).filter(Boolean).slice(0, 3);

        if (metrics.length > 0) {
          stats = {
            ...(await upsertPostStats({
              leadId: candidate.lead.id,
              postCount: metrics.length,
              avgViews: Math.round(metrics.reduce((sum, tweet) => sum + tweet.viewCount, 0) / metrics.length),
              avgLikes: Math.round(metrics.reduce((sum, tweet) => sum + tweet.likeCount, 0) / metrics.length),
              avgReplies: Math.round(metrics.reduce((sum, tweet) => sum + tweet.replyCount, 0) / metrics.length),
              avgReposts: Math.round(metrics.reduce((sum, tweet) => sum + tweet.repostCount, 0) / metrics.length),
              topTopics: [],
            })) as unknown as typeof postStats.$inferSelect,
          };
        }
      } catch {
        samplePosts = [];
      }
    }

    const postCount = stats?.postCount ?? 0;
    const avgViews = stats?.avgViews ? Number(stats.avgViews) : 0;
    const avgLikes = stats?.avgLikes ? Number(stats.avgLikes) : 0;
    const avgReplies = stats?.avgReplies ? Number(stats.avgReplies) : 0;
    const avgReposts = stats?.avgReposts ? Number(stats.avgReposts) : 0;
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
    : enrichedCandidates.slice(0, 8).map((candidate) => candidate.id);

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
