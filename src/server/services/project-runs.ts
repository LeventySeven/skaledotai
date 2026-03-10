import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projectRuns, projects } from "@/db/schema";
import type { XDataProvider } from "@/lib/x";
import { XDataProviderSchema } from "@/lib/validations/x-provider";

export type ProjectRunOperationType = "search" | "network_import" | "analysis";

export async function recordProjectRun(input: {
  projectId: string;
  operationType: ProjectRunOperationType;
  requestedProvider: XDataProvider;
  discoveryProvider: XDataProvider;
  lookupProvider: XDataProvider;
  networkProvider: XDataProvider;
  tweetsProvider: XDataProvider;
  query?: string;
  seedUsername?: string;
  leadCount: number;
}): Promise<void> {
  await db.insert(projectRuns).values({
    projectId: input.projectId,
    operationType: input.operationType,
    requestedProvider: input.requestedProvider,
    discoveryProvider: input.discoveryProvider,
    lookupProvider: input.lookupProvider,
    networkProvider: input.networkProvider,
    tweetsProvider: input.tweetsProvider,
    query: input.query,
    seedUsername: input.seedUsername,
    leadCount: input.leadCount,
  });
}

export async function getProjectSourceProvidersByProjectIds(
  userId: string,
  projectIds: string[],
): Promise<Map<string, XDataProvider[]>> {
  if (projectIds.length === 0) return new Map();

  const rows = await db
    .select({
      projectId: projectRuns.projectId,
      requestedProvider: projectRuns.requestedProvider,
    })
    .from(projectRuns)
    .innerJoin(projects, eq(projects.id, projectRuns.projectId))
    .where(and(eq(projects.userId, userId), inArray(projectRuns.projectId, projectIds)));

  const providersByProject = new Map<string, XDataProvider[]>();

  for (const row of rows) {
    const parsed = XDataProviderSchema.safeParse(row.requestedProvider);
    if (!parsed.success) continue;

    const current = providersByProject.get(row.projectId) ?? [];
    if (!current.includes(parsed.data)) {
      current.push(parsed.data);
      providersByProject.set(row.projectId, current);
    }
  }

  return providersByProject;
}
