import { NextRequest, NextResponse } from "next/server";
import { runActor, ACTORS } from "@/lib/apify";
import type { Platform } from "@/lib/types";
import { upsertLeads, createProject, addLeadsToProject } from "@/lib/db";
import { randomUUID } from "crypto";

export const maxDuration = 300;
import { withApiKey } from "@/lib/withApiKey";

type RawLead = {
  name: string; handle: string; bio: string; platform: Platform;
  followers: number; following?: number; avatarUrl?: string;
  profileUrl?: string; linkedinUrl?: string;
};

async function searchTwitter(query: string): Promise<RawLead[]> {
  const items = await runActor<Record<string, unknown>>(ACTORS.twitterSearch, {
    searchTerms: [query],
    maxItems: 30,
  });
  const seen = new Set<string>();
  const results: RawLead[] = [];
  for (const item of items) {
    if (!item.author) continue;
    const user = item.author as Record<string, unknown>;
    const userName = String(user.userName ?? "");
    const name = String(user.name ?? "");
    if (!userName || !name || name === "Unknown" || seen.has(userName)) continue;
    seen.add(userName);
    results.push({
      name,
      handle: `@${userName}`,
      bio: String(user.description ?? ""),
      platform: "twitter",
      followers: Number(user.followers ?? 0),
      following: Number(user.following ?? 0),
      avatarUrl: String(user.profilePicture ?? ""),
      profileUrl: `https://x.com/${userName}`,
    });
  }
  return results;
}

async function searchTwitterFollowers(username: string): Promise<RawLead[]> {
  const handle = username.replace(/^@/, "");
  const items = await runActor<Record<string, unknown>>(ACTORS.twitterFollowers, {
    user_names: [handle],
    maxFollowers: 10000000,
    maxFollowings: 200,
    getFollowers: true,
    getFollowing: true,
  }, 300);
  return items.map((item) => {
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
  }).filter((x): x is NonNullable<typeof x> => x !== null) as RawLead[];
}

async function searchLinkedIn(query: string): Promise<RawLead[]> {
  const items = await runActor<Record<string, unknown>>(ACTORS.linkedinSearch, {
    searchQuery: query,
    maxItems: 200,
    profileScraperMode: "Short",
  });
  return items.map((item) => {
    const firstName = String(item.firstName ?? "");
    const lastName = String(item.lastName ?? "");
    const name = `${firstName} ${lastName}`.trim();
    if (!name) return null;
    const positions = Array.isArray(item.currentPositions) ? item.currentPositions : [];
    const headline = positions[0]
      ? `${(positions[0] as Record<string, unknown>).title ?? ""} at ${(positions[0] as Record<string, unknown>).companyName ?? ""}`.trim().replace(/^\s*at\s*$/, "")
      : String(item.summary ?? "").slice(0, 160);
    const linkedinUrl = String(item.linkedinUrl ?? "");
    const handle = linkedinUrl.split("/in/").pop()?.replace(/\/$/, "") || String(item.id ?? randomUUID());
    return {
      name,
      handle,
      bio: String(item.summary ?? headline).slice(0, 500),
      platform: "linkedin" as Platform,
      followers: 0,
      avatarUrl: String(item.pictureUrl ?? ""),
      linkedinUrl,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null) as RawLead[];
}

async function handler(req: NextRequest) {
  const { query, platform, followersOf, projectId, projectName } = await req.json();

  if (!query?.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const raw: RawLead[] = [];

    if (platform === "twitter" || platform === "both") {
      const twitterLeads = followersOf
        ? await searchTwitterFollowers(followersOf)
        : await searchTwitter(query);
      raw.push(...twitterLeads);
    }

    if (platform === "linkedin" || platform === "both") {
      raw.push(...(await searchLinkedIn(query)));
    }

    const seen = new Set<string>();
    const unique = raw.filter((l) => {
      const key = `${l.handle}:${l.platform}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const leads = await upsertLeads(unique);

    // Optionally link to a project
    let project = null;
    if (projectId) {
      project = { id: projectId };
      await addLeadsToProject(projectId, leads.map((l) => l.id));
    } else if (projectName) {
      project = await createProject(projectName.trim());
      await addLeadsToProject(project.id, leads.map((l) => l.id));
    }

    return NextResponse.json({ leads, project });
  } catch (err) {
    console.error("[v1/leads/search]", err);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}

export const POST = withApiKey(handler);
