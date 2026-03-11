import "server-only";
import type { XDataClient, XDiscoveryProvider, XTweetMetrics } from "./types";
import { XProviderRuntimeError } from "./types";
import type { XDataProvider, XProviderCapability } from "./provider";
import {
  ensureStrictXLeadCandidates,
  ensureStrictXProfiles,
  ensureStrictXResolvedTweets,
} from "./contracts";
import {
  getXDataProviderLabel,
  getXProviderCapabilities,
  getXDataProviderOption,
  supportsXProviderCapability,
} from "./provider";
import {
  getFollowersPage as getXFollowersPage,
  getFollowingPage as getXFollowingPage,
  getUserTweets as getXUserTweets,
  lookupUsersByUsernames as lookupXUsersByUsernames,
  searchAllPosts as searchXAllPosts,
  searchRecentPosts as searchXRecentPosts,
  searchUsers as searchXUsers,
} from "./api";
import { apifyClient } from "./apify";
import { createSearchBackedDiscoveryProvider } from "./discovery";
import { multiAgentClient, multiAgentDiscoveryProvider } from "./multiagent";
import { openRouterClient, openRouterDiscoveryProvider } from "./openrouter";
import { oxylabsClient, oxylabsDiscoveryProvider } from "./oxylabs";

export type XProviderRuntimeStatus = {
  provider: XDataProvider;
  label: string;
  configured: boolean;
  experimental: boolean;
  fullProvider: boolean;
  missingEnv: string[];
  capabilities: ReturnType<typeof getXProviderCapabilities>;
  capabilityNote: string;
};

export type XProviderResolution = {
  requestedProvider: XDataProvider;
  effectiveProvider: XDataProvider;
  capability: XProviderCapability;
  usedFallback: boolean;
};

