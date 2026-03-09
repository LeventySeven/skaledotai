import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { assertProject } from "@/server/services/projects";
import { deleteLead, enrichLeadEmails, listLeads, scanProjectEmails, updateLead, updateLeads } from "@/server/services/leads";

const leadPatchSchema = z.object({
  stage: z.enum(["found", "messaged", "replied", "agreed"]).optional(),
  priority: z.enum(["P0", "P1"]).optional(),
  dmComfort: z.boolean().optional(),
  theAsk: z.string().optional(),
  inOutreach: z.boolean().optional(),
  email: z.string().nullable().optional(),
  budget: z.number().nullable().optional(),
});

export const leadsRouter = router({
  list: protectedProcedure
    .input(z.object({
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().positive().max(100).default(25),
      sort: z.enum(["followers-desc", "followers-asc", "name-asc"]).default("followers-desc"),
      search: z.string().default(""),
      projectId: z.string().uuid().optional(),
      inOutreach: z.boolean().optional(),
      stage: z.enum(["all", "found", "messaged", "replied", "agreed"]).default("all"),
    }))
    .query(async ({ ctx, input }) => {
      if (input.projectId) await assertProject(ctx.userId, input.projectId);
      return listLeads({ userId: ctx.userId, ...input });
    }),

  update: protectedProcedure
    .input(z.object({ crmId: z.string().uuid(), patch: leadPatchSchema }))
    .mutation(({ ctx, input }) => updateLead(ctx.userId, input.crmId, input.patch)),

  bulkUpdate: protectedProcedure
    .input(z.object({ crmIds: z.array(z.string().uuid()).min(1), patch: leadPatchSchema }))
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
