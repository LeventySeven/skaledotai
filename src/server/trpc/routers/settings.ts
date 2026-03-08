import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { createApiKey, deleteApiKey, listApiKeys } from "@/server/services/api-keys";

export const settingsRouter = router({
  apiKeys: router({
    list: protectedProcedure
      .query(({ ctx }) => listApiKeys(ctx.userId)),

    create: protectedProcedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(({ ctx, input }) => createApiKey(ctx.userId, input.name)),

    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ ctx, input }) => deleteApiKey(ctx.userId, input.id)),
  }),
});
