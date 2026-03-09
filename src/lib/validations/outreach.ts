import { z } from "zod";

export const OutreachTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  subject: z.string(),
  body: z.string(),
  replyRate: z.string(),
  generated: z.boolean().optional(),
});
export type OutreachTemplate = z.infer<typeof OutreachTemplateSchema>;

export const GenerateTemplateInputSchema = z.object({
  projectIds: z.array(z.string().uuid()).optional(),
  leadIds: z.array(z.string().uuid()).optional(),
  requestedStyle: z.string().optional(),
});
export type GenerateTemplateInput = z.infer<typeof GenerateTemplateInputSchema>;
