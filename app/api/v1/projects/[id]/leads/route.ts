import { NextRequest, NextResponse } from "next/server";
import { addLeadsToProject } from "@/lib/db";
import { withApiKey } from "@/lib/withApiKey";

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) {
  const { id } = await ctx.params;
  const { leadIds } = await req.json() as { leadIds: string[] };
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds array is required" }, { status: 400 });
  }
  try {
    await addLeadsToProject(id, leadIds);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to add leads to project." }, { status: 500 });
  }
}

export const POST = withApiKey(postHandler);
