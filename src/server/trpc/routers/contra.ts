import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { ListContraInputSchema, ContraPatchSchema } from "@/lib/validations/contra";
import { listContra, updateContra, updateContraBulk, exportContraForDocs } from "@/server/services/contra";

export const contraRouter = router({
  list: protectedProcedure
    .input(ListContraInputSchema)
    .query(async ({ input }) => {
      return listContra(input);
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: ContraPatchSchema }))
    .mutation(async ({ input }) => {
      return updateContra(input.id, input.patch);
    }),

  bulkUpdate: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1), patch: ContraPatchSchema }))
    .mutation(async ({ input }) => {
      return updateContraBulk(input.ids, input.patch);
    }),

  exportForDocs: protectedProcedure.query(async () => {
    return exportContraForDocs();
  }),
});
