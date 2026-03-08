import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { assertProject, createProject, deleteProject, getProjects, queueProjectInfluencers } from "@/server/services/projects";

export const projectsRouter = router({
  list: protectedProcedure
    .query(({ ctx }) => getProjects(ctx.userId)),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      query: z.string().optional(),
      seedUsername: z.string().optional(),
    }))
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
});

export { assertProject };
