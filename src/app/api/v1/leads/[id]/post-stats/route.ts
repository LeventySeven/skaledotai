import { NextRequest, NextResponse } from "next/server";
import { getPostStats } from "@/lib/db";
import { withApiKey } from "@/lib/withApiKey";

async function getHandler(
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) {
  const { id } = await ctx.params;
  try {
    const stats = await getPostStats(id);
    return NextResponse.json(stats ?? null);
  } catch {
    return NextResponse.json({ error: "Failed to fetch post stats." }, { status: 500 });
  }
}

export const GET = withApiKey(getHandler);
