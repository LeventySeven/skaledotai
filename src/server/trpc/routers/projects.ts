import "@/lib/server-runtime";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import {
  assertProject,
  createProject,
  deleteProject,
  getProjectOverviews,
  getProjects,
  queueProjectInfluencers,
  renameProject,
} from "@/server/services/projects";
import { analyzeProjectsIntoNewProject } from "@/server/services/analysis";
import { AnalyzeProjectsInputSchema, CreateProjectInputSchema } from "@/lib/validations/projects";
import { billing } from "@/server/services/billing";

export const projectsRouter = router({
  list: protectedProcedure
    .query(({ ctx }) => getProjects(ctx.userId)),

  overviews: protectedProcedure
    .query(({ ctx }) => getProjectOverviews(ctx.userId)),

  create: protectedProcedure
    .input(CreateProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { allowed } = await billing.checkProjects(ctx.userId);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Project limit reached. Upgrade your plan." });

      const result = await createProject(ctx.userId, input);
      await billing.trackProject(ctx.userId);
      return result;
    }),

  rename: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => renameProject(ctx.userId, input.projectId, input.name)),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(({ ctx, input }) => deleteProject(ctx.userId, input.projectId)),

  queueAllLeads: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const queued = await queueProjectInfluencers(ctx.userId, input.projectId);
      return { queued };
    }),

  analyze: protectedProcedure
    .input(AnalyzeProjectsInputSchema)
    .mutation(({ ctx, input }) =>
      analyzeProjectsIntoNewProject({
        userId: ctx.userId,
        projectIds: input.projectIds,
        name: input.name,
        provider: ctx.xDataProvider,
      })),
});

export { assertProject };
