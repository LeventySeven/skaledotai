import "@/lib/server-runtime";
import type { XProfile } from "@/lib/validations/search";
import type { XResolvedTweet } from "./types";
import { XProviderRuntimeError } from "./types";
import type { JsonRecord } from "./records";
import { asRecord, asArray } from "./records";
import {
  dedupeProfiles,
  normalizeScrapedProfile,
  normalizeScrapedTweet,
} from "./normalizers";
import { collectNestedTweets } from "./scraper-utils";
import {
  requireEnv,
  describeUpstreamError,
  throwNetworkFailure,
  throwResponseFailure,
  throwInvalidResponse,
  parseUpstreamJson,
  MULTIAGENT_FETCH_TIMEOUT_MS,
} from "./multiagent-shared";

const AGENTQL_PROFILE_FRAGMENT = `
  profile {
    id
    username
    name
    bio
    profile_url
    avatar_url
    followers_count(integer)
    following_count(integer)
    verified(boolean)
  }`;

const AGENTQL_TWEETS_FRAGMENT = `
  tweets[] {
    id
    text
    created_at
    likes(integer)
    replies(integer)
    reposts(integer)
    views(integer)
    author_id
  }`;

/** Extract multiple user profiles from X People search results page */
const AGENTQL_PEOPLE_SEARCH_FRAGMENT = `
  people_results[] {
    username
    name
    bio
    profile_url
    avatar_url
    followers_count(integer)
    following_count(integer)
    verified(boolean)
  }`;

const AGENTQL_QUERIES: Record<"profile" | "profile_with_tweets" | "tweets" | "people_search", string> = {
  profile: `{${AGENTQL_PROFILE_FRAGMENT}\n}`,
  tweets: `{${AGENTQL_TWEETS_FRAGMENT}\n}`,
  profile_with_tweets: `{${AGENTQL_PROFILE_FRAGMENT}${AGENTQL_TWEETS_FRAGMENT}\n}`,
  people_search: `{${AGENTQL_PEOPLE_SEARCH_FRAGMENT}\n}`,
};

export function buildAgentQlQueryRequest(
  url: string,
  mode: "profile" | "profile_with_tweets" | "tweets" | "people_search" = "profile_with_tweets",
): Record<string, unknown> {
  return {
    url,
    query: AGENTQL_QUERIES[mode],
    params: {
      // People search pages need more time to load results
      wait_for: mode === "people_search" ? 5 : 5,
      mode: mode === "people_search" ? "standard" : "fast",
      browser_profile: "stealth",
      is_screenshot_enabled: false,
      // Scroll to load more results on search pages
      ...(mode === "people_search" ? { is_scroll_to_bottom_enabled: true } : {}),
    },
  };
}

function isRetryableAgentQlFailure(error: unknown): boolean {
  return error instanceof XProviderRuntimeError
    && error.provider === "multiagent"
    && (
      error.code === "UPSTREAM_INVALID_RESPONSE"
      || error.code === "UPSTREAM_RATE_LIMITED"
      || error.code === "UPSTREAM_REQUEST_FAILED"
    );
}

function warnPartialAgentQlFailure(url: string, capability: "discovery" | "lookup" | "tweets", error: unknown): void {
  console.warn("[x-provider][multiagent][agentql]", JSON.stringify({
    capability,
    url,
    message: describeUpstreamError(error),
  }));
}

async function queryAgentQlOnce(
  url: string,
  mode: "profile" | "profile_with_tweets" | "tweets" | "people_search",
  capability: "discovery" | "lookup" | "tweets",
): Promise<unknown> {
  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MULTIAGENT_FETCH_TIMEOUT_MS);

    response = await fetch("https://api.agentql.com/v1/query-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": requireEnv("AGENTQL_API_KEY"),
      },
      body: JSON.stringify(buildAgentQlQueryRequest(url, mode)),
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
  } catch (error) {
    throwNetworkFailure(capability, "AgentQL", error);
  }

  if (!response.ok) {
    await throwResponseFailure(capability, "AgentQL", response);
  }

  try {
    return await parseUpstreamJson(response, "AgentQL", capability);
  } catch (error) {
    if (error instanceof XProviderRuntimeError) throw error;
    throwInvalidResponse(capability, "AgentQL");
  }
}

