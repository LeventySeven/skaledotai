import { protectedProcedure, router } from "../trpc";
import { getOutreachQueue } from "@/server/services/outreach";

export const outreachRouter = router({
  list: protectedProcedure.query(({ ctx }) => getOutreachQueue(ctx.userId)),
});
