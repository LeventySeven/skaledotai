import "server-only";
import { TRPCError } from "@trpc/server";
import { screenProfilesForLeadSearch } from "@/lib/openai";
import type { Lead } from "@/lib/validations/leads";
import type { Project } from "@/lib/validations/projects";
import type { SearchLeadInput, XProfile } from "@/lib/validations/search";
import { getXDataClient } from "@/lib/x/client";
import {
  buildPostSearchQuery,
  buildReplySearchQuery,
  isUnsupportedAuthenticationError,
} from "@/lib/x";
import type { XDataProvider } from "@/lib/x";
import {
  NETWORK_TARGET,
  SEARCH_CANDIDATE_OVERFETCH_FACTOR,
  SEARCH_CANDIDATE_POOL_LIMIT,
  SEARCH_POST_SEARCH_PAGE_LIMIT,
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

function getCandidateTarget(targetLeadCount: number): number {
  return Math.min(SEARCH_CANDIDATE_POOL_LIMIT, targetLeadCount * SEARCH_CANDIDATE_OVERFETCH_FACTOR);
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

async function collectPostSearchCandidates(
  map: Map<string, Candidate>,
  targetCount: number,
  source: Candidate["source"],
  search: (nextToken?: string) => Promise<{
    tweets: Array<{ authorId?: string; text: string }>;
    users: XProfile[];
    nextToken?: string;
  }>,
): Promise<void> {
  let nextToken: string | undefined;

  for (let page = 0; page < SEARCH_POST_SEARCH_PAGE_LIMIT && map.size < targetCount; page++) {
    const result = await search(nextToken);
    for (const profile of result.users) {
      const samplePosts = result.tweets
        .filter((tweet) => tweet.authorId === profile.xUserId)
        .map((tweet) => tweet.text)
        .filter(Boolean)
        .slice(0, 3);
      addCandidate(map, { ...profile, samplePosts, source });
    }

    nextToken = result.nextToken;
    if (!nextToken || result.tweets.length === 0) break;
  }
}

function buildScreeningPool(candidates: Candidate[], targetLeadCount: number): Candidate[] {
  const poolLimit = getCandidateTarget(targetLeadCount);
  const headCount = Math.min(candidates.length, Math.max(targetLeadCount, Math.ceil(poolLimit * 0.6)));
  const seen = new Set<string>();
  const pool: Candidate[] = [];

  function push(candidate: Candidate): void {
    if (seen.has(candidate.xUserId) || pool.length >= poolLimit) return;
    seen.add(candidate.xUserId);
    pool.push(candidate);
  }

  for (const candidate of candidates.slice(0, headCount)) push(candidate);
  for (const candidate of candidates.filter((candidate) => candidate.samplePosts.length > 0)) push(candidate);
  for (const candidate of candidates.filter((candidate) => candidate.source === "profile_search" || candidate.source === "reply_search")) {
    push(candidate);
  }
  for (const candidate of candidates) push(candidate);

  return pool;
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
  targetLeadCount: number,
  followerUsername?: string,
  minFollowers = 0,
  provider: XDataProvider = "x-api",
): Promise<Candidate[]> {
  const client = getXDataClient(provider);
  const map = new Map<string, Candidate>();
  const candidateTarget = getCandidateTarget(targetLeadCount);

  try {
    for (const profile of await client.searchUsers(query, X_PROVIDER_SEARCH_USERS_LIMIT)) {
      addCandidate(map, { ...profile, samplePosts: [], source: "profile_search" });
    }
  } catch (error) {
    if (provider !== "x-api" || !isUnsupportedAuthenticationError(error)) {
      throw error;
    }
  }

  await collectPostSearchCandidates(
    map,
    candidateTarget,
    "post_search",
    (nextToken) => client.searchRecentPosts(buildPostSearchQuery(query), X_PROVIDER_POST_SEARCH_LIMIT, nextToken),
  );

  if (followerUsername) {
    const [seed] = await client.lookupUsersByUsernames([followerUsername]);
    if (seed) {
      await collectPostSearchCandidates(
        map,
        candidateTarget,
        "reply_search",
        (nextToken) => client.searchRecentPosts(
          buildReplySearchQuery(query, followerUsername),
          X_PROVIDER_POST_SEARCH_LIMIT,
          nextToken,
        ),
      );

      let nextToken: string | undefined;
      let fetched = 0;
      while (fetched < NETWORK_TARGET && map.size < candidateTarget) {
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

  if (map.size < candidateTarget && process.env.X_ENABLE_FULL_ARCHIVE === "true") {
    await collectPostSearchCandidates(
      map,
      candidateTarget,
      "post_search",
      (nextToken) => client.searchAllPosts(buildPostSearchQuery(query), X_PROVIDER_POST_SEARCH_LIMIT, nextToken),
    );
  }

  const filteredCandidates = [...map.values()]
    .filter((candidate) => candidate.followersCount >= minFollowers)
    .sort(byFollowersDesc);

  const screeningPool = buildScreeningPool(filteredCandidates, targetLeadCount);
  const selectedIds = await screenProfilesForLeadSearch(query, screeningPool, targetLeadCount);
  const candidatesById = new Map(filteredCandidates.map((candidate) => [candidate.xUserId, candidate]));

  return selectedIds
    .map((id) => candidatesById.get(id))
    .filter((candidate): candidate is Candidate => Boolean(candidate));
}

export async function searchAndAddLeads(
  userId: string,
  input: SearchLeadInput,
  provider: XDataProvider = "x-api",
): Promise<{ leads: Lead[]; project: Project }> {
  const targetLeadCount = input.targetLeadCount ?? SEARCH_TARGET;
  const candidates = await collectSearchCandidates(
    input.query,
    targetLeadCount,
    input.followerUsername,
    input.minFollowers ?? 0,
    provider,
  );
  if (candidates.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        (input.minFollowers ?? 0) > 0
          ? `No relevant X leads found for this query with at least ${input.minFollowers} followers.`
          : "No relevant X leads found for this query.",
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
