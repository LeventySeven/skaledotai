import "@/lib/server-runtime";
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
import { apifyClient } from "./apify";
import { twitterApiClient } from "./twitterapi";
import { xApiClient } from "./x-api";
import { createSearchBackedDiscoveryProvider } from "./discovery";
import { multiAgentClient, multiAgentDiscoveryProvider } from "./multiagent";
import { openRouterClient, openRouterDiscoveryProvider } from "./openrouter";

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
  twitterapi: ["TWITTERAPI_IO_KEY"],
  apify: ["APIFY_TOKEN"],
  multiagent: ["OPENAI_API_KEY", "TAVILY_API_KEY", "AGENTQL_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

const X_PROVIDER_CAPABILITY_FALLBACKS: Partial<Record<XProviderCapability, XDataProvider[]>> = {
  discovery: ["x-api"],
  lookup: ["x-api"],
  network: ["x-api"],
  tweets: ["x-api"],
};

const PROVIDER_COST_ESTIMATES: Record<XDataProvider, Partial<Record<XProviderCapability, number>>> = {
  "x-api": {
    discovery: 0,
    lookup: 0,
    network: 0,
    tweets: 0,
  },
  twitterapi: {
    lookup: 0.001,
  },
  apify: {
    discovery: 0.012,
    lookup: 0.004,
    network: 0.012,
    tweets: 0.004,
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

const RAW_X_DATA_CLIENTS: Record<XDataProvider, XDataClient> = {
  "x-api": xApiClient,
  twitterapi: twitterApiClient,
  apify: apifyClient,
  multiagent: multiAgentClient,
  openrouter: openRouterClient,
};

const X_DISCOVERY_PROVIDERS: Partial<Record<XDataProvider, XDiscoveryProvider>> = {
  "x-api": createSearchBackedDiscoveryProvider("x-api", xApiClient),
  apify: createSearchBackedDiscoveryProvider("apify", apifyClient),
  multiagent: multiAgentDiscoveryProvider,
  openrouter: openRouterDiscoveryProvider,
};

function getMissingProviderEnv(provider: XDataProvider): string[] {
  return X_PROVIDER_ENV_REQUIREMENTS[provider].filter((name) => !process.env[name]);
}

function getCapabilityNote(provider: XDataProvider): string {
  const capabilities = getXProviderCapabilities(provider);
  const supported = Object.entries(capabilities)
    .filter(([, enabled]) => enabled)
    .map(([capability]) => capability);
  const unsupported = Object.entries(capabilities)
    .filter(([, enabled]) => !enabled)
    .map(([capability]) => capability);
  const fallbackable = unsupported.filter((capability) => {
    const fallbackProviders = X_PROVIDER_CAPABILITY_FALLBACKS[capability as XProviderCapability] ?? [];
    return fallbackProviders.some((fallbackProvider) =>
      fallbackProvider !== provider
      && supportsXProviderCapability(fallbackProvider, capability as XProviderCapability)
      && isConfigured(fallbackProvider),
    );
  });
  const unavailable = unsupported.filter((capability) => !fallbackable.includes(capability));

  if (unsupported.length === 0) {
    return `${supported.join(", ")} handled directly.`;
  }

  const parts = [
    supported.length > 0 ? `${supported.join(", ")} handled directly.` : "",
    fallbackable.length > 0 ? `${fallbackable.join(", ")} fall back to X API.` : "",
    unavailable.length > 0 ? `${unavailable.join(", ")} are unavailable for this provider.` : "",
  ].filter(Boolean);

  return parts.join(" ");
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
    lookupUsersByIds: instrumentMethod(
      "lookupUsersByIds",
      resolution.requestedProvider,
      resolution.effectiveProvider,
      resolution.capability,
      resolution.usedFallback,
      async (...args) =>
        ensureStrictXProfiles(
          await client.lookupUsersByIds(...args),
          `${client.provider}.lookupUsersByIds`,
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

  const fallbackProviders = X_PROVIDER_CAPABILITY_FALLBACKS[capability] ?? [];
  for (const fallbackProvider of fallbackProviders) {
    if (
      fallbackProvider !== requestedProvider
      && supportsXProviderCapability(fallbackProvider, capability)
      && isConfigured(fallbackProvider)
    ) {
      return {
        requestedProvider,
        effectiveProvider: fallbackProvider,
        capability,
        usedFallback: true,
      };
    }
  }

  throw new XProviderRuntimeError({
    provider: requestedProvider,
    capability,
    code: "CAPABILITY_UNSUPPORTED",
    message: `${getXDataProviderLabel(requestedProvider)} does not support ${capability}, and no configured fallback provider is available.`,
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
  const resolution = resolveXProviderForCapability(requestedProvider, "discovery");
  const provider = X_DISCOVERY_PROVIDERS[resolution.effectiveProvider];
  if (!provider) {
    throw new XProviderRuntimeError({
      provider: requestedProvider,
      capability: "discovery",
      code: "CAPABILITY_UNSUPPORTED",
      message: `${getXDataProviderLabel(requestedProvider)} does not support discovery.`,
    });
  }

  return {
    provider: instrumentDiscoveryProvider(provider, requestedProvider),
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
