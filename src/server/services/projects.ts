import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { leads, projectLeads, projects } from "@/db/schema";
import { PROJECT_PREVIEW_LEAD_COUNT } from "@/lib/constants";
import { PrioritySchema } from "@/lib/validations/shared";
import type {
  Project,
  ProjectOverview,
  ProjectPreviewLead,
} from "@/lib/validations/projects";

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

export function rowToPreviewLead(row: typeof leads.$inferSelect): ProjectPreviewLead {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    bio: row.bio,
    followers: row.followers,
    priority: PrioritySchema.parse(row.priority),
    avatarUrl: row.avatarUrl ?? undefined,
  };
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
    if (current.length < PROJECT_PREVIEW_LEAD_COUNT) {
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
        inArray(leads.id, leadIds),
      ),
    )
    .returning({ id: leads.id });

  return result.length;
}
