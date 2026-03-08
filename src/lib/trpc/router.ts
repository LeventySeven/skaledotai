import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createApiKey,
  createProject,
  deleteApiKey,
  deleteProject,
  deleteProjectInfluencer,
  enrichProjectInfluencerEmails,
  getPostStats,
  getProjectById,
  getProjects,
  listApiKeys,
  listLeads,
  listOutreachQueue,
  queueProjectInfluencers,
  scanProjectEmails,
  updateProjectInfluencer,
} from "@/lib/db";
import { importAccountNetwork, refreshProfileStats, searchAndAddLeads } from "@/lib/lead-service";
import { protectedProcedure, router } from "@/lib/trpc/server";

const leadPatchSchema = z.object({
  stage: z.enum(["found", "messaged", "replied", "agreed"]).optional(),
  priority: z.enum(["P0", "P1"]).optional(),
  dmComfort: z.boolean().optional(),
  theAsk: z.string().optional(),
  inOutreach: z.boolean().optional(),
  email: z.string().nullable().optional(),
  budget: z.number().nullable().optional(),
});

async function assertProject(ctx: { userId: string }, projectId: string) {
  const project = await getProjectById(ctx.userId, projectId);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  }
  return project;
}

export const appRouter = router({
  projects: router({
    list: protectedProcedure.query(({ ctx }) => getProjects(ctx.userId)),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          query: z.string().optional(),
          seedUsername: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        createProject({
          userId: ctx.userId,
          name: input.name,
          query: input.query,
          seedUsername: input.seedUsername,
        }),
      ),
    delete: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .mutation(({ ctx, input }) => deleteProject(ctx.userId, input.projectId)),
    queueAllLeads: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertProject(ctx, input.projectId);
        const queued = await queueProjectInfluencers(input.projectId);
        return { queued };
      }),
  }),
  leads: router({
    list: protectedProcedure
      .input(
        z.object({
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().positive().max(100).default(25),
          sort: z.enum(["followers-desc", "followers-asc", "name-asc"]).default("followers-desc"),
          search: z.string().default(""),
          projectId: z.string().uuid().optional(),
          inOutreach: z.boolean().optional(),
          stage: z.enum(["all", "found", "messaged", "replied", "agreed"]).default("all"),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (input.projectId) await assertProject(ctx, input.projectId);
        return listLeads({ userId: ctx.userId, ...input });
      }),
    update: protectedProcedure
      .input(
        z.object({
          crmId: z.string().uuid(),
          patch: leadPatchSchema,
        }),
      )
      .mutation(({ input }) => updateProjectInfluencer(input.crmId, input.patch)),
    remove: protectedProcedure
      .input(z.object({ crmId: z.string().uuid() }))
      .mutation(({ input }) => deleteProjectInfluencer(input.crmId)),
    enrichEmails: protectedProcedure
      .input(z.object({ crmIds: z.array(z.string().uuid()).min(1) }))
      .mutation(({ input }) => enrichProjectInfluencerEmails(input.crmIds)),
    scanEmails: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertProject(ctx, input.projectId);
        const updated = await scanProjectEmails(input.projectId);
        return { updated };
      }),
  }),
  search: router({
    run: protectedProcedure
      .input(
        z.object({
          query: z.string().min(1),
          projectId: z.string().uuid().optional(),
          projectName: z.string().optional(),
          followerUsername: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.projectId) await assertProject(ctx, input.projectId);
        return searchAndAddLeads(ctx.userId, input);
      }),
    importNetwork: protectedProcedure
      .input(
        z.object({
          username: z.string().min(1),
          projectId: z.string().uuid().optional(),
          projectName: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.projectId) await assertProject(ctx, input.projectId);
        return importAccountNetwork(ctx.userId, input);
      }),
  }),
  stats: router({
    get: protectedProcedure
      .input(z.object({ profileId: z.string().uuid() }))
      .query(({ input }) => getPostStats(input.profileId)),
    refresh: protectedProcedure
      .input(
        z.object({
          profileId: z.string().uuid(),
          crmId: z.string().uuid().optional(),
          niche: z.string().optional(),
        }),
      )
      .mutation(({ input }) => refreshProfileStats(input)),
  }),
  outreach: router({
    list: protectedProcedure.query(({ ctx }) => listOutreachQueue(ctx.userId)),
  }),
  settings: router({
    apiKeys: router({
      list: protectedProcedure.query(({ ctx }) => listApiKeys(ctx.userId)),
      create: protectedProcedure
        .input(z.object({ name: z.string().min(1) }))
        .mutation(({ ctx, input }) => createApiKey(ctx.userId, input.name)),
      delete: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(({ ctx, input }) => deleteApiKey(ctx.userId, input.id)),
    }),
  }),
});

export type AppRouter = typeof appRouter;
