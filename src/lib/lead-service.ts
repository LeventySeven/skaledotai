import "server-only";
import {
  addProfilesToProject,
  createProject,
  getProfileById,
  getProjectById,
  upsertPostStats,
  updateProjectInfluencer,
} from "@/lib/db";
import { extractTopicsAndPriority, rankProfilesForQuery } from "@/lib/openai";
import type { Lead, PostStats, Project, SearchLeadInput, XProfile } from "@/lib/types";
import {
  buildPostSearchQuery,
  buildReplySearchQuery,
  getFollowersPage,
  getFollowingPage,
  getUserTweets,
  lookupUsersByUsernames,
  mapTweetsToMetrics,
  searchAllPosts,
  searchRecentPosts,
  searchUsers,
} from "@/lib/x-api";

const SEARCH_TARGET = 40;
const NETWORK_TARGET = 1000;

type Candidate = XProfile & {
  samplePosts: string[];
  source: "profile_search" | "post_search" | "reply_search" | "followers" | "following";
};

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
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
    if (!existing) throw new Error("Project not found.");
    return existing;
  }

  return createProject({
    userId,
    name: input.projectName?.trim() || input.query.trim(),
    query: input.query.trim(),
    seedUsername: input.followerUsername?.replace(/^@/, ""),
  });
}

async function collectSearchCandidates(
  query: string,
  followerUsername?: string,
): Promise<Candidate[]> {
  const map = new Map<string, Candidate>();

  const profileMatches = await searchUsers(query, 25);
  for (const profile of profileMatches) {
    addCandidate(map, { ...profile, samplePosts: [], source: "profile_search" });
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

      let nextFollowers: string | undefined;
      let followersFetched = 0;
      while (followersFetched < NETWORK_TARGET) {
        const page = await getFollowersPage(seed.xUserId, nextFollowers, 250);
        for (const profile of page.profiles) {
          addCandidate(map, { ...profile, samplePosts: [], source: "followers" });
        }
        followersFetched += page.profiles.length;
        nextFollowers = page.nextToken;
        if (!nextFollowers || page.profiles.length === 0) break;
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

  const rankedIds = await rankProfilesForQuery(query, [...map.values()]);
  const ranked = rankedIds
    .map((id) => map.get(id))
    .filter((c): c is Candidate => Boolean(c))
    .slice(0, SEARCH_TARGET);

  return ranked.length > 0 ? ranked : [...map.values()].slice(0, SEARCH_TARGET);
}

export async function searchAndAddLeads(
  userId: string,
  input: SearchLeadInput,
): Promise<{ leads: Lead[]; project: Project }> {
  const project = await resolveProject(userId, input);
  const candidates = await collectSearchCandidates(input.query, input.followerUsername);
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
  input: {
    username: string;
    projectId?: string;
    projectName?: string;
  },
): Promise<{ leads: Lead[]; project: Project }> {
  const cleanHandle = input.username.replace(/^@/, "").trim();
  const [seed] = await lookupUsersByUsernames([cleanHandle]);
  if (!seed) throw new Error("X account not found.");

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

    for (const profile of followersPage.profiles) {
      addCandidate(candidates, { ...profile, samplePosts: [], source: "followers" });
    }
    for (const profile of followingPage.profiles) {
      addCandidate(candidates, { ...profile, samplePosts: [], source: "following" });
    }

    fetched += followersPage.profiles.length + followingPage.profiles.length;
    nextFollowers = followersPage.nextToken;
    nextFollowing = followingPage.nextToken;

    if (
      (!nextFollowers && !nextFollowing) ||
      (followersPage.profiles.length === 0 && followingPage.profiles.length === 0)
    ) {
      break;
    }
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

export async function refreshProfileStats(input: {
  profileId: string;
  crmId?: string;
  niche?: string;
}): Promise<{ stats: PostStats; priority: "P0" | "P1" }> {
  const profile = await getProfileById(input.profileId);
  if (!profile) throw new Error("Lead profile not found.");
  if (!profile.xUserId) throw new Error("Lead has no X user ID.");

  const tweets = await getUserTweets(profile.xUserId, 30);
  if (tweets.length === 0) {
    throw new Error("No recent X posts found for this account.");
  }

  const metrics = mapTweetsToMetrics(tweets);

  const ai = await extractTopicsAndPriority(
    input.niche,
    profile.bio,
    metrics.map((t) => t.text).filter(Boolean),
  );

  const stats = await upsertPostStats({
    profileId: input.profileId,
    postCount: metrics.length,
    avgViews: avg(metrics.map((t) => t.viewCount)),
    avgLikes: avg(metrics.map((t) => t.likeCount)),
    avgReplies: avg(metrics.map((t) => t.replyCount)),
    avgReposts: avg(metrics.map((t) => t.repostCount)),
    topTopics: ai.topics,
  });

  if (input.crmId) {
    await updateProjectInfluencer(input.crmId, { priority: ai.priority });
  }

  return { stats, priority: ai.priority };
}
