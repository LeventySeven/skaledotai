import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { assertProject } from "@/server/services/projects";
import { deleteLead, enrichLeadEmails, listLeads, scanProjectEmails, updateLead, updateLeads } from "@/server/services/leads";
import { LeadPatchSchema, ListLeadsInputSchema } from "@/lib/validations/leads";

export const leadsRouter = router({
  list: protectedProcedure
    .input(ListLeadsInputSchema)
    .query(async ({ ctx, input }) => {
      if (input.projectId) await assertProject(ctx.userId, input.projectId);
      return listLeads({ userId: ctx.userId, ...input });
    }),

  update: protectedProcedure
    .input(z.object({ crmId: z.string().uuid(), patch: LeadPatchSchema }))
    .mutation(({ ctx, input }) => updateLead(ctx.userId, input.crmId, input.patch)),

  bulkUpdate: protectedProcedure
    .input(z.object({ crmIds: z.array(z.string().uuid()).min(1), patch: LeadPatchSchema }))
    .mutation(({ ctx, input }) => updateLeads(ctx.userId, input.crmIds, input.patch)),

  remove: protectedProcedure
    .input(z.object({ crmId: z.string().uuid() }))
    .mutation(({ ctx, input }) => deleteLead(ctx.userId, input.crmId)),

  enrichEmails: protectedProcedure
    .input(z.object({ crmIds: z.array(z.string().uuid()).min(1) }))
    .mutation(({ input }) => enrichLeadEmails(input.crmIds)),

  scanEmails: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.userId, input.projectId);
      const updated = await scanProjectEmails(input.projectId);
      return { updated };
    }),
});
