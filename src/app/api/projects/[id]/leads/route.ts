import { NextRequest, NextResponse } from "next/server";
import { addLeadsToProject } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { leadIds } = await req.json() as { leadIds: string[] };
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds array is required" }, { status: 400 });
  }
  try {
    await addLeadsToProject(id, leadIds);
    return NextResponse.json({ ok: true, added: leadIds.length });
  } catch (err) {
    console.error("[project leads POST]", err);
    return NextResponse.json({ error: "Failed to add leads to project." }, { status: 500 });
  }
}
