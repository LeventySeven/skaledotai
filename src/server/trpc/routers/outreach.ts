import "@/lib/server-runtime";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import {
  buildAiOutreachTemplate,
  getOutreachQueue,
  getStandardOutreachTemplates,
} from "@/server/services/outreach";
import {
  deleteOutreachTemplate,
  listOutreachTemplates,
  saveOutreachTemplate,
  updateOutreachTemplate,
} from "@/server/services/outreach-templates";
import {
  GenerateTemplateInputSchema,
  SaveOutreachTemplateInputSchema,
  UpdateOutreachTemplateInputSchema,
} from "@/lib/validations/outreach";

export const outreachRouter = router({
  list: protectedProcedure.query(({ ctx }) => getOutreachQueue(ctx.userId)),

  templates: protectedProcedure.query(() => getStandardOutreachTemplates()),

  savedTemplates: protectedProcedure
    .query(({ ctx }) => listOutreachTemplates(ctx.userId)),

  generateTemplate: protectedProcedure
    .input(GenerateTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const template = await buildAiOutreachTemplate({
        userId: ctx.userId,
        projectIds: input.projectIds,
        leadIds: input.leadIds,
        requestedStyle: input.requestedStyle,
      });
      return saveOutreachTemplate(ctx.userId, template);
    }),

  createTemplate: protectedProcedure
    .input(SaveOutreachTemplateInputSchema)
    .mutation(({ ctx, input }) => saveOutreachTemplate(ctx.userId, input)),

  updateTemplate: protectedProcedure
    .input(UpdateOutreachTemplateInputSchema)
    .mutation(({ ctx, input }) => updateOutreachTemplate(ctx.userId, input)),

  deleteTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => deleteOutreachTemplate(ctx.userId, input.id)),
});
