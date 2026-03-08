import { NextRequest, NextResponse } from "next/server";
import { updateLead } from "@/lib/db";
import { withApiKey } from "@/lib/withApiKey";

async function handler(
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) {
  const { id } = await ctx.params;
  const body = await req.json();
  try {
    await updateLead(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[v1/leads PATCH]", err);
    return NextResponse.json({ error: "Failed to update lead." }, { status: 500 });
  }
}

export const PATCH = withApiKey(handler);
