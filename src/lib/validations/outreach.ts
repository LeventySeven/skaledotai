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
