import "server-only";
import type { XProfile } from "@/lib/validations/search";
import {
  PHANTOMBUSTER_POLL_INTERVAL_MS,
  PHANTOMBUSTER_MAX_WAIT_MS,
  X_PROVIDER_RETRY_COUNT,
  X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
  X_PROVIDER_THIRD_PARTY_SEARCH_EXPANSION_FACTOR,
} from "@/lib/constants";
import type {
  XDataClient,
  XPostSearchResult,
  XProfilesPage,
  XResolvedTweet,
  XUserReference,
} from "./types";
import { XProviderRuntimeError } from "./types";
import {
  dedupeProfiles,
  normalizeHandle,
  normalizeScrapedProfile,
  normalizeScrapedTweet,
} from "./normalizers";
import {
  sleep,
  withRetry,
  requireUsername as requireUsernameBase,
  isString,
  collectNestedTweets,
} from "./scraper-utils";

const PHANTOM_BASE = "https://api.phantombuster.com/api/v2";

function requirePhantomToken(): string {
  const token = process.env.PHANTOM_TOKEN;
  if (!token) {
    throw new XProviderRuntimeError({
      provider: "phantombuster",
      code: "NOT_CONFIGURED",
      message: "PHANTOM_TOKEN is not set.",
      missingEnv: ["PHANTOM_TOKEN"],
    });
  }
  return token;
}

function requireAgentId(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new XProviderRuntimeError({
      provider: "phantombuster",
      code: "NOT_CONFIGURED",
      message: `${name} is not set.`,
      missingEnv: [name],
    });
  }
  return value;
}

function getAgentIdHint(envName: string, agentId: string): string {
  return [
    `PhantomBuster could not find agent "${agentId}" for ${envName}.`,
    "This env var must be the workspace agent ID from your Phantom console URL (`/phantoms/{id}`), not the public automation/store URL (`/automations/...`).",
  ].join(" ");
}

export function toPhantomBusterRuntimeError(errorText: string, envName?: string, agentId?: string): XProviderRuntimeError {
  const normalized = errorText.trim();

  if (/agent not found/i.test(normalized)) {
    return new XProviderRuntimeError({
      provider: "phantombuster",
      capability: "discovery",
      code: "UPSTREAM_REQUEST_FAILED",
      message: envName && agentId
        ? `${getAgentIdHint(envName, agentId)} PhantomBuster response: ${normalized}`
        : `PhantomBuster agent was not found. ${normalized}`,
    });
  }

  if (/timed out/i.test(normalized)) {
    return new XProviderRuntimeError({
      provider: "phantombuster",
      capability: "discovery",
      code: "UPSTREAM_REQUEST_FAILED",
      message: `PhantomBuster request timed out. ${normalized}`,
    });
  }

  return new XProviderRuntimeError({
    provider: "phantombuster",
    capability: "discovery",
    code: "UPSTREAM_REQUEST_FAILED",
    message: `PhantomBuster request failed. ${normalized}`,
  });
}

async function requestPhantom<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await withRetry(async () => {
    const result = await fetch(`${PHANTOM_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Phantombuster-Key": requirePhantomToken(),
        "X-Phantombuster-Key-1": requirePhantomToken(),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    if (result.status === 429 || result.status >= 500) {
      throw new Error(`PhantomBuster transient failure (${result.status})`);
    }

    return result;
  }, X_PROVIDER_RETRY_COUNT);

  if (!response.ok) {
    const details = await response.text();
    throw toPhantomBusterRuntimeError(
      `(${response.status}): ${details}`,
    );
  }

  return response.json() as Promise<T>;
}

function toProfileUrl(username: string): string {
  return `https://x.com/${username}`;
}

function normalizeResultPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.result)) return record.result;
    if (Array.isArray(record.items)) return record.items;
  }
  return [];
}

function isContainerDone(value: unknown): boolean {
  const state = typeof value === "string" ? value.toLowerCase() : "";
  return ["done", "finished", "success", "succeeded"].includes(state);
}

function isContainerError(value: unknown): boolean {
  const state = typeof value === "string" ? value.toLowerCase() : "";
  return ["error", "failed", "failure", "launch error"].includes(state);
}

async function waitForContainer(containerId: string): Promise<void> {
  const deadline = Date.now() + PHANTOMBUSTER_MAX_WAIT_MS;

  for (;;) {
    const status = await requestPhantom<Record<string, unknown>>(`/containers/fetch?id=${encodeURIComponent(containerId)}`);
    const state = status.state ?? status.status;

    if (isContainerDone(state)) return;
    if (isContainerError(state)) {
      throw new Error("PhantomBuster container failed");
    }

    if (Date.now() >= deadline) {
      throw new Error(`PhantomBuster container timed out after ${PHANTOMBUSTER_MAX_WAIT_MS / 1000}s`);
    }

    await sleep(PHANTOMBUSTER_POLL_INTERVAL_MS);
  }
}

