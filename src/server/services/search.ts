import "server-only";
import { TRPCError } from "@trpc/server";
import { rankProfilesForQuery } from "@/lib/openai";
import type { Lead } from "@/lib/validations/leads";
import type { Project } from "@/lib/validations/projects";
import type { SearchLeadInput, XProfile } from "@/lib/validations/search";
import {
  getXDataClient,
  buildPostSearchQuery,
  buildReplySearchQuery,
  isUnsupportedAuthenticationError,
} from "@/lib/x";
import type { XDataProvider } from "@/lib/x";
import {
  NETWORK_TARGET,
  SEARCH_TARGET,
  X_PROVIDER_NETWORK_PAGE_SIZE,
  X_PROVIDER_POST_SEARCH_LIMIT,
  X_PROVIDER_SEARCH_USERS_LIMIT,
} from "@/lib/constants";
import { addProfilesToProject } from "./leads";
import { createProject, getProjectById } from "./projects";

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
  provider: XDataProvider = "x-api",
): Promise<Candidate[]> {
  const client = getXDataClient(provider);
  const map = new Map<string, Candidate>();

  try {
    for (const profile of await client.searchUsers(query, X_PROVIDER_SEARCH_USERS_LIMIT)) {
      addCandidate(map, { ...profile, samplePosts: [], source: "profile_search" });
    }
  } catch (error) {
    if (provider !== "x-api" || !isUnsupportedAuthenticationError(error)) {
      throw error;
    }
  }

  const recentPosts = await client.searchRecentPosts(buildPostSearchQuery(query), X_PROVIDER_POST_SEARCH_LIMIT);
  for (const profile of recentPosts.users) {
    const samplePosts = recentPosts.tweets
      .filter((tweet) => tweet.authorId === profile.xUserId)
      .map((tweet) => tweet.text)
      .filter(Boolean)
      .slice(0, 3);
    addCandidate(map, { ...profile, samplePosts, source: "post_search" });
  }

  if (followerUsername) {
    const [seed] = await client.lookupUsersByUsernames([followerUsername]);
    if (seed) {
      const replies = await client.searchRecentPosts(
        buildReplySearchQuery(query, followerUsername),
        X_PROVIDER_POST_SEARCH_LIMIT,
      );
      for (const profile of replies.users) {
        const samplePosts = replies.tweets
          .filter((tweet) => tweet.authorId === profile.xUserId)
          .map((tweet) => tweet.text)
          .filter(Boolean)
          .slice(0, 3);
        addCandidate(map, { ...profile, samplePosts, source: "reply_search" });
      }

      let nextToken: string | undefined;
      let fetched = 0;
      while (fetched < NETWORK_TARGET) {
        const page = await client.getFollowersPage({
          userId: seed.xUserId,
          username: seed.username,
          paginationToken: nextToken,
          maxResults: X_PROVIDER_NETWORK_PAGE_SIZE,
        });
        for (const p of page.profiles) addCandidate(map, { ...p, samplePosts: [], source: "followers" });
        fetched += page.profiles.length;
        nextToken = page.nextToken;
        if (!nextToken || page.profiles.length === 0) break;
      }
    }
  }

  if (map.size < SEARCH_TARGET && process.env.X_ENABLE_FULL_ARCHIVE === "true") {
    const allPosts = await client.searchAllPosts(buildPostSearchQuery(query), X_PROVIDER_POST_SEARCH_LIMIT);
    for (const profile of allPosts.users) {
      const samplePosts = allPosts.tweets
        .filter((tweet) => tweet.authorId === profile.xUserId)
        .map((tweet) => tweet.text)
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
  provider: XDataProvider = "x-api",
): Promise<{ leads: Lead[]; project: Project }> {
  const candidates = await collectSearchCandidates(
    input.query,
    input.followerUsername,
    input.minFollowers ?? 0,
    provider,
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
  provider: XDataProvider = "x-api",
): Promise<{ leads: Lead[]; project: Project }> {
  const client = getXDataClient(provider);
  const cleanHandle = input.username.replace(/^@/, "").trim();
  const [seed] = await client.lookupUsersByUsernames([cleanHandle]);
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
      client.getFollowersPage({
        userId: seed.xUserId,
        username: seed.username,
        paginationToken: nextFollowers,
        maxResults: X_PROVIDER_NETWORK_PAGE_SIZE,
      }),
      client.getFollowingPage({
        userId: seed.xUserId,
        username: seed.username,
        paginationToken: nextFollowing,
        maxResults: X_PROVIDER_NETWORK_PAGE_SIZE,
      }),
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
