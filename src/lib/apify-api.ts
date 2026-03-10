import "server-only";
import type { XProfile } from "@/lib/validations/search";
import {
  X_PROVIDER_RETRY_COUNT,
  X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
  X_PROVIDER_THIRD_PARTY_MIN_RESULTS,
  X_PROVIDER_THIRD_PARTY_SEARCH_EXPANSION_FACTOR,
} from "@/lib/constants";
import type {
  XDataClient,
  XPostSearchResult,
  XProfilesPage,
  XResolvedTweet,
  XUserReference,
} from "@/lib/x-data-types";
import {
  dedupeProfiles,
  extractNestedItems,
  normalizeHandle,
  normalizeScrapedProfile,
  normalizeScrapedTweet,
} from "@/lib/x-scraper-normalizers";
import {
  withRetry,
  requireUsername as requireUsernameBase,
  isString,
  collectNestedTweets,
} from "@/lib/x-scraper-utils";

const APIFY_BASE = "https://api.apify.com/v2";
const APIFY_ADVANCED_SEARCH_ACTOR = "api-ninja/x-twitter-advanced-search";
const APIFY_USER_SCRAPER_ACTOR = "apidojo/twitter-user-scraper";

function requireApifyToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN is not set");
  }
  return token;
}

function toActorPath(actorId: string): string {
  // Docs: actorId is "username~actor-name"; input uses "/" so convert all slashes
  return actorId.replaceAll("/", "~");
}

async function runActor<T>(actorId: string, input: Record<string, unknown>): Promise<T[]> {
  const response = await withRetry(async () => {
    const result = await fetch(
      `${APIFY_BASE}/acts/${toActorPath(actorId)}/run-sync-get-dataset-items?format=json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${requireApifyToken()}`,
        },
        body: JSON.stringify(input),
        cache: "no-store",
      },
    );

    if (result.status === 429 || result.status >= 500) {
      throw new Error(`Apify transient failure (${result.status})`);
    }

    return result;
  }, X_PROVIDER_RETRY_COUNT);

  // 408 = sync run exceeded Apify's 300s hard limit — not retryable
  if (response.status === 408) {
    throw new Error("Apify actor run timed out (408). The actor exceeded the 300s sync limit.");
  }

  if (!response.ok) {
    throw new Error(`Apify request failed (${response.status}): ${await response.text()}`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Apify returned unexpected response shape (expected array, got ${typeof data})`);
  }
  return data as T[];
}

function requireUsername(reference: XUserReference): string {
  return requireUsernameBase(reference, "Apify");
}

function collectProfiles(items: unknown[]): XProfile[] {
  const profiles: XProfile[] = [];
  for (const item of items) {
    const profile = normalizeScrapedProfile(item);
    if (profile) profiles.push(profile);
  }
  return dedupeProfiles(profiles);
}

function collectNestedProfiles(items: unknown[], key: "followers" | "following"): XProfile[] {
  const profiles: XProfile[] = [];

  for (const item of items) {
    for (const nestedItem of extractNestedItems(item, key)) {
      const profile = normalizeScrapedProfile(nestedItem);
      if (profile) profiles.push(profile);
    }
  }

  return dedupeProfiles(profiles);
}

async function runAdvancedSearch(
  query: string,
  maxResults = 50,
): Promise<XPostSearchResult> {
  const items = await runActor<unknown>(APIFY_ADVANCED_SEARCH_ACTOR, {
    searchTerms: query,
    limit: Math.max(10, maxResults),
  });

  const tweets = items
    .map((item) => normalizeScrapedTweet(item))
    .filter((tweet): tweet is XResolvedTweet => Boolean(tweet));
  const users = dedupeProfiles(items
    .map((item) => normalizeScrapedProfile(item))
    .filter((profile): profile is XProfile => profile !== null && Boolean(profile.username)));

  return {
    tweets,
    users,
  };
}

export const apifyClient: XDataClient = {
  provider: "apify",

  async searchUsers(query, maxResults = 25) {
    const result = await runAdvancedSearch(
      query,
      Math.min(100, maxResults * X_PROVIDER_THIRD_PARTY_SEARCH_EXPANSION_FACTOR),
    );
    return result.users
      .sort((a, b) => b.followersCount - a.followersCount)
      .slice(0, maxResults);
  },

  lookupUsersByUsernames(usernames) {
    const handles = [...new Set(usernames.map((username) => normalizeHandle(username)).filter(isString))];
    if (handles.length === 0) return Promise.resolve([]);

    return runActor<unknown>(APIFY_USER_SCRAPER_ACTOR, {
      twitterHandles: handles.map((handle) => `@${handle}`),
      includeTweets: false,
      includeFollowers: false,
      includeFollowing: false,
      resultsLimit: Math.max(handles.length, X_PROVIDER_THIRD_PARTY_MIN_RESULTS),
    }).then(collectProfiles);
  },

  async getFollowersPage(input): Promise<XProfilesPage> {
    const username = requireUsername(input);
    const items = await runActor<unknown>(APIFY_USER_SCRAPER_ACTOR, {
      twitterHandles: [`@${username}`],
      includeTweets: false,
      includeFollowers: true,
      includeFollowing: false,
      resultsLimit: Math.max(
        X_PROVIDER_THIRD_PARTY_MIN_RESULTS,
        input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
      ),
    });

    return {
      profiles: collectNestedProfiles(items, "followers").slice(
        0,
        input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
      ),
    };
  },

  async getFollowingPage(input): Promise<XProfilesPage> {
    const username = requireUsername(input);
    const items = await runActor<unknown>(APIFY_USER_SCRAPER_ACTOR, {
      twitterHandles: [`@${username}`],
      includeTweets: false,
      includeFollowers: false,
      includeFollowing: true,
      resultsLimit: Math.max(
        X_PROVIDER_THIRD_PARTY_MIN_RESULTS,
        input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
      ),
    });

    return {
      profiles: collectNestedProfiles(items, "following").slice(
        0,
        input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
      ),
    };
  },

  searchRecentPosts(query, maxResults = 50) {
    return runAdvancedSearch(query, maxResults);
  },

  searchAllPosts(query, maxResults = 50) {
    // Apify has no recent/archive distinction — delegates to the same search
    return runAdvancedSearch(query, maxResults);
  },

  async getUserTweets(input): Promise<XResolvedTweet[]> {
    const username = requireUsername(input);
    const items = await runActor<unknown>(APIFY_USER_SCRAPER_ACTOR, {
      twitterHandles: [`@${username}`],
      includeTweets: true,
      includeFollowers: false,
      includeFollowing: false,
      resultsLimit: Math.max(X_PROVIDER_THIRD_PARTY_MIN_RESULTS, input.maxResults ?? 30),
    });

    return collectNestedTweets(items).slice(0, input.maxResults ?? 30);
  },
};
