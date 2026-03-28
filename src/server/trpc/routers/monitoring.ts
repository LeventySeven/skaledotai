import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import {
  ListMonitoringInputSchema,
  MonitoringPatchSchema,
  AddToMonitoringInputSchema,
} from "@/lib/validations/monitoring";
import {
  addToMonitoring,
  addSuggestionsToMonitoring,
  listMonitored,
  updateMonitored,
  bulkUpdateMonitored,
  removeMonitored,
  fetchDmsForLead,
  refreshDmsForLead,
  checkAllMonitoredDms,
  suggestFromDms,
} from "@/server/services/monitoring";

export const monitoringRouter = router({
  list: protectedProcedure
    .input(ListMonitoringInputSchema)
    .query(async ({ ctx, input }) => {
      return listMonitored(ctx.userId, input);
    }),

  add: protectedProcedure
    .input(AddToMonitoringInputSchema)
    .mutation(async ({ ctx, input }) => {
      return addToMonitoring(ctx.userId, input.sourceTable, input.sourceIds);
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: MonitoringPatchSchema }))
    .mutation(async ({ ctx, input }) => {
      return updateMonitored(ctx.userId, input.id, input.patch);
    }),

  bulkUpdate: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1), patch: MonitoringPatchSchema }))
    .mutation(async ({ ctx, input }) => {
      return bulkUpdateMonitored(ctx.userId, input.ids, input.patch);
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return removeMonitored(ctx.userId, input.id);
    }),

  getDms: protectedProcedure
    .input(z.object({ monitoredLeadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return fetchDmsForLead(ctx.userId, input.monitoredLeadId);
    }),

  refreshDms: protectedProcedure
    .input(z.object({ monitoredLeadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return refreshDmsForLead(ctx.userId, input.monitoredLeadId);
    }),

  checkAll: protectedProcedure
    .mutation(async ({ ctx }) => {
      return checkAllMonitoredDms(ctx.userId);
    }),

  suggestFromDms: protectedProcedure
    .query(async ({ ctx }) => {
      return suggestFromDms(ctx.userId);
    }),

  addSuggestions: protectedProcedure
    .input(z.object({
      suggestions: z.array(z.object({
        xUserId: z.string(),
        username: z.string(),
        name: z.string(),
        avatarUrl: z.string().optional(),
        bio: z.string().optional(),
        followers: z.number().optional(),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      return addSuggestionsToMonitoring(ctx.userId, input.suggestions);
    }),
});
