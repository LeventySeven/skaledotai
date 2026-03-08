import { NextRequest, NextResponse } from "next/server";
import { getLeads, deleteLead } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 25);
  const platform = searchParams.get("platform") ?? "all";
  const sort = searchParams.get("sort") ?? "followers-desc";
  const search = searchParams.get("search") ?? "";
  const inOutreach = searchParams.get("inOutreach");
  try {
    const { leads, total } = await getLeads({ page, pageSize, platform, sort, search, inOutreach: inOutreach === "true" ? true : undefined });
    return NextResponse.json({ leads, total });
  } catch (err) {
    console.error("[leads GET]", err);
    return NextResponse.json({ error: "Failed to fetch leads." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    await deleteLead(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[leads DELETE]", err);
    return NextResponse.json({ error: "Failed to delete lead." }, { status: 500 });
  }
}
