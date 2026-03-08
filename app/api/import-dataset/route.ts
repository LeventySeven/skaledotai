import { NextRequest, NextResponse } from "next/server";
import type { Platform } from "@/lib/types";
import { upsertLeads } from "@/lib/db";

const TOKEN = process.env.APIFY_API_TOKEN;
const BASE = "https://api.apify.com/v2";

export async function POST(req: NextRequest) {
  const { datasetId, type } = await req.json() as { datasetId?: string; type?: "followers" | "following" | "all" };

  if (!datasetId?.trim()) {
    return NextResponse.json({ error: "datasetId is required" }, { status: 400 });
  }
  if (!TOKEN) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not set" }, { status: 500 });
  }

  try {
    // Paginate through the dataset
    const all: Record<string, unknown>[] = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const res = await fetch(
        `${BASE}/datasets/${datasetId}/items?token=${TOKEN}&offset=${offset}&limit=${limit}`,
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch dataset (${res.status}): ${text}`);
      }
      const items = await res.json() as Record<string, unknown>[];
      all.push(...items);
      if (items.length < limit) break;
      offset += limit;
    }

    // Filter by type if specified
    // The kaitoeasyapi actor includes a "type" field: "follower" or "following"
    const filtered = type && type !== "all"
      ? all.filter((item) => {
          const t = String(item.type ?? item.accountType ?? "").toLowerCase();
          // "following" type = accounts the user follows
          if (type === "following") return t === "following" || t === "friend";
          if (type === "followers") return t === "follower" || t === "followers";
          return true;
        })
      : all;

    const raw = filtered
      .map((item) => {
        const userName = String(item.userName ?? item.username ?? "");
        const name = String(item.name ?? item.displayName ?? "");
        if (!userName || !name || name === "Unknown") return null;
        return {
          name,
          handle: `@${userName}`,
          bio: String(item.description ?? item.bio ?? ""),
          platform: "twitter" as Platform,
          followers: Number(item.followers ?? item.followersCount ?? 0),
          following: Number(item.following ?? item.friendsCount ?? 0),
          avatarUrl: String(item.profilePicture ?? item.profileImageUrl ?? ""),
          profileUrl: `https://x.com/${userName}`,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const leads = await upsertLeads(raw);
    return NextResponse.json({
      leads,
      total: all.length,
      filtered: filtered.length,
      imported: leads.length,
    });
  } catch (err) {
    console.error("[import-dataset]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to import dataset." },
      { status: 500 },
    );
  }
}
