import "@/lib/server-runtime";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { dmBatches, dmJobs } from "@/db/schema";
import { hasXAccountConnected } from "@/server/services/x-auth";

export async function enqueueDmBatch(
  userId: string,
  leads: Array<{ leadId: string; xUserId: string; message: string }>,
): Promise<{ batchId: string }> {
  const connected = await hasXAccountConnected(userId);
  if (!connected) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Connect your X account to send DMs. Go to Settings → Connect X Account.",
    });
  }

  const [batch] = await db
    .insert(dmBatches)
    .values({
      userId,
      status: "pending",
      totalCount: leads.length,
    })
    .returning();

  if (!batch) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create DM batch." });
  }

  await db
    .insert(dmJobs)
    .values(leads.map((lead) => ({
      batchId: batch.id,
      userId,
      leadId: lead.leadId,
      xUserId: lead.xUserId,
      message: lead.message,
    })));

  return { batchId: batch.id };
}
