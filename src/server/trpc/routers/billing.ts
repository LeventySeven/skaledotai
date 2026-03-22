import "@/lib/server-runtime";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { checkFeature, trackUsage, attachPlan } from "@/server/services/billing";

export const billingRouter = router({
  /** Check if user can use a feature */
  check: protectedProcedure
    .input(z.object({ featureId: z.string() }))
    .query(async ({ ctx, input }) => {
      return checkFeature(ctx.userId, input.featureId);
    }),

  /** Track feature usage */
  track: protectedProcedure
    .input(z.object({ featureId: z.string(), value: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      return trackUsage(ctx.userId, input.featureId, input.value);
    }),

  /** Get checkout URL for a plan */
  attach: protectedProcedure
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return attachPlan(ctx.userId, input.planId);
    }),
});
