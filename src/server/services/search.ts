import "server-only";
import { TRPCError } from "@trpc/server";
import { rankProfilesForQuery } from "@/lib/openai";
import type { Lead } from "@/lib/validations/leads";
import type { Project } from "@/lib/validations/projects";
import type { SearchLeadInput, XProfile } from "@/lib/validations/search";
import {
  buildPostSearchQuery,
  buildReplySearchQuery,
  getFollowersPage,
  getFollowingPage,
  isUnsupportedAuthenticationError,
  lookupUsersByUsernames,
  searchAllPosts,
  searchRecentPosts,
  searchUsers,
} from "@/lib/x-api";
import { addProfilesToProject } from "./leads";
import { createProject, getProjectById } from "./projects";

const SEARCH_TARGET = 40;
const NETWORK_TARGET = 1000;

type Candidate = XProfile & {
  samplePosts: string[];
  source: "profile_search" | "post_search" | "reply_search" | "followers" | "following";
};

function byFollowersDesc(a: XProfile, b: XProfile): number {
  return b.followersCount - a.followersCount;
}

function addCandidate(map: Map<string, Candidate>, candidate: Candidate): void {
  const existing = map.get(candidate.xUserId);
  if (!existing) {
    map.set(candidate.xUserId, candidate);
    return;
  }
  existing.samplePosts = [...existing.samplePosts, ...candidate.samplePosts].slice(0, 5);
  if (candidate.followersCount > existing.followersCount) {
    map.set(candidate.xUserId, { ...candidate, samplePosts: existing.samplePosts });
  }
}

async function resolveProject(userId: string, input: SearchLeadInput): Promise<Project> {
  if (input.projectId) {
    const existing = await getProjectById(userId, input.projectId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
    return existing;
  }

  return createProject(userId, {
    name: input.projectName?.trim() || input.query.trim(),
    query: input.query.trim(),
    seedUsername: input.followerUsername?.replace(/^@/, ""),
  });
}

async function collectSearchCandidates(
  query: string,
  followerUsername?: string,
  minFollowers = 0,
): Promise<Candidate[]> {
  const map = new Map<string, Candidate>();

  try {
    for (const profile of await searchUsers(query, 25)) {
      addCandidate(map, { ...profile, samplePosts: [], source: "profile_search" });
    }
  } catch (error) {
    if (!isUnsupportedAuthenticationError(error)) {
      throw error;
    }
  }

  const recentPosts = await searchRecentPosts(buildPostSearchQuery(query), 50);
  for (const profile of recentPosts.users) {
    const samplePosts = recentPosts.tweets
      .filter((t) => t.author_id === profile.xUserId)
      .map((t) => (t as { text?: string }).text ?? "")
      .filter(Boolean)
      .slice(0, 3);
    addCandidate(map, { ...profile, samplePosts, source: "post_search" });
  }

  if (followerUsername) {
    const [seed] = await lookupUsersByUsernames([followerUsername]);
    if (seed) {
      const replies = await searchRecentPosts(buildReplySearchQuery(query, followerUsername), 50);
      for (const profile of replies.users) {
        const samplePosts = replies.tweets
          .filter((t) => t.author_id === profile.xUserId)
          .map((t) => (t as { text?: string }).text ?? "")
          .filter(Boolean)
          .slice(0, 3);
        addCandidate(map, { ...profile, samplePosts, source: "reply_search" });
      }

      let nextToken: string | undefined;
      let fetched = 0;
      while (fetched < NETWORK_TARGET) {
        const page = await getFollowersPage(seed.xUserId, nextToken, 250);
        for (const p of page.profiles) addCandidate(map, { ...p, samplePosts: [], source: "followers" });
        fetched += page.profiles.length;
        nextToken = page.nextToken;
        if (!nextToken || page.profiles.length === 0) break;
      }
    }
  }

  if (map.size < SEARCH_TARGET && process.env.X_ENABLE_FULL_ARCHIVE === "true") {
    const allPosts = await searchAllPosts(buildPostSearchQuery(query), 50);
    for (const profile of allPosts.users) {
      const samplePosts = allPosts.tweets
        .filter((t) => t.author_id === profile.xUserId)
        .map((t) => (t as { text?: string }).text ?? "")
        .filter(Boolean)
        .slice(0, 3);
      addCandidate(map, { ...profile, samplePosts, source: "post_search" });
    }
  }

  const filteredCandidates = [...map.values()]
    .filter((candidate) => candidate.followersCount >= minFollowers)
    .sort(byFollowersDesc);

  const rankedIds = await rankProfilesForQuery(query, filteredCandidates);
  const rankedIdSet = new Set(rankedIds);
  const ranked = rankedIds
    .map((id) => filteredCandidates.find((candidate) => candidate.xUserId === id))
    .filter((c): c is Candidate => Boolean(c))
    .slice(0, SEARCH_TARGET);

  const remainder = filteredCandidates.filter((candidate) => !rankedIdSet.has(candidate.xUserId));
  const combined = [...ranked, ...remainder].slice(0, SEARCH_TARGET);

  return combined;
}

export async function searchAndAddLeads(
  userId: string,
  input: SearchLeadInput,
): Promise<{ leads: Lead[]; project: Project }> {
  const candidates = await collectSearchCandidates(
    input.query,
    input.followerUsername,
    input.minFollowers ?? 0,
  );
  if (candidates.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        (input.minFollowers ?? 0) > 0
          ? `No X profiles found for this query with at least ${input.minFollowers} followers.`
          : "No X profiles found for this query.",
    });
  }

  const project = await resolveProject(userId, input);
  const leadsList = await addProfilesToProject({
    userId,
    projectId: project.id,
    profiles: candidates,
    discoverySource: input.followerUsername ? "followers" : "profile_search",
    discoveryQuery: input.query,
  });

  return { leads: leadsList, project };
}

export async function importAccountNetwork(
  userId: string,
  input: { username: string; projectId?: string; projectName?: string },
): Promise<{ leads: Lead[]; project: Project }> {
  const cleanHandle = input.username.replace(/^@/, "").trim();
  const [seed] = await lookupUsersByUsernames([cleanHandle]);
  if (!seed) throw new TRPCError({ code: "NOT_FOUND", message: "X account not found." });

  const project = await resolveProject(userId, {
    query: `${cleanHandle} network`,
    projectId: input.projectId,
    projectName: input.projectName || `${cleanHandle} network`,
    followerUsername: cleanHandle,
  });

  const candidates = new Map<string, Candidate>();
  let nextFollowers: string | undefined;
  let nextFollowing: string | undefined;
  let fetched = 0;

  while (fetched < NETWORK_TARGET) {
    const [followersPage, followingPage] = await Promise.all([
      getFollowersPage(seed.xUserId, nextFollowers, 250),
      getFollowingPage(seed.xUserId, nextFollowing, 250),
    ]);

    for (const p of followersPage.profiles) addCandidate(candidates, { ...p, samplePosts: [], source: "followers" });
    for (const p of followingPage.profiles) addCandidate(candidates, { ...p, samplePosts: [], source: "following" });

    fetched += followersPage.profiles.length + followingPage.profiles.length;
    nextFollowers = followersPage.nextToken;
    nextFollowing = followingPage.nextToken;

    if ((!nextFollowers && !nextFollowing) || (followersPage.profiles.length === 0 && followingPage.profiles.length === 0)) break;
  }

  const leadsList = await addProfilesToProject({
    userId,
    projectId: project.id,
    profiles: [...candidates.values()],
    discoverySource: "followers",
    discoveryQuery: cleanHandle,
  });

  return { leads: leadsList, project };
}
