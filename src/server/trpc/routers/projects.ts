import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { createProject, deleteProject, getProjectById, getProjects, queueProjectInfluencers } from "@/lib/queries";

export async function assertProject(userId: string, projectId: string) {
  const project = await getProjectById(userId, projectId);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  return project;
}

export const projectsRouter = router({
  list: protectedProcedure.query(({ ctx }) => getProjects(ctx.userId)),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      query: z.string().optional(),
      seedUsername: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      createProject({ userId: ctx.userId, ...input }),
    ),

  delete: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(({ ctx, input }) => deleteProject(ctx.userId, input.projectId)),

  queueAllLeads: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertProject(ctx.userId, input.projectId);
      const queued = await queueProjectInfluencers(input.projectId);
      return { queued };
    }),
});
