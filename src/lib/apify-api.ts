import "server-only";
import type { XProfile } from "@/lib/validations/search";
import {
  X_PROVIDER_RETRY_BASE_DELAY_MS,
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
  return actorId.replace("/", "~");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt >= retries) throw error;
      await sleep(2 ** (attempt - 1) * X_PROVIDER_RETRY_BASE_DELAY_MS);
    }
  }
}

async function runActor<T>(actorId: string, input: Record<string, unknown>): Promise<T[]> {
  const response = await withRetry(async () => {
    const result = await fetch(
      `${APIFY_BASE}/acts/${toActorPath(actorId)}/run-sync-get-dataset-items?token=${requireApifyToken()}&format=json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

  if (!response.ok) {
    throw new Error(`Apify request failed (${response.status}): ${await response.text()}`);
  }

  return response.json() as Promise<T[]>;
}

function requireUsername(reference: XUserReference): string {
  const username = normalizeHandle(reference.username);
  if (!username) {
    throw new Error("Apify operations require a username-backed X profile.");
  }
  return username;
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
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

function collectNestedTweets(items: unknown[]): XResolvedTweet[] {
  const tweets: XResolvedTweet[] = [];

  for (const item of items) {
    const nestedTweets = extractNestedItems(item, "tweets");
    const sourceTweets = nestedTweets.length > 0 ? nestedTweets : [item];

    for (const candidate of sourceTweets) {
      const tweet = normalizeScrapedTweet(candidate, { excludeRepliesAndRetweets: true });
      if (tweet) tweets.push(tweet);
    }
  }

  return tweets;
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
    .filter((profile): profile is XProfile => Boolean(profile)));

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
