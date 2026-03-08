import { NextRequest, NextResponse } from "next/server";
import { runActor, ACTORS } from "@/lib/apify";
import type { Platform } from "@/lib/types";
import { upsertLeads } from "@/lib/db";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { username } = await req.json();

  if (!username?.trim()) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  try {
    const handle = username.replace(/^@/, "");
    const items = await runActor<Record<string, unknown>>(ACTORS.twitterFollowers, {
      user_names: [handle],
      maxFollowers: 10000000,
      maxFollowings: 200,
      getFollowers: true,
      getFollowing: true,
    }, 300);

    const raw = items
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
    return NextResponse.json({ leads });
  } catch (err) {
    console.error("[followers]", err);
    return NextResponse.json({ error: "Failed to fetch followers." }, { status: 500 });
  }
}
