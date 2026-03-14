import "@/lib/server-runtime";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { leads, postStats, projectLeadInsights, projectLeads } from "@/db/schema";
import { generateLeadReasoning } from "@/lib/openai";
import type { LeadReasoning } from "@/lib/validations/leads";
import { assertProject } from "./projects";

const DEFAULT_REASONING_TOOLS = ["OpenAI", "Tavily", "AgentQL", "TwitterAPI.io"];
const DEFAULT_REASONING_SUBAGENTS = [
  "goal_interpreter",
  "dork_planner",
  "source_researcher",
  "profile_hydrator",
  "candidate_scorer",
  "validator",
  "recovery",
];

function isMissingRelationOrColumnError(error: unknown, name: string): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  return (record.code === "42P01" || record.code === "42703")
    && record.message?.includes(name) === true;
}

function buildContextHash(input: {
  query?: string;
  bio: string;
  location?: string;
  followers: number;
  following?: number | null;
  topTopics?: string[] | null;
  postCount?: number | null;
  avgViews?: string | number | null;
  avgLikes?: string | number | null;
  avgReplies?: string | number | null;
  avgReposts?: string | number | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      query: input.query?.trim() ?? "",
      bio: input.bio.trim(),
      location: input.location?.trim() ?? "",
      followers: input.followers,
      following: input.following ?? 0,
      topTopics: input.topTopics ?? [],
      postCount: input.postCount ?? 0,
      avgViews: input.avgViews ? Number(input.avgViews) : 0,
      avgLikes: input.avgLikes ? Number(input.avgLikes) : 0,
      avgReplies: input.avgReplies ? Number(input.avgReplies) : 0,
      avgReposts: input.avgReposts ? Number(input.avgReposts) : 0,
    }))
    .digest("hex");
}

type EvidenceEntry = { source: "name" | "handle" | "bio" | "post" | "audience"; snippet: string; whyItAligns: string };

const EVIDENCE_SOURCES = new Set(["name", "handle", "bio", "post", "audience"]);

function parseEvidence(raw: unknown): EvidenceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is EvidenceEntry =>
      entry !== null
      && typeof entry === "object"
      && typeof (entry as Record<string, unknown>).source === "string"
      && EVIDENCE_SOURCES.has((entry as Record<string, unknown>).source as string)
      && typeof (entry as Record<string, unknown>).snippet === "string"
      && typeof (entry as Record<string, unknown>).whyItAligns === "string",
  );
}

