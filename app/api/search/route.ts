import { NextRequest, NextResponse } from "next/server";
import { runActor, ACTORS } from "@/lib/apify";
import type { Platform } from "@/lib/types";
import { upsertLeads, createProject, addLeadsToProject } from "@/lib/db";
import { randomUUID } from "crypto";

export const maxDuration = 300;

type RawLead = {
  name: string; handle: string; bio: string; platform: Platform;
  followers: number; following?: number; avatarUrl?: string;
  profileUrl?: string; linkedinUrl?: string;
};

export async function POST(req: NextRequest) {
  const { query, platform, followerUsername, projectName, projectId } = await req.json();

  if (!query?.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const raw: RawLead[] = [];

    if (platform === "twitter" || platform === "both") {
      const twitterLeads = followerUsername
        ? await searchTwitterFollowers(followerUsername)
        : await searchTwitter(query);
      raw.push(...twitterLeads);
    }

    if (platform === "linkedin" || platform === "both") {
      const linkedinLeads = await searchLinkedIn(query);
      raw.push(...linkedinLeads);
    }

    // Deduplicate by handle+platform before upserting
    const seen = new Set<string>();
    const unique = raw.filter((l) => {
      const key = `${l.handle}:${l.platform}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // AI relevance filter — drop leads whose bio clearly doesn't match the query
    const filtered = await filterByRelevance(unique, query);

    // Upsert to Supabase — returns stable DB rows with CRM fields
    const leads = await upsertLeads(filtered);

    // Use existing project if projectId provided, otherwise create a new one
    let project;
    if (projectId) {
      project = { id: projectId };
    } else {
      const name = (projectName?.trim()) || query.trim();
      project = await createProject(name);
    }
    await addLeadsToProject(project.id, leads.map((l) => l.id));

    return NextResponse.json({ leads, project });
  } catch (err) {
    console.error("[search]", err);
    return NextResponse.json(
      { error: "Search failed. Check your Apify API key." },
      { status: 500 },
    );
  }
}

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

  return items
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
    .filter((x): x is NonNullable<typeof x> => x !== null) as RawLead[];
}

async function filterByRelevance(leads: RawLead[], query: string): Promise<RawLead[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || leads.length === 0) return leads;

  try {
    const list = leads.map((l, i) => `${i}: ${l.name} — ${l.bio.slice(0, 200)}`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        messages: [{
          role: "user",
          content: `You are filtering a list of people for relevance to a search query.

Query: "${query}"

People (index: name — bio):
${list}

Return ONLY a JSON array of the indices that are relevant to the query. Be generous — keep anyone who could plausibly match. Only drop people whose bio clearly has nothing to do with the query.

Example: [0, 2, 5]`,
        }],
      }),
    });

    if (!res.ok) return leads;
    const data = await res.json() as { content: Array<{ text: string }> };
    const text = data.content?.[0]?.text ?? "";
    const match = text.match(/\[[\d,\s]*\]/);
    if (!match) return leads;
    const indices: number[] = JSON.parse(match[0]);
    return leads.filter((_, i) => indices.includes(i));
  } catch {
    return leads; // if AI fails, return all leads unfiltered
  }
}

async function searchLinkedIn(query: string): Promise<RawLead[]> {
  const items = await runActor<Record<string, unknown>>(ACTORS.linkedinSearch, {
    searchQuery: query,
    maxItems: 200,
    profileScraperMode: "Short",
  });

  return items
    .map((item) => {
      const firstName = String(item.firstName ?? "");
      const lastName = String(item.lastName ?? "");
      const name = `${firstName} ${lastName}`.trim();
      if (!name) return null;
      const positions = Array.isArray(item.currentPositions) ? item.currentPositions : [];
      const headline = positions[0]
        ? `${(positions[0] as Record<string, unknown>).title ?? ""} at ${(positions[0] as Record<string, unknown>).companyName ?? ""}`.trim().replace(/^\s*at\s*$/, "")
        : String(item.summary ?? "").slice(0, 160);
      const linkedinUrl = String(item.linkedinUrl ?? "");
      // Use the LinkedIn profile ID as handle
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
    })
    .filter((x): x is NonNullable<typeof x> => x !== null) as RawLead[];
}
