import "@/lib/server-runtime";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { assertProject } from "@/server/services/projects";
import { importAccountNetwork, searchAndAddLeads } from "@/server/services/search";
import { getProjectRunTrace } from "@/server/services/project-runs";
import { ImportNetworkInputSchema, SearchLeadInputSchema } from "@/lib/validations/search";
import { billing } from "@/server/services/billing";

export const searchRouter = router({
  run: protectedProcedure
    .input(SearchLeadInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { allowed } = await billing.checkSearches(ctx.userId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Search limit reached. Upgrade your plan." });

      if (input.projectId) await assertProject(ctx.userId, input.projectId);
      const result = await searchAndAddLeads(ctx.userId, input, ctx.xDataProvider);

      await billing.trackSearch(ctx.userId);
      return result;
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