const X_PROVIDER_ENV_REQUIREMENTS: Record<XDataProvider, string[]> = {
  "x-api": ["X_API_BEARER_TOKEN"],
  apify: ["APIFY_TOKEN"],
  oxylabs: ["OXYLABS_USERNAME", "OXYLABS_PASSWORD", "OXYLABS_FIXTURE_READY"],
  multiagent: ["OPENAI_API_KEY", "TAVILY_API_KEY", "AGENTQL_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

const PROVIDER_COST_ESTIMATES: Record<XDataProvider, Partial<Record<XProviderCapability | "lookup_search", number>>> = {
  "x-api": {
    discovery: 0,
    lookup: 0,
    network: 0,
    tweets: 0,
    lookup_search: 0,
  },
  apify: {
    discovery: 0.012,
    lookup: 0.004,
    network: 0.012,
    tweets: 0.004,
  },
  oxylabs: {
    discovery: 0.018,
    lookup: 0.01,
    tweets: 0.01,
  },
  multiagent: {
    discovery: 0.03,
    lookup: 0.014,
    tweets: 0.014,
  },
  openrouter: {
    discovery: 0.02,
  },
};

const xApiClient: XDataClient = {
  provider: "x-api",

  searchUsers(query, maxResults = 25) {
    return searchXUsers(query, maxResults);
  },

  lookupUsersByUsernames(usernames) {
    return lookupXUsersByUsernames(usernames);
  },

  async getFollowersPage(input) {
    let userId = input.userId;
    if (!userId && input.username) {
      const [profile] = await lookupXUsersByUsernames([input.username]);
      userId = profile?.xUserId;
    }
    if (!userId) {
      throw new Error("X API followers lookup requires a resolvable X user ID.");
    }

    return getXFollowersPage(userId, input.paginationToken, input.maxResults);
  },

  async getFollowingPage(input) {
    let userId = input.userId;
    if (!userId && input.username) {
      const [profile] = await lookupXUsersByUsernames([input.username]);
      userId = profile?.xUserId;
    }
    if (!userId) {
      throw new Error("X API following lookup requires a resolvable X user ID.");
    }

    return getXFollowingPage(userId, input.paginationToken, input.maxResults);
  },

  async searchRecentPosts(query, maxResults = 50, nextToken) {
    const response = await searchXRecentPosts(query, maxResults, nextToken);
    return {
      tweets: response.tweets.map((tweet) => ({
        id: tweet.id,
        authorId: tweet.author_id,
        conversationId: tweet.conversation_id,
        createdAt: tweet.created_at,
        text: tweet.text ?? "",
        viewCount: tweet.public_metrics?.impression_count ?? 0,
        likeCount: tweet.public_metrics?.like_count ?? 0,
        replyCount: tweet.public_metrics?.reply_count ?? 0,
        repostCount: tweet.public_metrics?.retweet_count ?? 0,
      })),
      users: response.users,
      nextToken: response.nextToken,
    };
  },

  async searchAllPosts(query, maxResults = 50, nextToken) {
    const response = await searchXAllPosts(query, maxResults, nextToken);
    return {
      tweets: response.tweets.map((tweet) => ({
        id: tweet.id,
        authorId: tweet.author_id,
        conversationId: tweet.conversation_id,
        createdAt: tweet.created_at,
        text: tweet.text ?? "",
        viewCount: tweet.public_metrics?.impression_count ?? 0,
        likeCount: tweet.public_metrics?.like_count ?? 0,
        replyCount: tweet.public_metrics?.reply_count ?? 0,
        repostCount: tweet.public_metrics?.retweet_count ?? 0,
      })),
      users: response.users,
      nextToken: response.nextToken,
    };
  },

  async getUserTweets(input) {
    let userId = input.userId;
    if (!userId && input.username) {
      const [profile] = await lookupXUsersByUsernames([input.username]);
      userId = profile?.xUserId;
    }
    if (!userId) {
      throw new Error("X API tweet lookup requires a resolvable X user ID.");
    }

    const tweets = await getXUserTweets(userId, input.maxResults);
    return tweets.map((tweet) => ({
      id: tweet.id,
      authorId: tweet.author_id,
      conversationId: tweet.conversation_id,
      createdAt: tweet.created_at,
      text: tweet.text ?? "",
      viewCount: tweet.public_metrics?.impression_count ?? 0,
      likeCount: tweet.public_metrics?.like_count ?? 0,
      replyCount: tweet.public_metrics?.reply_count ?? 0,
      repostCount: tweet.public_metrics?.retweet_count ?? 0,
    }));
  },
};

const RAW_X_DATA_CLIENTS: Record<XDataProvider, XDataClient> = {
  "x-api": xApiClient,
  apify: apifyClient,
  oxylabs: oxylabsClient,
  multiagent: multiAgentClient,
  openrouter: openRouterClient,
};

const X_DISCOVERY_PROVIDERS: Record<XDataProvider, XDiscoveryProvider> = {
  "x-api": createSearchBackedDiscoveryProvider("x-api", xApiClient),
  apify: createSearchBackedDiscoveryProvider("apify", apifyClient),
  oxylabs: oxylabsDiscoveryProvider,
  multiagent: multiAgentDiscoveryProvider,
  openrouter: openRouterDiscoveryProvider,
};

function getMissingProviderEnv(provider: XDataProvider): string[] {
  return X_PROVIDER_ENV_REQUIREMENTS[provider].filter((name) => {
    const value = process.env[name];
    if (name === "OXYLABS_FIXTURE_READY") return value !== "true";
    return !value;
  });
}

function getCapabilityNote(provider: XDataProvider): string {
  const capabilities = getXProviderCapabilities(provider);
  const supported = Object.entries(capabilities)
    .filter(([, enabled]) => enabled)
    .map(([capability]) => capability);
  const unsupported = Object.entries(capabilities)
    .filter(([, enabled]) => !enabled)
    .map(([capability]) => capability);

  if (unsupported.length === 0) {
    return `${supported.join(", ")} handled directly.`;
  }

  return `${supported.join(", ")} handled directly. ${unsupported.join(", ")} are unavailable for this provider.`;
}

function isConfigured(provider: XDataProvider): boolean {
  return getMissingProviderEnv(provider).length === 0;
}

function assertConfigured(provider: XDataProvider): void {
  const missingEnv = getMissingProviderEnv(provider);
  if (missingEnv.length === 0) return;

  throw new XProviderRuntimeError({
    provider,
    code: "NOT_CONFIGURED",
    message: `${getXDataProviderLabel(provider)} is not configured.`,
    missingEnv,
  });
}

function estimateResultCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.profiles)) return record.profiles.length;
    if (Array.isArray(record.tweets)) return record.tweets.length;
    if (Array.isArray(record.users)) return record.users.length;
    if (Array.isArray(record.candidates)) return record.candidates.length;
  }
  return 0;
}

