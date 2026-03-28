import { NextResponse } from "next/server";
import { db } from "@/db";
import { monitoredLeads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkAllMonitoredDms } from "@/server/services/monitoring";

/**
 * Hourly DM check cron endpoint.
 *
 * Can be triggered by:
 *  - Vercel Cron (vercel.json: { "crons": [{ "path": "/api/monitoring/check-dms", "schedule": "0 * * * *" }] })
 *  - External cron service (e.g. Upstash QStash, cron-job.org)
 *  - Manual call with ?userId=xxx
 *
 * Security: Requires CRON_SECRET header or query param userId for manual triggers.
 */
export async function GET(request: Request) {
  // Verify cron secret or allow manual trigger with userId
  const url = new URL(request.url);
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && cronSecret !== expectedSecret) {
    // Allow manual trigger with explicit userId for development
    const manualUserId = url.searchParams.get("userId");
    if (!manualUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Single-user manual trigger
    const result = await checkAllMonitoredDms(manualUserId);
    return NextResponse.json({ success: true, ...result });
  }

  // Cron mode: check all users with active monitoring
  const usersWithMonitoring = await db
    .select({ userId: monitoredLeads.userId })
    .from(monitoredLeads)
    .where(eq(monitoredLeads.monitoring, true))
    .groupBy(monitoredLeads.userId);

  let totalChecked = 0;
  let totalUpdated = 0;

  for (const { userId } of usersWithMonitoring) {
    const result = await checkAllMonitoredDms(userId);
    totalChecked += result.checked;
    totalUpdated += result.updated;
  }

  return NextResponse.json({
    success: true,
    users: usersWithMonitoring.length,
    checked: totalChecked,
    updated: totalUpdated,
  });
}
