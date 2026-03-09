import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { assertProject } from "@/server/services/projects";
import { importAccountNetwork, searchAndAddLeads } from "@/server/services/search";

export const searchRouter = router({
  run: protectedProcedure
    .input(z.object({
      query: z.string().min(1),
      projectId: z.string().uuid().optional(),
      projectName: z.string().optional(),
      followerUsername: z.string().optional(),
      minFollowers: z.number().int().nonnegative().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProject(ctx.userId, input.projectId);
      return searchAndAddLeads(ctx.userId, input);
    }),

  importNetwork: protectedProcedure
    .input(z.object({
      username: z.string().min(1),
      projectId: z.string().uuid().optional(),
      projectName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProject(ctx.userId, input.projectId);
      return importAccountNetwork(ctx.userId, input);
    }),
});
