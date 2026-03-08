import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, leads, postStats, projectLeads, projects } from "@/db/schema";
import type { DiscoverySource, Lead, LeadPatch, PostStats, Project, XProfile } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function rowToLead(row: typeof leads.$inferSelect, projectId?: string, projectName?: string): Lead {
  return {
    id: row.id,
    crmId: row.id,
    projectId,
    projectName,
    xUserId: row.xUserId ?? undefined,
    name: row.name,
    handle: row.handle,
    bio: row.bio,
    platform: row.platform as "twitter",
    followers: row.followers,
    following: row.following ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
    profileUrl: row.profileUrl ?? undefined,
    email: row.email ?? undefined,
    budget: row.budget ? Number(row.budget) : undefined,
    stage: (row.stage as Lead["stage"]) ?? "found",
    priority: (row.priority as Lead["priority"]) ?? "P1",
    dmComfort: row.dmComfort,
    theAsk: row.theAsk,
    inOutreach: row.inOutreach,
    discoverySource: row.discoverySource as DiscoverySource | undefined,
    discoveryQuery: row.discoveryQuery ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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

// ── Projects ─────────────────────────────────────────────────────────────────

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

export async function getProjectById(userId: string, projectId: string): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  return row ? rowToProject(row) : null;
}

export async function createProject(input: {
  userId: string;
  name: string;
  query?: string;
  seedUsername?: string;
}): Promise<Project> {
  const [row] = await db
    .insert(projects)
    .values({
      userId: input.userId,
      name: input.name,
      query: input.query,
      seedUsername: input.seedUsername,
    })
    .returning();

  return rowToProject(row);
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export async function listLeads(input: {
  userId: string;
  page: number;
  pageSize: number;
  sort: "followers-desc" | "followers-asc" | "name-asc";
  search: string;
  projectId?: string;
  inOutreach?: boolean;
  stage: "all" | "found" | "messaged" | "replied" | "agreed";
}): Promise<{ leads: Lead[]; total: number }> {
  const { userId, page, pageSize, sort, search, projectId, inOutreach, stage } = input;

  const conditions = [eq(leads.userId, userId)];

  if (search) {
    conditions.push(or(ilike(leads.name, `%${search}%`), ilike(leads.handle, `%${search}%`))!);
  }
  if (inOutreach !== undefined) conditions.push(eq(leads.inOutreach, inOutreach));
  if (stage !== "all") conditions.push(eq(leads.stage, stage));

  const orderCol =
    sort === "followers-desc"
      ? desc(leads.followers)
      : sort === "followers-asc"
        ? leads.followers
        : leads.name;

  let rows: Array<{ lead: typeof leads.$inferSelect; resolvedProjectId: string | null }>;

  if (projectId) {
    const result = await db
      .select({ lead: leads, resolvedProjectId: projectLeads.projectId })
      .from(leads)
      .innerJoin(
        projectLeads,
        and(eq(projectLeads.leadId, leads.id), eq(projectLeads.projectId, projectId)),
      )
      .where(and(...conditions))
      .orderBy(orderCol)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    rows = result;
  } else {
    const result = await db
      .select({ lead: leads, resolvedProjectId: projectLeads.projectId })
      .from(leads)
      .leftJoin(projectLeads, eq(projectLeads.leadId, leads.id))
      .where(and(...conditions))
      .orderBy(orderCol)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    rows = result;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(...conditions));

  return {
    leads: rows.map((r) => rowToLead(r.lead, r.resolvedProjectId ?? undefined, undefined)),
    total: count,
  };
}

export async function getProfileById(leadId: string): Promise<Lead | null> {
  const [row] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  return row ? rowToLead(row) : null;
}

export async function updateProjectInfluencer(crmId: string, patch: LeadPatch): Promise<Lead> {
  const [row] = await db
    .update(leads)
    .set({
      ...(patch.stage !== undefined && { stage: patch.stage }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.dmComfort !== undefined && { dmComfort: patch.dmComfort }),
      ...(patch.theAsk !== undefined && { theAsk: patch.theAsk }),
      ...(patch.inOutreach !== undefined && { inOutreach: patch.inOutreach }),
      ...(patch.email !== undefined && { email: patch.email }),
      ...(patch.budget !== undefined && {
        budget: patch.budget !== null ? String(patch.budget) : null,
      }),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, crmId))
    .returning();

  return rowToLead(row);
}

export async function deleteProjectInfluencer(crmId: string): Promise<void> {
  // Remove from all projects first, then delete the lead
  await db.delete(projectLeads).where(eq(projectLeads.leadId, crmId));
  await db.delete(leads).where(eq(leads.id, crmId));
}

export async function addProfilesToProject(input: {
  userId: string;
  projectId: string;
  profiles: Array<XProfile & { source?: string }>;
  discoverySource: DiscoverySource;
  discoveryQuery: string;
  sourceMetadata?: Record<string, unknown>;
}): Promise<Lead[]> {
  if (input.profiles.length === 0) return [];

  const result: Lead[] = [];

  for (const profile of input.profiles) {
    // Upsert lead
    const [lead] = await db
      .insert(leads)
      .values({
        userId: input.userId,
        xUserId: profile.xUserId,
        name: profile.displayName,
        handle: profile.username,
        bio: profile.bio,
        platform: "twitter",
        followers: profile.followersCount,
        following: profile.followingCount,
        avatarUrl: profile.avatarUrl,
        profileUrl: profile.profileUrl,
        discoverySource: input.discoverySource,
        discoveryQuery: input.discoveryQuery,
      })
      .onConflictDoUpdate({
        target: [leads.userId, leads.handle, leads.platform],
        set: {
          name: profile.displayName,
          bio: profile.bio,
          followers: profile.followersCount,
          following: profile.followingCount,
          avatarUrl: profile.avatarUrl,
          profileUrl: profile.profileUrl,
          xUserId: profile.xUserId,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Link to project (ignore conflict if already linked)
    await db
      .insert(projectLeads)
      .values({ projectId: input.projectId, leadId: lead.id })
      .onConflictDoNothing();

    result.push(rowToLead(lead, input.projectId));
  }

  return result;
}

export async function listOutreachQueue(userId: string): Promise<Lead[]> {
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.userId, userId), eq(leads.inOutreach, true)))
    .orderBy(desc(leads.followers));

  return rows.map((r) => rowToLead(r));
}

export async function queueProjectInfluencers(projectId: string): Promise<number> {
  const projectLeadRows = await db
    .select({ leadId: projectLeads.leadId })
    .from(projectLeads)
    .where(eq(projectLeads.projectId, projectId));

  if (projectLeadRows.length === 0) return 0;

  const leadIds = projectLeadRows.map((r) => r.leadId);
  const result = await db
    .update(leads)
    .set({ inOutreach: true, updatedAt: new Date() })
    .where(and(eq(leads.inOutreach, false), sql`${leads.id} = ANY(${sql.raw(`ARRAY['${leadIds.join("','")}'::uuid]`)})`))
    .returning({ id: leads.id });

  return result.length;
}

// Stub — email enrichment requires an external provider
export async function enrichProjectInfluencerEmails(crmIds: string[]): Promise<number> {
  return 0;
}

// Stub — email scanning requires an external provider
export async function scanProjectEmails(projectId: string): Promise<number> {
  return 0;
}

// ── Post Stats ────────────────────────────────────────────────────────────────

export async function getPostStats(leadId: string): Promise<PostStats | null> {
  const [row] = await db
    .select()
    .from(postStats)
    .where(eq(postStats.leadId, leadId))
    .limit(1);

  if (!row) return null;

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

export async function upsertPostStats(input: {
  profileId: string;
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
      leadId: input.profileId,
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

// ── API Keys ──────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "crypto";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function listApiKeys(userId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsed: apiKeys.lastUsed,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function createApiKey(userId: string, name: string) {
  const raw = `sk_${randomBytes(24).toString("hex")}`;
  const prefix = raw.slice(0, 10);
  const keyHash = hashKey(raw);

  await db.insert(apiKeys).values({ userId, name, keyHash, prefix });

  // Return the raw key once — it won't be retrievable again
  return { key: raw, prefix, name };
}

export async function deleteApiKey(userId: string, id: string): Promise<void> {
  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
}
