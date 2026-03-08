import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { getPostStats } from "@/lib/queries";
import { refreshProfileStats } from "@/lib/lead-service";

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
    .mutation(({ input }) => refreshProfileStats(input)),
});
