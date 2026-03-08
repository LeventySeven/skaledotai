import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { getPostStats } from "@/server/services/stats";
import { refreshProfileStats } from "@/server/services/search";

export const statsRouter = router({
  get: protectedProcedure
    .input(z.object({ profileId: z.string().uuid() }))
    .query(({ input }) => getPostStats(input.profileId)),

  refresh: protectedProcedure
    .input(z.object({
      profileId: z.string().uuid(),
      crmId: z.string().uuid().optional(),
      niche: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => refreshProfileStats(ctx.userId, input)),
});
