import "server-only";
import { protectedProcedure, router } from "../trpc";
import { getPostStats } from "@/server/services/stats";
import { refreshProfileStats } from "@/server/services/search";
import { GetPostStatsInputSchema, RefreshStatsInputSchema } from "@/lib/validations/stats";

export const statsRouter = router({
  get: protectedProcedure
    .input(GetPostStatsInputSchema)
    .query(({ ctx, input }) => getPostStats(ctx.userId, input.profileId)),

  refresh: protectedProcedure
    .input(RefreshStatsInputSchema)
    .mutation(({ ctx, input }) => refreshProfileStats(ctx.userId, input)),
});
