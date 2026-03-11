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
} from "./types";
import {
  dedupeProfiles,
  extractNestedItems,
  normalizeHandle,
  normalizeScrapedProfile,
  normalizeScrapedTweet,
} from "./normalizers";
import { parseJsonResponse } from "./json";
import {
  withRetry,
  requireUsername as requireUsernameBase,
  isString,
  collectNestedTweets,
} from "./scraper-utils";

const APIFY_BASE = "https://api.apify.com/v2";
const APIFY_ADVANCED_SEARCH_ACTOR = "api-ninja/x-twitter-advanced-search";
const APIFY_USER_SCRAPER_ACTOR = "apidojo/twitter-user-scraper";
const APIFY_DISCOVERY_QUERY_LIMIT = 6;
const APIFY_PROFILE_ENRICH_LIMIT = 30;
const APIFY_RESULT_MULTIPLIER = 4;

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

  const data = await parseJsonResponse<unknown>(
    response,
    (details) => new Error(`Apify returned a non-JSON response. ${details}`),
  );
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

export function buildApifyAdvancedSearchInput(query: string, maxResults = 50): Record<string, unknown> {
  return {
    query,
    numberOfTweets: Math.max(20, maxResults),
  };
}

export function buildApifyDiscoveryQueries(query: string): string[] {
  const trimmed = query.trim();
  const looksStructured = /(^|[\s])(from:|to:|since:|until:|min_|lang:|filter:|\(|\)|"|@)/i.test(trimmed);
  if (looksStructured) {
    return [trimmed];
  }

  const queries = [
    trimmed,
    `"${trimmed}"`,
    `${trimmed} founder`,
    `${trimmed} builder`,
    `${trimmed} engineer`,
    `${trimmed} creator`,
    `${trimmed} operator`,
  ];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of queries) {
    const normalized = item.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= APIFY_DISCOVERY_QUERY_LIMIT) break;
  }

  return result;
}

export function buildApifyUserScraperInput(
  usernames: string[],
  options: {
    getFollowers?: boolean;
    getFollowing?: boolean;
    maxItems?: number;
  } = {},
): Record<string, unknown> {
  const handles = [...new Set(usernames.map((username) => normalizeHandle(username)).filter(isString))];

  return {
    twitterHandles: handles.map((handle) => `@${handle}`),
    getFollowers: options.getFollowers ?? false,
    getFollowing: options.getFollowing ?? false,
    maxItems: Math.max(handles.length, options.maxItems ?? X_PROVIDER_THIRD_PARTY_MIN_RESULTS),
  };
}

async function runAdvancedSearch(
  query: string,
  maxResults = 50,
): Promise<XPostSearchResult> {
  const items = await runActor<unknown>(APIFY_ADVANCED_SEARCH_ACTOR, buildApifyAdvancedSearchInput(query, maxResults));

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

async function runExpandedAdvancedSearch(
  query: string,
  maxResults: number,
): Promise<XPostSearchResult> {
  const resultSets = await Promise.all(
    buildApifyDiscoveryQueries(query).map((variant) =>
      runAdvancedSearch(
        variant,
        Math.min(100, Math.max(20, Math.ceil(maxResults / buildApifyDiscoveryQueries(query).length))),
      ),
    ),
  );

  return {
    tweets: resultSets.flatMap((result) => result.tweets),
    users: dedupeProfiles(resultSets.flatMap((result) => result.users)),
  };
}

async function enrichProfilesFromHandles(
  handles: string[],
  maxItems: number,
): Promise<XProfile[]> {
  const normalized = [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(isString))];
  if (normalized.length === 0) return [];

  const items = await runActor<unknown>(
    APIFY_USER_SCRAPER_ACTOR,
    buildApifyUserScraperInput(
      normalized.slice(0, APIFY_PROFILE_ENRICH_LIMIT),
      { maxItems },
    ),
  );

  return collectProfiles(items);
}

export const apifyClient: XDataClient = {
  provider: "apify",

  async searchUsers(query, maxResults = 25) {
    const expandedLimit = Math.min(120, Math.max(40, maxResults * X_PROVIDER_THIRD_PARTY_SEARCH_EXPANSION_FACTOR));
    const result = await runExpandedAdvancedSearch(query, expandedLimit);
    const enrichedProfiles = await enrichProfilesFromHandles(
      result.users.map((profile) => profile.username),
      X_PROVIDER_THIRD_PARTY_MIN_RESULTS,
    );
    const profilesByHandle = new Map(
      [...result.users, ...enrichedProfiles].map((profile) => [profile.username.toLowerCase(), profile]),
    );

    return [...profilesByHandle.values()]
      .sort((a, b) => b.followersCount - a.followersCount)
      .slice(0, maxResults);
  },

  lookupUsersByUsernames(usernames) {
    const handles = [...new Set(usernames.map((username) => normalizeHandle(username)).filter(isString))];
    if (handles.length === 0) return Promise.resolve([]);

    return runActor<unknown>(
      APIFY_USER_SCRAPER_ACTOR,
      buildApifyUserScraperInput(handles, { maxItems: X_PROVIDER_THIRD_PARTY_MIN_RESULTS }),
    ).then(collectProfiles);
  },

  async getFollowersPage(input): Promise<XProfilesPage> {
    const username = requireUsername(input);
    const items = await runActor<unknown>(
      APIFY_USER_SCRAPER_ACTOR,
      buildApifyUserScraperInput([username], {
        getFollowers: true,
        maxItems: Math.max(
          X_PROVIDER_THIRD_PARTY_MIN_RESULTS,
          input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
        ),
      }),
    );

    return {
      profiles: collectNestedProfiles(items, "followers").slice(
        0,
        input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
      ),
    };
  },

  async getFollowingPage(input): Promise<XProfilesPage> {
    const username = requireUsername(input);
    const items = await runActor<unknown>(
      APIFY_USER_SCRAPER_ACTOR,
      buildApifyUserScraperInput([username], {
        getFollowing: true,
        maxItems: Math.max(
          X_PROVIDER_THIRD_PARTY_MIN_RESULTS,
          input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
        ),
      }),
    );

    return {
      profiles: collectNestedProfiles(items, "following").slice(
        0,
        input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
      ),
    };
  },

  searchRecentPosts(query, maxResults = 50) {
    return runExpandedAdvancedSearch(
      query,
      Math.min(120, Math.max(40, maxResults * X_PROVIDER_THIRD_PARTY_SEARCH_EXPANSION_FACTOR)),
    );
  },

  searchAllPosts(query, maxResults = 50) {
    // Apify has no recent/archive distinction — delegates to the same search
    return runExpandedAdvancedSearch(
      query,
      Math.min(120, Math.max(40, maxResults * X_PROVIDER_THIRD_PARTY_SEARCH_EXPANSION_FACTOR)),
    );
  },

  async getUserTweets(input): Promise<XResolvedTweet[]> {
    const username = requireUsername(input);
    const items = await runActor<unknown>(
      APIFY_USER_SCRAPER_ACTOR,
      buildApifyUserScraperInput([username], {
        maxItems: Math.max(X_PROVIDER_THIRD_PARTY_MIN_RESULTS, input.maxResults ?? 30),
      }),
    );

    return collectNestedTweets(items).slice(0, input.maxResults ?? 30);
  },
};
