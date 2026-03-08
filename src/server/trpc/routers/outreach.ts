import { protectedProcedure, router } from "../trpc";
import { listOutreachQueue } from "@/lib/queries";

export const outreachRouter = router({
  list: protectedProcedure.query(({ ctx }) => listOutreachQueue(ctx.userId)),
});