function estimateExternalCost(provider: XDataProvider, capability: XProviderCapability, resultCount: number): number {
  const unit = PROVIDER_COST_ESTIMATES[provider][capability] ?? 0;
  return Number((unit * Math.max(resultCount, 1)).toFixed(4));
}

function sanitizeProfilesPage(
  page: Awaited<ReturnType<XDataClient["getFollowersPage"]>>,
  scope: string,
): Awaited<ReturnType<XDataClient["getFollowersPage"]>> {
  return {
    ...page,
    profiles: ensureStrictXProfiles(page.profiles, `${scope}.profiles`),
  };
}

function sanitizePostSearchResult(
  result: Awaited<ReturnType<XDataClient["searchRecentPosts"]>>,
  scope: string,
): Awaited<ReturnType<XDataClient["searchRecentPosts"]>> {
  return {
    ...result,
    tweets: ensureStrictXResolvedTweets(result.tweets, `${scope}.tweets`),
    users: ensureStrictXProfiles(result.users, `${scope}.users`),
  };
}

function getErrorCode(error: unknown): string {
  if (error instanceof XProviderRuntimeError) return error.code;
  if (error instanceof Error && error.name) return error.name;
  return "UNKNOWN";
}

function logProviderCall(input: {
  requestedProvider: XDataProvider;
  effectiveProvider: XDataProvider;
  capability: XProviderCapability;
  method: string;
  usedFallback: boolean;
  latencyMs: number;
  resultCount: number;
  estimatedExternalCost: number;
  errorCode?: string;
}): void {
  console.info("[x-provider]", JSON.stringify(input));
}

function instrumentMethod<TArgs extends unknown[], TResult>(
  method: string,
  requestedProvider: XDataProvider,
  effectiveProvider: XDataProvider,
  capability: XProviderCapability,
  usedFallback: boolean,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    const startedAt = Date.now();

    try {
      const result = await fn(...args);
      const resultCount = estimateResultCount(result);
      logProviderCall({
        requestedProvider,
        effectiveProvider,
        capability,
        method,
        usedFallback,
        latencyMs: Date.now() - startedAt,
        resultCount,
        estimatedExternalCost: estimateExternalCost(effectiveProvider, capability, resultCount),
      });
      return result;
    } catch (error) {
      logProviderCall({
        requestedProvider,
        effectiveProvider,
        capability,
        method,
        usedFallback,
        latencyMs: Date.now() - startedAt,
        resultCount: 0,
        estimatedExternalCost: estimateExternalCost(effectiveProvider, capability, 0),
        errorCode: getErrorCode(error),
      });
      throw error;
    }
  };
}

function instrumentClient(
  client: XDataClient,
  resolution: XProviderResolution,
): XDataClient {
  return {
    provider: client.provider,
    searchUsers: instrumentMethod(
      "searchUsers",
      resolution.requestedProvider,
      resolution.effectiveProvider,
      resolution.capability,
      resolution.usedFallback,
      async (...args) =>
        ensureStrictXProfiles(
          await client.searchUsers(...args),
          `${client.provider}.searchUsers`,
        ),
    ),
    lookupUsersByUsernames: instrumentMethod(
      "lookupUsersByUsernames",
      resolution.requestedProvider,
      resolution.effectiveProvider,
      resolution.capability,
      resolution.usedFallback,
      async (...args) =>
        ensureStrictXProfiles(
          await client.lookupUsersByUsernames(...args),
          `${client.provider}.lookupUsersByUsernames`,
        ),
    ),
    getFollowersPage: instrumentMethod(
      "getFollowersPage",
      resolution.requestedProvider,
      resolution.effectiveProvider,
      resolution.capability,
      resolution.usedFallback,
      async (...args) =>
        sanitizeProfilesPage(
          await client.getFollowersPage(...args),
          `${client.provider}.getFollowersPage`,
        ),
    ),
    getFollowingPage: instrumentMethod(
      "getFollowingPage",
      resolution.requestedProvider,
      resolution.effectiveProvider,
      resolution.capability,
      resolution.usedFallback,
      async (...args) =>
        sanitizeProfilesPage(
          await client.getFollowingPage(...args),
          `${client.provider}.getFollowingPage`,
        ),
    ),
    searchRecentPosts: instrumentMethod(
      "searchRecentPosts",
      resolution.requestedProvider,
      resolution.effectiveProvider,
      resolution.capability,
      resolution.usedFallback,
      async (...args) =>
        sanitizePostSearchResult(
          await client.searchRecentPosts(...args),
          `${client.provider}.searchRecentPosts`,
        ),
    ),
    searchAllPosts: instrumentMethod(
      "searchAllPosts",
      resolution.requestedProvider,
      resolution.effectiveProvider,
      resolution.capability,
      resolution.usedFallback,
      async (...args) =>
        sanitizePostSearchResult(
          await client.searchAllPosts(...args),
          `${client.provider}.searchAllPosts`,
        ),
    ),
    getUserTweets: instrumentMethod(
      "getUserTweets",
      resolution.requestedProvider,
      resolution.effectiveProvider,
      resolution.capability,
      resolution.usedFallback,
      async (...args) =>
        ensureStrictXResolvedTweets(
          await client.getUserTweets(...args),
          `${client.provider}.getUserTweets`,
        ),
    ),
  };
}

