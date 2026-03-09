import { protectedProcedure, router } from "../trpc";
import {
  buildAiOutreachTemplate,
  getOutreachQueue,
  getStandardOutreachTemplates,
} from "@/server/services/outreach";
import { GenerateTemplateInputSchema } from "@/lib/validations/outreach";

export const outreachRouter = router({
  list: protectedProcedure.query(({ ctx }) => getOutreachQueue(ctx.userId)),

  templates: protectedProcedure.query(() => getStandardOutreachTemplates()),

  generateTemplate: protectedProcedure
    .input(GenerateTemplateInputSchema)
    .mutation(({ ctx, input }) =>
      buildAiOutreachTemplate({
        userId: ctx.userId,
        projectIds: input.projectIds,
        leadIds: input.leadIds,
        requestedStyle: input.requestedStyle,
      })),
});
