import "@/lib/server-runtime";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { projectRuns, projects } from "@/db/schema";
import type { XDataProvider } from "@/lib/x";
import { XDataProviderSchema } from "@/lib/validations/x-provider";
import { type ProjectRunOperationType } from "@/lib/validations/project-runs";

function normalizeRunKeyPart(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function buildProjectRunRequestKey(input: {
  projectId: string;
  operationType: ProjectRunOperationType;
  requestedProvider: XDataProvider;
  query?: string;
  seedUsername?: string;
}): string {
  return [
    input.projectId,
    input.operationType,
    input.requestedProvider,
    normalizeRunKeyPart(input.query),
    normalizeRunKeyPart(input.seedUsername?.replace(/^@/, "")),
  ].join("::");
}

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
  minFollowers?: number;
  targetLeadCount?: number;
  leadCount: number;
  traceData?: unknown;
  status?: string;
}): Promise<void> {
  const now = new Date();
  const values = {
    projectId: input.projectId,
    requestKey: buildProjectRunRequestKey(input),
    operationType: input.operationType,
    requestedProvider: input.requestedProvider,
    discoveryProvider: input.discoveryProvider,
    lookupProvider: input.lookupProvider,
    networkProvider: input.networkProvider,
    tweetsProvider: input.tweetsProvider,
    query: input.query,
    seedUsername: input.seedUsername,
    minFollowers: input.minFollowers,
    targetLeadCount: input.targetLeadCount,
    leadCount: input.leadCount,
    traceData: input.traceData ?? null,
    status: input.status ?? "completed",
    createdAt: now,
  };

  await db
    .insert(projectRuns)
    .values(values)
    .onConflictDoUpdate({
      target: projectRuns.requestKey,
      set: {
        operationType: values.operationType,
        requestedProvider: values.requestedProvider,
        discoveryProvider: values.discoveryProvider,
        lookupProvider: values.lookupProvider,
        networkProvider: values.networkProvider,
        tweetsProvider: values.tweetsProvider,
        query: values.query,
        seedUsername: values.seedUsername,
        minFollowers: values.minFollowers,
        targetLeadCount: values.targetLeadCount,
        leadCount: values.leadCount,
        traceData: values.traceData,
        status: values.status,
        createdAt: now,
      },
    });
}

export async function getProjectRunTrace(
  projectId: string,
): Promise<{ traceData: unknown; status: string } | null> {
  const [row] = await db
    .select({
      traceData: projectRuns.traceData,
      status: projectRuns.status,
    })
    .from(projectRuns)
    .where(eq(projectRuns.projectId, projectId))
    .orderBy(desc(projectRuns.createdAt))
    .limit(1);

  return row ?? null;
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
      discoveryProvider: projectRuns.discoveryProvider,
      lookupProvider: projectRuns.lookupProvider,
      networkProvider: projectRuns.networkProvider,
      tweetsProvider: projectRuns.tweetsProvider,
    })
    .from(projectRuns)
    .innerJoin(projects, eq(projects.id, projectRuns.projectId))
    .where(and(eq(projects.userId, userId), inArray(projectRuns.projectId, projectIds)));

  const providersByProject = new Map<string, XDataProvider[]>();

  for (const row of rows) {
    const current = providersByProject.get(row.projectId) ?? [];

    for (const provider of [
      row.requestedProvider,
      row.discoveryProvider,
      row.lookupProvider,
      row.networkProvider,
      row.tweetsProvider,
    ]) {
      const parsed = XDataProviderSchema.safeParse(provider);
      if (!parsed.success || current.includes(parsed.data)) continue;
      current.push(parsed.data);
    }

    if (current.length > 0) {
      providersByProject.set(row.projectId, current);
    }
  }

  return providersByProject;
}

export interface LatestRunParams {
  requestedProvider: string;
  minFollowers: number | null;
  targetLeadCount: number | null;
}

export async function getLatestRunParamsByProjectIds(
  userId: string,
  projectIds: string[],
): Promise<Map<string, LatestRunParams>> {
  if (projectIds.length === 0) return new Map();

  const rows = await db
    .select({
      projectId: projectRuns.projectId,
      requestedProvider: projectRuns.requestedProvider,
      minFollowers: projectRuns.minFollowers,
      targetLeadCount: projectRuns.targetLeadCount,
      createdAt: projectRuns.createdAt,
    })
    .from(projectRuns)
    .innerJoin(projects, eq(projects.id, projectRuns.projectId))
    .where(and(eq(projects.userId, userId), inArray(projectRuns.projectId, projectIds)))
    .orderBy(desc(projectRuns.createdAt));

  const result = new Map<string, LatestRunParams>();
  for (const row of rows) {
    if (!result.has(row.projectId)) {
      result.set(row.projectId, {
        requestedProvider: row.requestedProvider,
        minFollowers: row.minFollowers,
        targetLeadCount: row.targetLeadCount,
      });
    }
  }

  return result;
}