function rowToLeadReasoning(row: typeof projectLeadInsights.$inferSelect): LeadReasoning {
  return {
    leadId: row.leadId,
    projectId: row.projectId,
    summary: row.summary,
    alignmentBullets: row.alignmentBullets ?? [],
    userGoals: row.userGoals ?? [],
    confidence: row.confidence,
    tools: row.tools ?? [],
    subagents: row.subagents ?? [],
    evidence: parseEvidence(row.evidence),
    generatedAt: row.generatedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getLeadReasoning(input: {
  userId: string;
  projectId: string;
  leadId: string;
}): Promise<LeadReasoning | null> {
  const project = await assertProject(input.userId, input.projectId);
  if (!project.sourceProviders.includes("multiagent")) {
    return null;
  }

  let row:
    | {
      lead: typeof leads.$inferSelect;
      stats: typeof postStats.$inferSelect | null;
      insight: typeof projectLeadInsights.$inferSelect | null;
    }
    | {
      lead: {
        id: string;
        userId: string;
        xUserId: string | null;
        name: string;
        handle: string;
        bio: string;
        platform: string;
        followers: number;
        following: number | null;
        avatarUrl: string | null;
        profileUrl: string | null;
        email: string | null;
        budget: string | null;
        stage: string | null;
        priority: string | null;
        dmComfort: boolean;
        theAsk: string;
        inOutreach: boolean;
        discoverySource: string | null;
        discoveryQuery: string | null;
        createdAt: Date;
        updatedAt: Date;
        location?: string | null;
      };
      stats: typeof postStats.$inferSelect | null;
      insight: null;
    }
    | undefined;

  let canPersistInsight = true;

  try {
    [row] = await db
      .select({
        lead: leads,
        stats: postStats,
        insight: projectLeadInsights,
      })
      .from(projectLeads)
      .innerJoin(leads, and(eq(leads.id, projectLeads.leadId), eq(leads.userId, input.userId)))
      .leftJoin(postStats, eq(postStats.leadId, leads.id))
      .leftJoin(projectLeadInsights, and(
        eq(projectLeadInsights.projectId, projectLeads.projectId),
        eq(projectLeadInsights.leadId, projectLeads.leadId),
      ))
      .where(and(eq(projectLeads.projectId, input.projectId), eq(projectLeads.leadId, input.leadId)))
      .limit(1);
  } catch (error) {
    const missingLocation = isMissingRelationOrColumnError(error, "location");
    const missingInsightsTable = isMissingRelationOrColumnError(error, "project_lead_insights");

    if (!missingLocation && !missingInsightsTable) {
      throw error;
    }

    canPersistInsight = !missingInsightsTable;

    [row] = await db
      .select({
        lead: {
          id: leads.id,
          userId: leads.userId,
          xUserId: leads.xUserId,
          name: leads.name,
          handle: leads.handle,
          bio: leads.bio,
          platform: leads.platform,
          followers: leads.followers,
          following: leads.following,
          avatarUrl: leads.avatarUrl,
          profileUrl: leads.profileUrl,
          email: leads.email,
          budget: leads.budget,
          stage: leads.stage,
          priority: leads.priority,
          dmComfort: leads.dmComfort,
          theAsk: leads.theAsk,
          inOutreach: leads.inOutreach,
          discoverySource: leads.discoverySource,
          discoveryQuery: leads.discoveryQuery,
          createdAt: leads.createdAt,
          updatedAt: leads.updatedAt,
        },
        stats: postStats,
        insight: sql<null>`null`,
      })
      .from(projectLeads)
      .innerJoin(leads, and(eq(leads.id, projectLeads.leadId), eq(leads.userId, input.userId)))
      .leftJoin(postStats, eq(postStats.leadId, leads.id))
      .where(and(eq(projectLeads.projectId, input.projectId), eq(projectLeads.leadId, input.leadId)))
      .limit(1);
  }

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found in this project." });
  }

  const contextHash = buildContextHash({
    query: project.query,
    bio: row.lead.bio,
    location: row.lead.location ?? undefined,
    followers: row.lead.followers,
    following: row.lead.following,
    topTopics: row.stats?.topTopics ?? undefined,
    postCount: row.stats?.postCount,
    avgViews: row.stats?.avgViews,
    avgLikes: row.stats?.avgLikes,
    avgReplies: row.stats?.avgReplies,
    avgReposts: row.stats?.avgReposts,
  });

  if (row.insight && row.insight.contextHash === contextHash) {
    return rowToLeadReasoning(row.insight);
  }

  const generated = await generateLeadReasoning({
    query: project.query?.trim() || project.name,
    lead: {
      name: row.lead.name,
      handle: row.lead.handle,
      bio: row.lead.bio,
      location: row.lead.location ?? undefined,
      followers: row.lead.followers,
      following: row.lead.following ?? undefined,
    },
    stats: row.stats ? {
      postCount: row.stats.postCount,
      avgViews: row.stats.avgViews ? Number(row.stats.avgViews) : undefined,
      avgLikes: row.stats.avgLikes ? Number(row.stats.avgLikes) : undefined,
      avgReplies: row.stats.avgReplies ? Number(row.stats.avgReplies) : undefined,
      avgReposts: row.stats.avgReposts ? Number(row.stats.avgReposts) : undefined,
      topTopics: row.stats.topTopics ?? undefined,
    } : null,
    tools: DEFAULT_REASONING_TOOLS,
    subagents: DEFAULT_REASONING_SUBAGENTS,
  });

  const now = new Date();

  if (!canPersistInsight) {
    return {
      leadId: input.leadId,
      projectId: input.projectId,
      summary: generated.summary,
      alignmentBullets: generated.alignmentBullets,
      userGoals: generated.userGoals,
      confidence: generated.confidence,
      tools: generated.tools,
      subagents: generated.subagents,
      evidence: generated.evidence ?? [],
      generatedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  const [upserted] = await db
    .insert(projectLeadInsights)
    .values({
      projectId: input.projectId,
      leadId: input.leadId,
      contextHash,
      summary: generated.summary,
      alignmentBullets: generated.alignmentBullets,
      userGoals: generated.userGoals,
      confidence: generated.confidence,
      tools: generated.tools,
      subagents: generated.subagents,
      evidence: generated.evidence ?? [],
      generatedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [projectLeadInsights.projectId, projectLeadInsights.leadId],
      set: {
        contextHash,
        summary: generated.summary,
        alignmentBullets: generated.alignmentBullets,
        userGoals: generated.userGoals,
        confidence: generated.confidence,
        tools: generated.tools,
        subagents: generated.subagents,
        evidence: generated.evidence ?? [],
        generatedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return rowToLeadReasoning(upserted);
}
