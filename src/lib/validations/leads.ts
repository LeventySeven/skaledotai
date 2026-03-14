import { z } from "zod";
import {
  DiscoverySourceSchema,
  LeadStageSchema,
  PlatformSchema,
  PrioritySchema,
} from "./shared";

export const LeadSchema = z.object({
  id: z.string(),
  crmId: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  xUserId: z.string().optional(),
  name: z.string(),
  handle: z.string(),
  bio: z.string(),
  location: z.string().optional(),
  platform: PlatformSchema,
  followers: z.number(),
  following: z.number().optional(),
  avatarUrl: z.string().optional(),
  profileUrl: z.string().optional(),
  email: z.string().optional(),
  budget: z.number().optional(),
  priority: PrioritySchema,
  dmComfort: z.boolean(),
  theAsk: z.string(),
  inOutreach: z.boolean(),
  stage: LeadStageSchema,
  discoverySource: DiscoverySourceSchema.optional(),
  discoveryQuery: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  editable: z.boolean().optional(),
});
export type Lead = z.infer<typeof LeadSchema>;

export const LeadReasoningSchema = z.object({
  leadId: z.string().uuid(),
  projectId: z.string().uuid(),
  summary: z.string(),
  alignmentBullets: z.array(z.string()).min(1).max(5),
  userGoals: z.array(z.string()).min(1).max(3),
  confidence: z.number().int().min(0).max(100),
  tools: z.array(z.string()).default([]),
  subagents: z.array(z.string()).default([]),
  generatedAt: z.string(),
  updatedAt: z.string(),
});
export type LeadReasoning = z.infer<typeof LeadReasoningSchema>;

export const GetLeadReasoningInputSchema = z.object({
  leadId: z.string().uuid(),
  projectId: z.string().uuid(),
});
export type GetLeadReasoningInput = z.infer<typeof GetLeadReasoningInputSchema>;

export const LeadPatchSchema = z.object({
  stage: LeadStageSchema.optional(),
  priority: PrioritySchema.optional(),
  dmComfort: z.boolean().optional(),
  theAsk: z.string().optional(),
  inOutreach: z.boolean().optional(),
  email: z.string().nullable().optional(),
  budget: z.number().nullable().optional(),
});
export type LeadPatch = z.infer<typeof LeadPatchSchema>;

export const LeadSortSchema = z.enum(["followers-desc", "followers-asc", "name-asc"]);
export type LeadSort = z.infer<typeof LeadSortSchema>;

export const ListLeadsInputSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(25),
  sort: LeadSortSchema.default("followers-desc"),
  search: z.string().default(""),
  projectId: z.string().uuid().optional(),
  inOutreach: z.boolean().optional(),
  stage: z.enum(["all", ...LeadStageSchema.options]).default("all"),
});
export type ListLeadsInput = z.infer<typeof ListLeadsInputSchema>;
