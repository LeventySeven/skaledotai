import "server-only";
import { protectedProcedure, router } from "../trpc";
import { createApiKey, deleteApiKey, listApiKeys } from "@/server/services/api-keys";
import { CreateApiKeyInputSchema, DeleteApiKeyInputSchema } from "@/lib/validations/settings";
import { getXProviderRuntimeStatuses } from "@/lib/x/client";

export const settingsRouter = router({
  apiKeys: router({
    list: protectedProcedure
      .query(({ ctx }) => listApiKeys(ctx.userId)),

    create: protectedProcedure
      .input(CreateApiKeyInputSchema)
      .mutation(({ ctx, input }) => createApiKey(ctx.userId, input.name)),

    delete: protectedProcedure
      .input(DeleteApiKeyInputSchema)
      .mutation(({ ctx, input }) => deleteApiKey(ctx.userId, input.id)),
  }),
  xProviders: router({
    list: protectedProcedure.query(() => getXProviderRuntimeStatuses()),
  }),
});
