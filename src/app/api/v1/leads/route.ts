import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/db";
import { withApiKey } from "@/lib/withApiKey";

async function handler(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 25);
  const platform = searchParams.get("platform") ?? "all";
  const sort = searchParams.get("sort") ?? "followers-desc";
  const search = searchParams.get("search") ?? "";
  const inOutreach = searchParams.get("inOutreach");

  try {
    const { leads, total } = await getLeads({
      page,
      pageSize,
      platform,
      sort,
      search,
      inOutreach: inOutreach === "true" ? true : inOutreach === "false" ? false : undefined,
    });
    return NextResponse.json({ leads, total });
  } catch (err) {
    console.error("[v1/leads GET]", err);
    return NextResponse.json({ error: "Failed to fetch leads." }, { status: 500 });
  }
}

export const GET = withApiKey(handler);
