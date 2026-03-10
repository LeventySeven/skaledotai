import "server-only";
import { protectedProcedure, router } from "../trpc";
import { getPostStats, refreshProfileStats } from "@/server/services/stats";
import { GetPostStatsInputSchema, RefreshStatsInputSchema } from "@/lib/validations/stats";

export const statsRouter = router({
  get: protectedProcedure
    .input(GetPostStatsInputSchema)
    .query(({ ctx, input }) => getPostStats(ctx.userId, input.profileId)),

  refresh: protectedProcedure
    .input(RefreshStatsInputSchema)
    .mutation(({ ctx, input }) => refreshProfileStats(ctx.userId, input, ctx.xDataProvider)),
});
