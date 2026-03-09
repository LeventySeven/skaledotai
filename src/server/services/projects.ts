import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { leads, projectLeads, projects } from "@/db/schema";
import type { Project } from "@/lib/types";

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
