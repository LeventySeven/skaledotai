import "@/lib/server-runtime";
import { z } from "zod";
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

export const projectsRouter = router({
  list: protectedProcedure
    .query(({ ctx }) => getProjects(ctx.userId)),

  overviews: protectedProcedure
    .query(({ ctx }) => getProjectOverviews(ctx.userId)),

  create: protectedProcedure
    .input(CreateProjectInputSchema)
    .mutation(({ ctx, input }) => createProject(ctx.userId, input)),

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
