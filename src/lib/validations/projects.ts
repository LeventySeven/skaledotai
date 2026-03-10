import { z } from "zod";
import { PrioritySchema } from "./shared";
import { XDataProviderSchema } from "./x-provider";

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string().optional(),
  seedUsername: z.string().optional(),
  createdAt: z.string(),
  leadCount: z.number().optional(),
  sourceProviders: z.array(XDataProviderSchema).default([]),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectPreviewLeadSchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  bio: z.string(),
  followers: z.number(),
  priority: PrioritySchema,
  avatarUrl: z.string().optional(),
});
export type ProjectPreviewLead = z.infer<typeof ProjectPreviewLeadSchema>;

export const ProjectOverviewSchema = ProjectSchema.extend({
  leadCount: z.number(),
  avgFollowers: z.number(),
  topFollowers: z.number(),
  p0LeadCount: z.number(),
  previewLeads: z.array(ProjectPreviewLeadSchema),
});
export type ProjectOverview = z.infer<typeof ProjectOverviewSchema>;

export const ProjectAnalysisResultSchema = z.object({
  summary: z.string(),
  selectedLeadIds: z.array(z.string()),
  project: ProjectSchema,
  previewLeads: z.array(ProjectPreviewLeadSchema),
  analyzedProjectIds: z.array(z.string()),
});
export type ProjectAnalysisResult = z.infer<typeof ProjectAnalysisResultSchema>;

export const CreateProjectInputSchema = z.object({
  name: z.string().min(1),
  query: z.string().optional(),
  seedUsername: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const AnalyzeProjectsInputSchema = z.object({
  projectIds: z.array(z.string().uuid()).min(1),
  name: z.string().optional(),
});
export type AnalyzeProjectsInput = z.infer<typeof AnalyzeProjectsInputSchema>;
