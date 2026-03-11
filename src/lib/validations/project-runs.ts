import { z } from "zod";
import { XDataProviderSchema } from "./x-provider";

export const ProjectRunOperationTypeSchema = z.enum(["search", "network_import", "analysis"]);
export type ProjectRunOperationType = z.infer<typeof ProjectRunOperationTypeSchema>;

export const ProjectRunTraceStatusSchema = z.enum(["success", "warning", "error"]);
export type ProjectRunTraceStatus = z.infer<typeof ProjectRunTraceStatusSchema>;

export const ProjectRunTraceMetricSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
});
export type ProjectRunTraceMetric = z.infer<typeof ProjectRunTraceMetricSchema>;

export const ProjectRunTraceStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  status: ProjectRunTraceStatusSchema,
  provider: XDataProviderSchema.optional(),
  model: z.string().optional(),
  bullets: z.array(z.string()).default([]),
  metrics: z.array(ProjectRunTraceMetricSchema).default([]),
});
export type ProjectRunTraceStep = z.infer<typeof ProjectRunTraceStepSchema>;

export const ProjectRunTraceSchema = z.object({
  title: z.string(),
  summary: z.string(),
  status: ProjectRunTraceStatusSchema,
  operationType: ProjectRunOperationTypeSchema,
  requestedProvider: XDataProviderSchema,
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  steps: z.array(ProjectRunTraceStepSchema),
});
export type ProjectRunTrace = z.infer<typeof ProjectRunTraceSchema>;

export const ProjectRunRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  operationType: ProjectRunOperationTypeSchema,
  requestedProvider: XDataProviderSchema,
  discoveryProvider: XDataProviderSchema,
  lookupProvider: XDataProviderSchema,
  networkProvider: XDataProviderSchema,
  tweetsProvider: XDataProviderSchema,
  query: z.string().optional(),
  seedUsername: z.string().optional(),
  leadCount: z.number(),
  createdAt: z.string(),
  trace: ProjectRunTraceSchema.optional(),
});
export type ProjectRunRecord = z.infer<typeof ProjectRunRecordSchema>;
