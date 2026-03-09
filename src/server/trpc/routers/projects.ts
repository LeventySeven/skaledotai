import "server-only";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import {
  assertProject,
  createProject,
  deleteProject,
  getProjectOverviews,
  getProjects,
  queueProjectInfluencers,
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
      })),
});

export { assertProject };
