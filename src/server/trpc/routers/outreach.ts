import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import {
  buildAiOutreachTemplate,
  getOutreachQueue,
  getStandardOutreachTemplates,
} from "@/server/services/outreach";

export const outreachRouter = router({
  list: protectedProcedure.query(({ ctx }) => getOutreachQueue(ctx.userId)),

  templates: protectedProcedure.query(() => getStandardOutreachTemplates()),

  generateTemplate: protectedProcedure
    .input(z.object({
      projectIds: z.array(z.string().uuid()).optional(),
      leadIds: z.array(z.string().uuid()).optional(),
      requestedStyle: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      buildAiOutreachTemplate({
        userId: ctx.userId,
        projectIds: input.projectIds,
        leadIds: input.leadIds,
        requestedStyle: input.requestedStyle,
      })),
});
