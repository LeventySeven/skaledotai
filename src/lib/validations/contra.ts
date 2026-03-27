import { z } from "zod";
import { LeadStageSchema, PrioritySchema, PlatformSchema } from "./shared";

export const ContraLeadSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  bio: z.string(),
  platform: PlatformSchema,
  followers: z.number(),
  following: z.number().optional(),
  avatarUrl: z.string().optional(),
  profileUrl: z.string().optional(),
  url: z.string().optional(),
  site: z.string().optional(),
  linkedinUrl: z.string().optional(),
  email: z.string().optional(),
  price: z.number().optional(),
  budget: z.number().optional(),
  tags: z.array(z.string()),
  deliverables: z.array(z.string()),
  relevancy: z.string().optional(),
  notes: z.string().optional(),
  source: z.string().optional(),
  reachedOut: z.boolean(),
  stage: LeadStageSchema,
  priority: PrioritySchema,
  dmComfort: z.boolean(),
  theAsk: z.string(),
  inOutreach: z.boolean(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ContraLead = z.infer<typeof ContraLeadSchema>;

export const ContraPatchSchema = z.object({
  stage: LeadStageSchema.optional(),
  priority: PrioritySchema.optional(),
  dmComfort: z.boolean().optional(),
  theAsk: z.string().optional(),
  inOutreach: z.boolean().optional(),
  email: z.string().nullable().optional(),
  reachedOut: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
});
export type ContraPatch = z.infer<typeof ContraPatchSchema>;

export const ContraSortSchema = z.enum(["followers-desc", "followers-asc", "name-asc", "price-desc"]);
export type ContraSort = z.infer<typeof ContraSortSchema>;

export const ListContraInputSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(25),
  sort: ContraSortSchema.default("followers-desc"),
  search: z.string().default(""),
  stage: z.enum(["all", ...LeadStageSchema.options]).default("all"),
  relevancy: z.enum(["all", "high", "low"]).default("all"),
  source: z.enum(["all", "internal", "influencer"]).default("all"),
});
export type ListContraInput = z.infer<typeof ListContraInputSchema>;
