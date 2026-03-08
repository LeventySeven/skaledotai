import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apikey";

export function withApiKey(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>
) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    const key = req.headers.get("x-api-key");
    if (!key || !(await validateApiKey(key))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(req, ctx);
  };
}
