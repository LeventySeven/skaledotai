import { protectedProcedure, router } from "../trpc";
import { assertProject } from "@/server/services/projects";
import { importAccountNetwork, searchAndAddLeads } from "@/server/services/search";
import { ImportNetworkInputSchema, SearchLeadInputSchema } from "@/lib/validations/search";

export const searchRouter = router({
  run: protectedProcedure
    .input(SearchLeadInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProject(ctx.userId, input.projectId);
      return searchAndAddLeads(ctx.userId, input);
    }),

  importNetwork: protectedProcedure
    .input(ImportNetworkInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) await assertProject(ctx.userId, input.projectId);
      return importAccountNetwork(ctx.userId, input);
    }),
});