function instrumentDiscoveryProvider(
  provider: XDiscoveryProvider,
  requestedProvider: XDataProvider,
): XDiscoveryProvider {
  return {
    provider: provider.provider,
    discoverCandidates: instrumentMethod(
      "discoverCandidates",
      requestedProvider,
      provider.provider,
      "discovery",
      provider.provider !== requestedProvider,
      async (...args) =>
        ensureStrictXLeadCandidates(
          await provider.discoverCandidates(...args),
          `${provider.provider}.discoverCandidates`,
        ),
    ),
  };
}

export function getXProviderRuntimeStatuses(): XProviderRuntimeStatus[] {
  return (Object.keys(RAW_X_DATA_CLIENTS) as XDataProvider[]).map((provider) => {
    const capabilities = getXProviderCapabilities(provider);
    const missingEnv = getMissingProviderEnv(provider);
    const option = getXDataProviderOption(provider);

    return {
      provider,
      label: option.label,
      configured: missingEnv.length === 0,
      experimental: Boolean(option.experimental),
      fullProvider: Object.values(capabilities).every(Boolean),
      missingEnv,
      capabilities,
      capabilityNote: getCapabilityNote(provider),
    };
  });
}

export function getXDataClient(provider: XDataProvider): XDataClient {
  return RAW_X_DATA_CLIENTS[provider] ?? xApiClient;
}

export function resolveXProviderForCapability(
  requestedProvider: XDataProvider,
  capability: XProviderCapability,
): XProviderResolution {
  assertConfigured(requestedProvider);

  if (supportsXProviderCapability(requestedProvider, capability)) {
    return {
      requestedProvider,
      effectiveProvider: requestedProvider,
      capability,
      usedFallback: false,
    };
  }

  throw new XProviderRuntimeError({
    provider: requestedProvider,
    capability,
    code: "CAPABILITY_UNSUPPORTED",
    message: `${getXDataProviderLabel(requestedProvider)} does not support ${capability}. This workflow now uses only the exact selected provider.`,
  });
}

export function getXDataClientForCapability(
  requestedProvider: XDataProvider,
  capability: XProviderCapability,
): { client: XDataClient; resolution: XProviderResolution } {
  const resolution = resolveXProviderForCapability(requestedProvider, capability);
  const client = instrumentClient(getXDataClient(resolution.effectiveProvider), resolution);
  return { client, resolution };
}

export function getXDiscoveryProvider(
  requestedProvider: XDataProvider,
): { provider: XDiscoveryProvider; resolution: XProviderResolution } {
  assertConfigured(requestedProvider);

  const resolution: XProviderResolution = {
    requestedProvider,
    effectiveProvider: requestedProvider,
    capability: "discovery",
    usedFallback: false,
  };

  return {
    provider: instrumentDiscoveryProvider(X_DISCOVERY_PROVIDERS[requestedProvider], requestedProvider),
    resolution,
  };
}

export function mapTweetsToMetrics(
  tweets: Array<{
    id: string;
    text: string;
    viewCount: number;
    likeCount: number;
    replyCount: number;
    repostCount: number;
  }>,
): XTweetMetrics[] {
  return tweets.map((tweet) => ({
    id: tweet.id,
    text: tweet.text,
    viewCount: tweet.viewCount,
    likeCount: tweet.likeCount,
    replyCount: tweet.replyCount,
    repostCount: tweet.repostCount,
  }));
}

export function isXProviderConfigured(provider: XDataProvider): boolean {
  return isConfigured(provider);
}
