import "server-only";
import type { XProfile } from "@/lib/validations/search";
import {
  SEARCH_CANDIDATE_OVERFETCH_FACTOR,
  SEARCH_CANDIDATE_POOL_LIMIT,
  SEARCH_POST_SEARCH_PAGE_LIMIT,
  NETWORK_TARGET,
  X_PROVIDER_NETWORK_PAGE_SIZE,
  X_PROVIDER_POST_SEARCH_LIMIT,
  X_PROVIDER_SEARCH_USERS_LIMIT,
} from "@/lib/constants";
import {
  buildPostSearchQuery,
  buildReplySearchQuery,
  isUnsupportedAuthenticationError,
} from "./api";
import { ensureStrictXLeadCandidate, ensureStrictXProfile } from "./contracts";
import type {
  XDataClient,
  XDiscoveryInput,
  XDiscoveryProvider,
  XLeadCandidate,
  XLeadCandidatePost,
  XPostSearchResult,
  XResolvedTweet,
} from "./types";
import type { XDataProvider } from "./provider";

type CandidateAccumulator = {
  profile: XProfile;
  discoverySource: XLeadCandidate["discoverySource"];
  posts: XLeadCandidatePost[];
};

function getCandidateTarget(limit: number): number {
  return Math.min(SEARCH_CANDIDATE_POOL_LIMIT, limit * SEARCH_CANDIDATE_OVERFETCH_FACTOR);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildCandidateKey(profile: Pick<XProfile, "xUserId" | "username">): string {
  return (profile.xUserId || profile.username).toLowerCase();
}

function normalizePosts(posts: XLeadCandidatePost[]): XLeadCandidatePost[] {
  const seen = new Set<string>();
  const normalized: XLeadCandidatePost[] = [];

  for (const post of posts) {
    const key = post.id ?? `${post.createdAt}:${post.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(post);
  }

  return normalized.slice(0, 5);
}

function toCandidatePost(tweet: Pick<XResolvedTweet, "id" | "text" | "createdAt" | "likeCount" | "replyCount" | "repostCount" | "viewCount">): XLeadCandidatePost {
  return {
    id: tweet.id,
    text: tweet.text,
    createdAt: tweet.createdAt ?? new Date(0).toISOString(),
    likes: tweet.likeCount,
    replies: tweet.replyCount,
    reposts: tweet.repostCount,
    views: tweet.viewCount,
  };
}

export function buildLeadCandidate(
  provider: XDataProvider,
  niche: string,
  profile: XProfile,
  discoverySource: XLeadCandidate["discoverySource"],
  tweets: Array<Pick<XResolvedTweet, "id" | "text" | "createdAt" | "likeCount" | "replyCount" | "repostCount" | "viewCount">>,
): XLeadCandidate {
  const posts = normalizePosts(tweets.map(toCandidatePost));

  return ensureStrictXLeadCandidate({
    source: provider,
    niche,
    discoverySource,
    account: {
      handle: profile.username,
      name: profile.displayName,
      bio: profile.bio,
      followers: profile.followersCount,
      following: profile.followingCount,
      isVerified: profile.verified,
      avatarUrl: profile.avatarUrl,
      profileUrl: profile.profileUrl,
      xUserId: profile.xUserId,
    },
    metrics: {
      avgLikes: average(posts.map((post) => post.likes)),
      avgReplies: average(posts.map((post) => post.replies)),
      avgReposts: average(posts.map((post) => post.reposts)),
      avgViews: average(posts.map((post) => post.views ?? 0)),
      postsSampleSize: posts.length,
    },
    posts,
  });
}

function addCandidate(
  map: Map<string, CandidateAccumulator>,
  profile: XProfile,
  discoverySource: XLeadCandidate["discoverySource"],
  posts: XLeadCandidatePost[],
): void {
  const key = buildCandidateKey(profile);
  const existing = map.get(key);

  if (!existing) {
    map.set(key, {
      profile,
      discoverySource,
      posts: normalizePosts(posts),
    });
    return;
  }

  const mergedPosts = normalizePosts([...existing.posts, ...posts]);
  const preferredProfile = profile.followersCount > existing.profile.followersCount ? profile : existing.profile;
  const preferredSource = existing.discoverySource === "profile_search"
    ? existing.discoverySource
    : discoverySource;

  map.set(key, {
    profile: preferredProfile,
    discoverySource: preferredSource,
    posts: mergedPosts,
  });
}

async function collectPostSearchCandidates(input: {
  map: Map<string, CandidateAccumulator>;
  provider: XDataProvider;
  niche: string;
  discoverySource: XLeadCandidate["discoverySource"];
  targetCount: number;
  search: (nextToken?: string) => Promise<XPostSearchResult>;
}): Promise<void> {
  let nextToken: string | undefined;

  for (let page = 0; page < SEARCH_POST_SEARCH_PAGE_LIMIT && input.map.size < input.targetCount; page += 1) {
    const result = await input.search(nextToken);

    for (const profile of result.users) {
      const posts = result.tweets
        .filter((tweet) => tweet.authorId === profile.xUserId)
        .slice(0, 3)
        .map(toCandidatePost);
      addCandidate(input.map, profile, input.discoverySource, posts);
    }

    nextToken = result.nextToken;
    if (!nextToken || result.tweets.length === 0) break;
  }
}

export async function discoverSearchBackedCandidates(
  client: XDataClient,
  provider: XDataProvider,
  input: XDiscoveryInput,
): Promise<XLeadCandidate[]> {
  const map = new Map<string, CandidateAccumulator>();
  const targetCount = getCandidateTarget(input.limit);

  try {
    for (const profile of await client.searchUsers(input.niche, X_PROVIDER_SEARCH_USERS_LIMIT)) {
      addCandidate(map, profile, "profile_search", []);
    }
  } catch (error) {
    if (provider !== "x-api" || !isUnsupportedAuthenticationError(error)) {
      throw error;
    }
  }

  await collectPostSearchCandidates({
    map,
    provider,
    niche: input.niche,
    discoverySource: "post_search",
    targetCount,
    search: (nextToken) =>
      client.searchRecentPosts(buildPostSearchQuery(input.niche), X_PROVIDER_POST_SEARCH_LIMIT, nextToken),
  });

  if (input.seedHandle) {
    const [seed] = await client.lookupUsersByUsernames([input.seedHandle]);

    if (seed) {
      await collectPostSearchCandidates({
        map,
        provider,
        niche: input.niche,
        discoverySource: "reply_search",
        targetCount,
        search: (nextToken) =>
          client.searchRecentPosts(
            buildReplySearchQuery(input.niche, input.seedHandle as string),
            X_PROVIDER_POST_SEARCH_LIMIT,
            nextToken,
          ),
      });

      let nextToken: string | undefined;
      let fetched = 0;

      while (fetched < NETWORK_TARGET && map.size < targetCount) {
        const page = await client.getFollowersPage({
          userId: seed.xUserId,
          username: seed.username,
          paginationToken: nextToken,
          maxResults: X_PROVIDER_NETWORK_PAGE_SIZE,
        });

        for (const profile of page.profiles) {
          addCandidate(map, profile, "followers", []);
        }

        fetched += page.profiles.length;
        nextToken = page.nextToken;
        if (!nextToken || page.profiles.length === 0) break;
      }
    }
  }

  if (map.size < targetCount && process.env.X_ENABLE_FULL_ARCHIVE === "true") {
    await collectPostSearchCandidates({
      map,
      provider,
      niche: input.niche,
      discoverySource: "post_search",
      targetCount,
      search: (nextToken) =>
        client.searchAllPosts(buildPostSearchQuery(input.niche), X_PROVIDER_POST_SEARCH_LIMIT, nextToken),
    });
  }

  return [...map.values()]
    .map((candidate) => buildLeadCandidate(
      provider,
      input.niche,
      candidate.profile,
      candidate.discoverySource,
      candidate.posts.map((post) => ({
        id: post.id ?? `${post.createdAt}:${post.text}`,
        text: post.text,
        createdAt: post.createdAt,
        likeCount: post.likes,
        replyCount: post.replies,
        repostCount: post.reposts,
        viewCount: post.views ?? 0,
      })),
    ))
    .filter((candidate) => candidate.account.followers >= (input.minFollowers ?? 0))
    .sort((a, b) => b.account.followers - a.account.followers);
}

export function createSearchBackedDiscoveryProvider(
  provider: XDataProvider,
  client: XDataClient,
): XDiscoveryProvider {
  return {
    provider,
    discoverCandidates(input) {
      return discoverSearchBackedCandidates(client, provider, input);
    },
  };
}

export function getCandidateSampleTexts(candidate: XLeadCandidate): string[] {
  return candidate.posts
    .map((post) => post.text)
    .filter((text) => text.trim().length > 0)
    .slice(0, 5);
}

export function toXProfileFromCandidate(candidate: XLeadCandidate): XProfile {
  return ensureStrictXProfile({
    xUserId: candidate.account.xUserId ?? candidate.account.handle,
    username: candidate.account.handle.replace(/^@/, ""),
    displayName: candidate.account.name,
    bio: candidate.account.bio,
    avatarUrl: candidate.account.avatarUrl,
    profileUrl: candidate.account.profileUrl ?? `https://x.com/${candidate.account.handle.replace(/^@/, "")}`,
    followersCount: candidate.account.followers,
    followingCount: candidate.account.following,
    verified: candidate.account.isVerified,
  });
}
