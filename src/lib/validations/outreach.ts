import { z } from "zod";

export const OutreachTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  subject: z.string(),
  body: z.string(),
  replyRate: z.string(),
  sourceId: z.string().optional(),
  generated: z.boolean().optional(),
});
export type OutreachTemplate = z.infer<typeof OutreachTemplateSchema>;

export const GenerateTemplateInputSchema = z.object({
  projectIds: z.array(z.string().uuid()).optional(),
  leadIds: z.array(z.string().uuid()).optional(),
  requestedStyle: z.string().optional(),
});
export type GenerateTemplateInput = z.infer<typeof GenerateTemplateInputSchema>;

export const SaveOutreachTemplateInputSchema = z.object({
  title: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  replyRate: z.string().min(1),
  sourceId: z.string().optional(),
});
export type SaveOutreachTemplateInput = z.infer<typeof SaveOutreachTemplateInputSchema>;

export const UpdateOutreachTemplateInputSchema = SaveOutreachTemplateInputSchema.extend({
  id: z.string().uuid(),
});
export type UpdateOutreachTemplateInput = z.infer<typeof UpdateOutreachTemplateInputSchema>;
