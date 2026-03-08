import { NextRequest, NextResponse } from "next/server";
import { updateLead } from "@/lib/db";
import { withApiKey } from "@/lib/withApiKey";

type OutreachAction = "queue" | "unqueue" | "mark-dmed" | "mark-replied";

const ACTION_MAP: Record<OutreachAction, Parameters<typeof updateLead>[1]> = {
  queue: { inOutreach: true },
  unqueue: { inOutreach: false },
  "mark-dmed": { hasDmed: true },
  "mark-replied": { replied: true },
};

async function handler(req: NextRequest) {
  const { id, action } = await req.json() as { id: string; action: OutreachAction };

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!action || !(action in ACTION_MAP)) {
    return NextResponse.json(
      { error: `action must be one of: ${Object.keys(ACTION_MAP).join(", ")}` },
      { status: 400 }
    );
  }

  try {
    await updateLead(id, ACTION_MAP[action]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[v1/outreach POST]", err);
    return NextResponse.json({ error: "Failed to update outreach status." }, { status: 500 });
  }
}

export const POST = withApiKey(handler);
