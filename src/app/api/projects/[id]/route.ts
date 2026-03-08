import { NextRequest, NextResponse } from "next/server";
import { getLeadsByProject, deleteProject } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 25);
  const platform = searchParams.get("platform") ?? "all";
  const sort = searchParams.get("sort") ?? "followers-desc";
  const search = searchParams.get("search") ?? "";
  try {
    const result = await getLeadsByProject(id, { page, pageSize, platform, sort, search });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[project leads GET]", err);
    return NextResponse.json({ error: "Failed to fetch project leads." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[project DELETE]", err);
    return NextResponse.json({ error: "Failed to delete project." }, { status: 500 });
  }
}
