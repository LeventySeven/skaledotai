import "@/lib/server-runtime";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import {
  buildAiOutreachTemplate,
  getOutreachQueue,
  getStandardOutreachTemplates,
} from "@/server/services/outreach";
import { billing } from "@/server/services/billing";
import {
  deleteOutreachTemplate,
  listOutreachTemplates,
  saveOutreachTemplate,
  updateOutreachTemplate,
} from "@/server/services/outreach-templates";
import {
  GenerateTemplateInputSchema,
  SaveOutreachTemplateInputSchema,
  UpdateOutreachTemplateInputSchema,
} from "@/lib/validations/outreach";
import { sendDirectMessageBatch } from "@/lib/x/dm";
import { getXAccessToken } from "@/server/services/x-auth";
import { enqueueDmBatch } from "@/server/services/dm-queue";

export const outreachRouter = router({
  list: protectedProcedure.query(({ ctx }) => getOutreachQueue(ctx.userId)),

  templates: protectedProcedure.query(() => getStandardOutreachTemplates()),

  savedTemplates: protectedProcedure
    .query(({ ctx }) => listOutreachTemplates(ctx.userId)),

  generateTemplate: protectedProcedure
    .input(GenerateTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const template = await buildAiOutreachTemplate({
        userId: ctx.userId,
        projectIds: input.projectIds,
        leadIds: input.leadIds,
        requestedStyle: input.requestedStyle,
      });
      return saveOutreachTemplate(ctx.userId, template);
    }),

  createTemplate: protectedProcedure
    .input(SaveOutreachTemplateInputSchema)
    .mutation(({ ctx, input }) => saveOutreachTemplate(ctx.userId, input)),

  updateTemplate: protectedProcedure
    .input(UpdateOutreachTemplateInputSchema)
    .mutation(({ ctx, input }) => updateOutreachTemplate(ctx.userId, input)),

  deleteTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => deleteOutreachTemplate(ctx.userId, input.id)),

  /** Check if user has connected their X account for DM sending */
  hasXAccount: protectedProcedure
    .query(async ({ ctx }) => {
      const { hasXAccountConnected } = await import("@/server/services/x-auth");
      return { connected: await hasXAccountConnected(ctx.userId) };
    }),

  /** Disconnect the user's X account */
  disconnectXAccount: protectedProcedure
    .mutation(async ({ ctx }) => {
      const { disconnectXAccount } = await import("@/server/services/x-auth");
      await disconnectXAccount(ctx.userId);
      return { connected: false };
    }),

  /** Enqueue DMs for background sending via the outreach service.
   *  Inserts rows into dm_batches + dm_jobs, returns batchId.
   *  Client then calls the outreach service directly to trigger processing. */
  enqueueDms: protectedProcedure
    .input(z.object({
      leads: z.array(z.object({
        leadId: z.string(),
        xUserId: z.string(),
        message: z.string().min(1).max(10000),
      })).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const { allowed } = await billing.checkDmOutreach(ctx.userId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "DM limit reached. Upgrade your plan." });

      const result = await enqueueDmBatch(ctx.userId, input.leads);
      await billing.trackDm(ctx.userId, input.leads.length);
      return result;
    }),

  /** Send DMs to selected leads via X API. Requires connected X account.
   *  Rate limits: 15 DMs per 15 min, 1440 per 24h.
   *  Updates lead stages to "messaged" on success, stores the sent message in theAsk. */
  sendDms: protectedProcedure
    .input(z.object({
      leads: z.array(z.object({
        leadId: z.string(),
        xUserId: z.string(),
        message: z.string().min(1).max(10000),
      })).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = await getXAccessToken(ctx.userId);
      if (!accessToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Connect your X account to send DMs. Go to Settings → Connect X Account.",
        });
      }

      const { updateLead } = await import("@/server/services/leads");

      const result = await sendDirectMessageBatch(input.leads, accessToken);

      // Update lead stages based on DM results
      for (const r of result.results) {
        const matchingInput = input.leads.find((l) => l.leadId === r.leadId);
        if (r.success && matchingInput) {
          // DM sent successfully — mark as "messaged" and store the sent text
          await updateLead(ctx.userId, r.leadId, {
            stage: "messaged",
            theAsk: matchingInput.message,
            inOutreach: true,
          }).catch(() => undefined);
        }
      }

      return {
        sent: result.sent,
        failed: result.failed,
        rateLimited: result.rateLimited,
        results: result.results.map((r) => ({
          leadId: r.leadId,
          success: r.success,
          error: r.error,
          retryable: r.retryable,
        })),
      };
    }),
});