async function launchPhantom(agentEnvName: string, input: Record<string, unknown>): Promise<unknown[]> {
  const agentId = requireAgentId(agentEnvName);

  const launch = await requestPhantom<Record<string, unknown>>("/agents/launch", {
    method: "POST",
    body: JSON.stringify({
      id: agentId,
      bonusArgument: input,
    }),
  }).catch((error) => {
    if (error instanceof XProviderRuntimeError && /agent was not found|agent not found/i.test(error.message)) {
      throw toPhantomBusterRuntimeError(error.message, agentEnvName, agentId);
    }
    throw error;
  });

  const containerId = typeof launch.containerId === "string"
    ? launch.containerId
    : typeof launch.id === "string"
      ? launch.id
      : undefined;

  if (!containerId) {
      throw new Error("PhantomBuster launch did not return a container ID.");
  }

  await waitForContainer(containerId);

  const resultObject = await requestPhantom<unknown>(`/containers/fetch-result-object?id=${encodeURIComponent(containerId)}`);
  return normalizeResultPayload(resultObject);
}

function requireUsername(reference: XUserReference): string {
  return requireUsernameBase(reference, "PhantomBuster");
}

function collectProfiles(items: unknown[]): XProfile[] {
  return dedupeProfiles(items
    .map((item) => normalizeScrapedProfile(item))
    .filter((profile): profile is XProfile => Boolean(profile)));
}

function collectSearchResult(items: unknown[]): XPostSearchResult {
  const tweets = items
    .map((item) => normalizeScrapedTweet(item))
    .filter((tweet): tweet is XResolvedTweet => Boolean(tweet));
  const users = dedupeProfiles(items
    .map((item) => normalizeScrapedProfile(item))
    .filter((profile): profile is XProfile => Boolean(profile)));

  return { tweets, users };
}

export const phantomBusterClient: XDataClient = {
  provider: "phantombuster",

  async searchUsers(query, maxResults = 25) {
    const result = await launchPhantom(
      "PHANTOMBUSTER_TWITTER_SEARCH_EXPORT_ID",
      { search: query, limit: Math.min(100, maxResults * X_PROVIDER_THIRD_PARTY_SEARCH_EXPANSION_FACTOR) },
    );

    return collectSearchResult(result).users
      .sort((a, b) => b.followersCount - a.followersCount)
      .slice(0, maxResults);
  },

  async lookupUsersByUsernames(usernames) {
    const handles = [...new Set(usernames.map((username) => normalizeHandle(username)).filter(isString))];
    if (handles.length === 0) return [];

    const result = await launchPhantom(
      "PHANTOMBUSTER_TWITTER_PROFILE_SCRAPER_ID",
      {
        profileUrls: handles.map((handle) => toProfileUrl(handle)),
        numberOfTweets: 0,
      },
    );

    return collectProfiles(result);
  },

  async getFollowersPage(input): Promise<XProfilesPage> {
    const username = requireUsername(input);
    const result = await launchPhantom(
      "PHANTOMBUSTER_TWITTER_FOLLOWER_COLLECTOR_ID",
      {
        profileUrls: [toProfileUrl(username)],
        maxFollowers: input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
        addFullProfile: true,
      },
    );

    return {
      profiles: collectProfiles(result).slice(0, input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT),
    };
  },

  async getFollowingPage(input): Promise<XProfilesPage> {
    const username = requireUsername(input);
    const result = await launchPhantom(
      "PHANTOMBUSTER_TWITTER_FOLLOWING_COLLECTOR_ID",
      {
        profileUrls: [toProfileUrl(username)],
        maxFollowing: input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT,
        addFullProfile: true,
      },
    );

    return {
      profiles: collectProfiles(result).slice(0, input.maxResults ?? X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT),
    };
  },

  async searchRecentPosts(query, maxResults = 50) {
    const result = await launchPhantom(
      "PHANTOMBUSTER_TWITTER_SEARCH_EXPORT_ID",
      { search: query, limit: maxResults },
    );

    return collectSearchResult(result);
  },

  searchAllPosts(query, maxResults = 50) {
    // PhantomBuster has no recent/archive distinction — delegates to the same search
    return phantomBusterClient.searchRecentPosts(query, maxResults);
  },

  async getUserTweets(input): Promise<XResolvedTweet[]> {
    const username = requireUsername(input);
    const result = await launchPhantom(
      "PHANTOMBUSTER_TWITTER_PROFILE_SCRAPER_ID",
      {
        profileUrls: [toProfileUrl(username)],
        numberOfTweets: input.maxResults ?? 30,
      },
    );

    return collectNestedTweets(result).slice(0, input.maxResults ?? 30);
  },
};
