import { z } from "zod";

export const LeadEvidenceSourceSchema = z.enum(["name", "handle", "bio", "post", "audience"]);
export type LeadEvidenceSource = z.infer<typeof LeadEvidenceSourceSchema>;

export const LeadEvidenceEntrySchema = z.object({
  source: LeadEvidenceSourceSchema,
  snippet: z.string(),
  whyItAligns: z.string(),
}).strict();
export type LeadEvidenceEntry = z.infer<typeof LeadEvidenceEntrySchema>;

export const LeadReasoningResultSchema = z.object({
  summary: z.string(),
  alignmentBullets: z.array(z.string()).min(1).max(5),
  userGoals: z.array(z.string()).min(1).max(3),
  confidence: z.number().int().min(0).max(100),
  tools: z.array(z.string()).default([]),
  subagents: z.array(z.string()).default([]),
  evidence: z.array(LeadEvidenceEntrySchema).default([]),
}).strict();

export type LeadReasoningResult = z.infer<typeof LeadReasoningResultSchema>;
