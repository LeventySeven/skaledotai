import "@/lib/server-runtime";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { assertProject } from "@/server/services/projects";
import { importAccountNetwork, searchAndAddLeads } from "@/server/services/search";
import { getProjectRunTrace } from "@/server/services/project-runs";
import { ImportNetworkInputSchema, SearchLeadInputSchema } from "@/lib/validations/search";

export const searchRouter = router({
  run: protectedProcedure
    .input(SearchLeadInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProject(ctx.userId, input.projectId);
      return searchAndAddLeads(ctx.userId, input, ctx.xDataProvider);
    }),

  importNetwork: protectedProcedure
    .input(ImportNetworkInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProject(ctx.userId, input.projectId);
      // Network import always uses x-api — multiagent/openrouter don't support network operations
      return importAccountNetwork(ctx.userId, input, "x-api");
    }),

  /** Fetch saved trace for a project run — allows restoring progress after navigation */
  getRunTrace: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProject(ctx.userId, input.projectId);
      return getProjectRunTrace(input.projectId);
    }),
});
