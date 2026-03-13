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

const AGENTQL_QUERIES: Record<"profile" | "profile_with_tweets" | "tweets", string> = {
  profile: `{${AGENTQL_PROFILE_FRAGMENT}\n}`,
  tweets: `{${AGENTQL_TWEETS_FRAGMENT}\n}`,
  profile_with_tweets: `{${AGENTQL_PROFILE_FRAGMENT}${AGENTQL_TWEETS_FRAGMENT}\n}`,
};

export function buildAgentQlQueryRequest(
  url: string,
  mode: "profile" | "profile_with_tweets" | "tweets" = "profile_with_tweets",
): Record<string, unknown> {
  return {
    url,
    query: AGENTQL_QUERIES[mode],
    params: {
      wait_for: 0,
      mode: "fast",
      browser_profile: "stealth",
      is_screenshot_enabled: false,
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

export async function queryAgentQl(
  url: string,
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
      body: JSON.stringify(buildAgentQlQueryRequest(
        url,
        capability === "tweets" ? "tweets" : "profile",
      )),
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

function extractAgentQlItems(value: unknown): unknown[] {
  const record = asRecord(value);
  if (!record) return [];

  const data = asRecord(record.data) ?? record;
  const maybeProfile = asRecord((data as JsonRecord).profile);
  const maybeTweets = asArray((data as JsonRecord).tweets);

  return [
    ...(maybeProfile ? [maybeProfile] : []),
    ...maybeTweets,
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
