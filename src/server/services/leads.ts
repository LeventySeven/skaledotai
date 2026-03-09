import "server-only";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { leads, projectLeads } from "@/db/schema";
import type { Lead, LeadPatch, ListLeadsInput } from "@/lib/validations/leads";
import { DiscoverySourceSchema, LeadStageSchema, PlatformSchema, PrioritySchema } from "@/lib/validations/shared";
import type { DiscoverySource } from "@/lib/validations/shared";
import type { XProfile } from "@/lib/validations/search";

export function rowToLead(
  row: typeof leads.$inferSelect,
  projectId?: string,
  projectName?: string,
): Lead {
  return {
    id: row.id,
    crmId: row.id,
    projectId,
    projectName,
    xUserId: row.xUserId ?? undefined,
    name: row.name,
    handle: row.handle,
    bio: row.bio,
    platform: PlatformSchema.parse(row.platform),
    followers: row.followers,
    following: row.following ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
    profileUrl: row.profileUrl ?? undefined,
    email: row.email ?? undefined,
    budget: row.budget ? Number(row.budget) : undefined,
    stage: row.stage ? LeadStageSchema.parse(row.stage) : "found",
    priority: row.priority ? PrioritySchema.parse(row.priority) : "P1",
    dmComfort: row.dmComfort,
    theAsk: row.theAsk,
    inOutreach: row.inOutreach,
    discoverySource: row.discoverySource ? DiscoverySourceSchema.parse(row.discoverySource) : undefined,
    discoveryQuery: row.discoveryQuery ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listLeads(input: ListLeadsInput & { userId: string }): Promise<{ leads: Lead[]; total: number }> {
  const { userId, page, pageSize, sort, search, projectId, inOutreach, stage } = input;

  const conditions = [eq(leads.userId, userId)];
  if (search) conditions.push(or(ilike(leads.name, `%${search}%`), ilike(leads.handle, `%${search}%`))!);
  if (inOutreach !== undefined) conditions.push(eq(leads.inOutreach, inOutreach));
  if (stage !== "all") conditions.push(eq(leads.stage, stage));

  const orderCol =
    sort === "followers-desc" ? desc(leads.followers)
    : sort === "followers-asc" ? leads.followers
    : leads.name;

  let rows: Array<{ lead: typeof leads.$inferSelect; resolvedProjectId: string | null }>;
  let count: number;

  if (projectId) {
    rows = await db
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

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .innerJoin(
        projectLeads,
        and(eq(projectLeads.leadId, leads.id), eq(projectLeads.projectId, projectId)),
      )
      .where(and(...conditions));

    count = countRow?.count ?? 0;
  } else {
    rows = await db
      .select({ lead: leads, resolvedProjectId: sql<string | null>`null` })
      .from(leads)
      .where(and(...conditions))
      .orderBy(orderCol)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(...conditions));

    count = countRow?.count ?? 0;
  }

  return {
    leads: rows.map((r) => rowToLead(r.lead, r.resolvedProjectId ?? undefined)),
    total: count,
  };
}

export async function getLeadById(userId: string, leadId: string): Promise<Lead | null> {
  const [row] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.userId, userId)))
    .limit(1);
  return row ? rowToLead(row) : null;
}

export async function updateLead(userId: string, crmId: string, patch: LeadPatch): Promise<Lead> {
  const [row] = await db
    .update(leads)
    .set({
      ...(patch.stage !== undefined && { stage: patch.stage }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.dmComfort !== undefined && { dmComfort: patch.dmComfort }),
      ...(patch.theAsk !== undefined && { theAsk: patch.theAsk }),
      ...(patch.inOutreach !== undefined && { inOutreach: patch.inOutreach }),
      ...(patch.email !== undefined && { email: patch.email }),
      ...(patch.budget !== undefined && { budget: patch.budget !== null ? String(patch.budget) : null }),
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, crmId), eq(leads.userId, userId)))
    .returning();

  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return rowToLead(row);
}

export async function updateLeads(userId: string, crmIds: string[], patch: LeadPatch): Promise<number> {
  if (crmIds.length === 0) return 0;

  const updated = await db
    .update(leads)
    .set({
      ...(patch.stage !== undefined && { stage: patch.stage }),
      ...(patch.priority !== undefined && { priority: patch.priority }),
      ...(patch.dmComfort !== undefined && { dmComfort: patch.dmComfort }),
      ...(patch.theAsk !== undefined && { theAsk: patch.theAsk }),
      ...(patch.inOutreach !== undefined && { inOutreach: patch.inOutreach }),
      ...(patch.email !== undefined && { email: patch.email }),
      ...(patch.budget !== undefined && { budget: patch.budget !== null ? String(patch.budget) : null }),
      updatedAt: new Date(),
    })
    .where(and(eq(leads.userId, userId), inArray(leads.id, crmIds)))
    .returning({ id: leads.id });

  return updated.length;
}

export async function deleteLead(userId: string, crmId: string): Promise<void> {
  const deleted = await db
    .delete(leads)
    .where(and(eq(leads.id, crmId), eq(leads.userId, userId)))
    .returning({ id: leads.id });

  if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
}

export async function addProfilesToProject(input: {
  userId: string;
  projectId: string;
  profiles: Array<XProfile & { source?: string }>;
  discoverySource: DiscoverySource;
  discoveryQuery: string;
}): Promise<Lead[]> {
  if (input.profiles.length === 0) return [];

  const values = input.profiles.map((profile) => ({
    userId: input.userId,
    xUserId: profile.xUserId,
    name: profile.displayName,
    handle: profile.username,
    bio: profile.bio,
    platform: "twitter" as const,
    followers: profile.followersCount,
    following: profile.followingCount,
    avatarUrl: profile.avatarUrl,
    profileUrl: profile.profileUrl,
    discoverySource: (profile.source as DiscoverySource | undefined) ?? input.discoverySource,
    discoveryQuery: input.discoveryQuery,
  }));

  const upsertedLeads = await db
    .insert(leads)
    .values(values)
    .onConflictDoUpdate({
      target: [leads.userId, leads.handle, leads.platform],
      set: {
        name: sql`excluded.name`,
        bio: sql`excluded.bio`,
        followers: sql`excluded.followers`,
        following: sql`excluded.following`,
        avatarUrl: sql`excluded.avatar_url`,
        profileUrl: sql`excluded.profile_url`,
        xUserId: sql`excluded.x_user_id`,
        discoverySource: sql`excluded.discovery_source`,
        discoveryQuery: sql`excluded.discovery_query`,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (upsertedLeads.length > 0) {
    await db
      .insert(projectLeads)
      .values(upsertedLeads.map((lead) => ({ projectId: input.projectId, leadId: lead.id })))
      .onConflictDoNothing();
  }

  return upsertedLeads.map((lead) => rowToLead(lead, input.projectId));
}

export async function listOutreachQueue(userId: string): Promise<Lead[]> {
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.userId, userId), eq(leads.inOutreach, true)))
    .orderBy(desc(leads.followers));

  return rows.map((r) => rowToLead(r));
}

// Stubs — require external providers
export async function enrichLeadEmails(_crmIds: string[]): Promise<number> {
  return 0;
}

export async function scanProjectEmails(_projectId: string): Promise<number> {
  return 0;
}
