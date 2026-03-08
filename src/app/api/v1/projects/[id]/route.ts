import { NextRequest, NextResponse } from "next/server";
import { getLeadsByProject, deleteProject } from "@/lib/db";
import { withApiKey } from "@/lib/withApiKey";

async function getHandler(
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 25);
  const search = searchParams.get("search") ?? "";
  const sort = searchParams.get("sort") ?? "followers-desc";
  const platform = searchParams.get("platform") ?? "all";
  try {
    const { leads, total } = await getLeadsByProject(id, { page, pageSize, search, sort, platform });
    return NextResponse.json({ leads, total });
  } catch {
    return NextResponse.json({ error: "Failed to fetch project leads." }, { status: 500 });
  }
}

async function deleteHandler(
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) {
  const { id } = await ctx.params;
  try {
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete project." }, { status: 500 });
  }
}

export const GET = withApiKey(getHandler);
export const DELETE = withApiKey(deleteHandler);