export async function queryAgentQl(
  url: string,
  capability: "discovery" | "lookup" | "tweets",
): Promise<unknown> {
  const mode = capability === "tweets" ? "tweets" : "profile";

  // Try once; on timeout, retry once with a longer pause
  try {
    return await queryAgentQlOnce(url, mode, capability);
  } catch (error) {
    if (!(error instanceof XProviderRuntimeError) || error.code !== "UPSTREAM_REQUEST_FAILED") throw error;
    // Wait 2s before retry
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return await queryAgentQlOnce(url, mode, capability);
  }
}

export async function queryAgentQlBestEffort(
  url: string,
  capability: "discovery" | "lookup",
): Promise<unknown | null> {
  try {
    return await queryAgentQl(url, capability);
  } catch (error) {
    if (!isRetryableAgentQlFailure(error)) throw error;
    warnPartialAgentQlFailure(url, capability, error);
    return null;
  }
}

/**
 * Scrape X's People search page to find profiles matching a query.
 * URL format: https://x.com/search?q={query}&src=typed_query&f=user
 *
 * Supports X search operators:
 *   min_faves:100  — only users whose posts have at least 100 likes (filters out inactive/low-quality)
 *
 * This is the BEST source for finding relevant leads because X's People tab
 * only returns users whose name/bio match the query — no articles, no listicles.
 * One page typically yields 10-20 profiles.
 */
export async function scrapeXPeopleSearch(
  searchTerm: string,
  options?: { minFaves?: number },
): Promise<unknown | null> {
  const queryParts = [searchTerm];
  if (options?.minFaves && options.minFaves > 0) {
    queryParts.push(`min_faves:${options.minFaves}`);
  }
  const fullQuery = queryParts.join(" ");
  const url = `https://x.com/search?q=${encodeURIComponent(fullQuery)}&src=typed_query&f=user`;
  try {
    return await queryAgentQlOnce(url, "people_search", "discovery");
  } catch (error) {
    if (!(error instanceof XProviderRuntimeError) || error.code !== "UPSTREAM_REQUEST_FAILED") {
      warnPartialAgentQlFailure(url, "discovery", error);
      return null;
    }
    // Retry once with delay
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    try {
      return await queryAgentQlOnce(url, "people_search", "discovery");
    } catch (retryError) {
      warnPartialAgentQlFailure(url, "discovery", retryError);
      return null;
    }
  }
}

function extractAgentQlItems(value: unknown): unknown[] {
  const record = asRecord(value);
  if (!record) return [];

  const data = asRecord(record.data) ?? record;
  const maybeProfile = asRecord((data as JsonRecord).profile);
  const maybeTweets = asArray((data as JsonRecord).tweets);
  // Support people_results[] from X People search pages
  const maybePeopleResults = asArray((data as JsonRecord).people_results);

  return [
    ...(maybeProfile ? [maybeProfile] : []),
    ...maybeTweets,
    ...(maybePeopleResults ?? []),
  ];
}

export function normalizeProfilesFromPayload(payload: unknown): XProfile[] {
  return dedupeProfiles(
    extractAgentQlItems(payload)
      .map((item) => normalizeScrapedProfile(item))
      .filter((profile): profile is NonNullable<ReturnType<typeof normalizeScrapedProfile>> => Boolean(profile)),
  );
}

export function normalizeTweetsFromPayload(payload: unknown): XResolvedTweet[] {
  const directTweets = extractAgentQlItems(payload)
    .map((item) => normalizeScrapedTweet(item))
    .filter((tweet): tweet is XResolvedTweet => Boolean(tweet));

  return directTweets.length > 0 ? directTweets : collectNestedTweets(extractAgentQlItems(payload));
}
