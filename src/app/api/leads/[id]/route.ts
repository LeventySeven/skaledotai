import { NextRequest, NextResponse } from "next/server";
import { updateLead } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  try {
    await updateLead(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[leads PATCH]", err);
    return NextResponse.json({ error: "Failed to update lead." }, { status: 500 });
  }
}
