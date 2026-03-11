import "server-only";
import { z } from "zod";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import type {
  XDataClient,
  XDiscoveryInput,
  XDiscoveryProvider,
  XLeadCandidate,
  XProfilesPage,
  XResolvedTweet,
} from "./types";
import { XProviderRuntimeError } from "./types";
import { buildLeadCandidate } from "./discovery";
import { parseJsonResponse } from "./json";
import type { JsonRecord } from "./records";
import { asRecord, asArray } from "./records";
import {
  dedupeProfiles,
  normalizeHandle,
  normalizeScrapedProfile,
  normalizeScrapedTweet,
} from "./normalizers";
import { collectNestedTweets, requireUsername } from "./scraper-utils";

type TavilyResult = {
  url: string;
  title?: string;
  content?: string;
  score?: number;
};

const TavilyResponseSchema = z.object({
  results: z.array(z.object({
    url: z.string().url(),
    title: z.string().optional(),
    content: z.string().optional(),
    score: z.number().optional(),
  })).default([]),
});

const MULTIAGENT_MAX_QUERIES = 3;
const MULTIAGENT_MAX_URLS = 8;
const MULTIAGENT_SCRAPE_CONCURRENCY = 2;
const MULTIAGENT_FETCH_TIMEOUT_MS = 12_000;
const MULTIAGENT_PLANNER_TIMEOUT_MS = 8_000;

const MultiAgentState = Annotation.Root({
  niche: Annotation<string>,
  seedHandle: Annotation<string | undefined>,
  limit: Annotation<number>,
  minFollowers: Annotation<number | undefined>,
  queries: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  urls: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  scraped: Annotation<unknown[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  candidates: Annotation<XLeadCandidate[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
});

const QueryPlanSchema = z.object({
  queries: z.array(z.string()).min(2).max(6),
});

function unsupported(capability: "network"): never {
  throw new XProviderRuntimeError({
    provider: "multiagent",
    capability,
    code: "CAPABILITY_UNSUPPORTED",
    message: `Multi-agent discovery does not support ${capability} operations directly.`,
  });
}

function requireEnv(name: "TAVILY_API_KEY" | "AGENTQL_API_KEY" | "OPENAI_API_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new XProviderRuntimeError({
      provider: "multiagent",
      code: "NOT_CONFIGURED",
      message: `${name} is not set.`,
      missingEnv: [name],
    });
  }
  return value;
}

function getPlannerModel(): ChatOpenAI {
  requireEnv("OPENAI_API_KEY");

  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.MULTIAGENT_PLANNER_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5",
  });
}

function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const query of queries.map((value) => value.trim()).filter(Boolean)) {
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(query);
  }

  return result;
}

export function buildMultiAgentHeuristicQueries(input: XDiscoveryInput): string[] {
  const niche = input.niche.trim();
  const seedHandle = input.seedHandle?.replace(/^@/, "").trim();
  const queries = [
    niche,
    `${niche} founders builders engineers creators on x`,
    `${niche} real people personal accounts on x`,
    seedHandle ? `${niche} accounts similar to @${seedHandle} on x` : "",
    seedHandle ? `people replying to @${seedHandle} about ${niche} on x` : "",
  ];

  return dedupeQueries(queries).slice(0, MULTIAGENT_MAX_QUERIES);
}

function describeUpstreamError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
  return "Unknown upstream failure.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwNetworkFailure(
  capability: "discovery" | "lookup" | "tweets",
  upstream: "OpenAI planner" | "Tavily" | "AgentQL",
  error: unknown,
): never {
  throw new XProviderRuntimeError({
    provider: "multiagent",
    capability,
    code: "UPSTREAM_REQUEST_FAILED",
    message: `${upstream} request failed.${isAbortError(error) ? ` Timed out after waiting for the upstream response.` : ` ${describeUpstreamError(error)}`}`,
  });
}

async function throwResponseFailure(
  capability: "discovery" | "lookup" | "tweets",
  upstream: "Tavily" | "AgentQL",
  response: Response,
): Promise<never> {
  const details = (await response.text()).trim();
  throw new XProviderRuntimeError({
    provider: "multiagent",
    capability,
    code: response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_REQUEST_FAILED",
    message: `${upstream} request failed with status ${response.status}.${details ? ` ${details}` : ""}`,
  });
}

function throwInvalidResponse(
  capability: "discovery" | "lookup" | "tweets",
  upstream: "OpenAI planner" | "Tavily" | "AgentQL",
  details?: string,
): never {
  throw new XProviderRuntimeError({
    provider: "multiagent",
    capability,
    code: "UPSTREAM_INVALID_RESPONSE",
    message: `${upstream} returned a non-JSON response.${details ? ` ${details}` : ""}`,
  });
}

async function parseUpstreamJson(
  response: Response,
  upstream: "Tavily" | "AgentQL",
  capability: "discovery" | "lookup" | "tweets",
): Promise<unknown> {
  try {
    return await parseJsonResponse(
      response,
      (details) => new XProviderRuntimeError({
        provider: "multiagent",
        capability,
        code: "UPSTREAM_INVALID_RESPONSE",
        message: `${upstream} returned a non-JSON response. ${details}`,
      }),
    );
  } catch (error) {
    if (error instanceof XProviderRuntimeError) throw error;
    throwInvalidResponse(capability, upstream);
  }
}

async function withTimeout<T>(
  upstream: "OpenAI planner" | "Tavily" | "AgentQL",
  timeoutMs: number,
  work: () => Promise<T>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const workPromise = work();
  // Avoid unhandled rejections from the losing branch when Promise.race settles first.
  void workPromise.catch(() => undefined);

  try {
    return await Promise.race([
      workPromise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(`${upstream} request timed out after ${timeoutMs}ms.`);
          error.name = "AbortError";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runWorker()),
  );

  return results;
}

async function buildQueries(input: XDiscoveryInput): Promise<string[]> {
  const heuristicQueries = buildMultiAgentHeuristicQueries(input);

  try {
    const planner = getPlannerModel().withStructuredOutput(QueryPlanSchema, { name: "x_query_plan" });
    const result = await withTimeout("OpenAI planner", MULTIAGENT_PLANNER_TIMEOUT_MS, () => planner.invoke([
      "Generate a bounded set of X lead discovery queries.",
      "Keep the list compact, deduplicated, and focused on individual creators in the niche.",
      "Prefer queries that surface profile pages, relevant tweet threads, and seed-handle adjacency.",
      JSON.stringify({
        niche: input.niche,
        seedHandle: input.seedHandle,
        limit: input.limit,
      }),
    ].join("\n")));

    return dedupeQueries([...result.queries, ...heuristicQueries]).slice(0, MULTIAGENT_MAX_QUERIES);
  } catch (error) {
    if (error instanceof XProviderRuntimeError && error.code === "NOT_CONFIGURED") {
      throw error;
    }

    console.warn("[x-provider][multiagent][planner]", JSON.stringify({
      message: describeUpstreamError(error),
      usingHeuristicQueries: true,
    }));

    return heuristicQueries;
  }
}

export function buildTavilySearchRequest(query: string, limit: number): Record<string, unknown> {
  return {
    api_key: requireEnv("TAVILY_API_KEY"),
    query,
    search_depth: "basic",
    include_domains: ["x.com", "twitter.com"],
    max_results: Math.max(5, Math.min(10, limit)),
  };
}

async function searchTavily(query: string, limit: number): Promise<TavilyResult[]> {
  let response: Response;
  try {
    response = await withTimeout("Tavily", MULTIAGENT_FETCH_TIMEOUT_MS, () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MULTIAGENT_FETCH_TIMEOUT_MS);

      return fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildTavilySearchRequest(query, limit)),
        cache: "no-store",
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
    });
  } catch (error) {
    throwNetworkFailure("discovery", "Tavily", error);
  }

  if (!response.ok) {
    await throwResponseFailure("discovery", "Tavily", response);
  }

  try {
    const payload = TavilyResponseSchema.parse(await parseUpstreamJson(response, "Tavily", "discovery"));
    return payload.results;
  } catch (error) {
    if (error instanceof XProviderRuntimeError) throw error;
    throwInvalidResponse("discovery", "Tavily");
  }
}

export function normalizeDiscoveredUrls(results: TavilyResult[], limit: number): string[] {
  const reservedSegments = new Set([
    "compose",
    "explore",
    "hashtag",
    "home",
    "i",
    "intent",
    "login",
    "messages",
    "notifications",
    "search",
    "settings",
    "share",
    "signup",
  ]);
  const urls = new Set<string>();

  for (const result of results) {
    if (!result.url) continue;

    try {
      const url = new URL(result.url);
      if (url.hostname !== "x.com" && url.hostname !== "twitter.com" && url.hostname !== "www.twitter.com") {
        continue;
      }

      const pathSegments = url.pathname.split("/").filter(Boolean);
      const handle = pathSegments[0]?.replace(/^@/, "").trim();
      if (!handle || reservedSegments.has(handle.toLowerCase()) || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
        continue;
      }

      urls.add(`https://x.com/${handle}`);
    } catch {
      continue;
    }

    if (urls.size >= limit) break;
  }

  return [...urls];
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

async function queryAgentQl(
  url: string,
  capability: "discovery" | "lookup" | "tweets",
): Promise<unknown> {
  let response: Response;
  try {
    response = await withTimeout("AgentQL", MULTIAGENT_FETCH_TIMEOUT_MS, () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MULTIAGENT_FETCH_TIMEOUT_MS);

      return fetch("https://api.agentql.com/v1/query-data", {
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
    });
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

async function queryAgentQlBestEffort(
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

export function buildAgentQlQueryRequest(
  url: string,
  mode: "profile" | "profile_with_tweets" | "tweets" = "profile_with_tweets",
): Record<string, unknown> {
  const query =
    mode === "profile"
      ? `
      {
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
        }
      }
    `
      : mode === "tweets"
        ? `
      {
        tweets[] {
          id
          text
          created_at
          likes(integer)
          replies(integer)
          reposts(integer)
          views(integer)
          author_id
        }
      }
    `
        : `
      {
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
        }
        tweets[] {
          id
          text
          created_at
          likes(integer)
          replies(integer)
          reposts(integer)
          views(integer)
          author_id
        }
      }
    `;

  return {
    url,
    query,
    params: {
      wait_for: 0,
      mode: "fast",
      browser_profile: "stealth",
      is_screenshot_enabled: false,
    },
  };
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
    data,
  ];
}

function normalizeProfilesFromPayload(payload: unknown) {
  return dedupeProfiles(
    extractAgentQlItems(payload)
      .map((item) => normalizeScrapedProfile(item))
      .filter((profile): profile is NonNullable<ReturnType<typeof normalizeScrapedProfile>> => Boolean(profile)),
  );
}

function normalizeTweetsFromPayload(payload: unknown): XResolvedTweet[] {
  const directTweets = extractAgentQlItems(payload)
    .map((item) => normalizeScrapedTweet(item))
    .filter((tweet): tweet is XResolvedTweet => Boolean(tweet));

  return directTweets.length > 0 ? directTweets : collectNestedTweets(extractAgentQlItems(payload));
}

const graph = new StateGraph(MultiAgentState)
  .addNode("planner", async (state) => ({
    queries: await buildQueries({
      niche: state.niche,
      seedHandle: state.seedHandle,
      limit: state.limit,
      minFollowers: state.minFollowers,
    }),
  }))
  .addNode("url_finder", async (state) => {
    const results = await Promise.all(
      state.queries.slice(0, MULTIAGENT_MAX_QUERIES).map((query) => searchTavily(query, state.limit)),
    );
    return {
      // Keep fan-out bounded so the graph stays deterministic and avoids the unbounded-loop anti-pattern.
      urls: normalizeDiscoveredUrls(results.flat(), Math.min(MULTIAGENT_MAX_URLS, Math.max(4, state.limit))),
    };
  })
  .addNode("profile_scraper", async (state) => ({
    scraped: (await mapWithConcurrency(
      state.urls.slice(0, Math.min(MULTIAGENT_MAX_URLS, Math.max(4, state.limit))),
      MULTIAGENT_SCRAPE_CONCURRENCY,
      (url) => queryAgentQlBestEffort(url, "discovery"),
    )).filter((payload): payload is NonNullable<typeof payload> => payload !== null),
  }))
  .addNode("aggregator", async (state) => {
    const byHandle = new Map<string, XLeadCandidate>();

    for (const payload of state.scraped) {
      const profiles = normalizeProfilesFromPayload(payload);
      const tweets = normalizeTweetsFromPayload(payload);

      for (const profile of profiles) {
        const candidate = buildLeadCandidate(
          "multiagent",
          state.niche,
          profile,
          tweets.length > 0 ? "post_search" : "profile_search",
          tweets.filter((tweet) => !tweet.authorId || tweet.authorId === profile.xUserId),
        );

        if (candidate.account.followers < (state.minFollowers ?? 0)) continue;
        byHandle.set(candidate.account.handle.toLowerCase(), candidate);
      }
    }

    return {
      candidates: [...byHandle.values()]
        .sort((a, b) => b.account.followers - a.account.followers)
        .slice(0, state.limit * 2),
    };
  })
  .addEdge(START, "planner")
  .addEdge("planner", "url_finder")
  .addEdge("url_finder", "profile_scraper")
  .addEdge("profile_scraper", "aggregator")
  .addEdge("aggregator", END)
  .compile();

export const multiAgentDiscoveryProvider: XDiscoveryProvider = {
  provider: "multiagent",
  async discoverCandidates(input) {
    try {
      const result = await graph.invoke({
        niche: input.niche,
        seedHandle: input.seedHandle,
        limit: Math.max(4, Math.min(input.limit, MULTIAGENT_MAX_URLS)),
        minFollowers: input.minFollowers,
      });

      return result.candidates;
    } catch (error) {
      if (error instanceof XProviderRuntimeError) throw error;
      throw new XProviderRuntimeError({
        provider: "multiagent",
        capability: "discovery",
        code: "UPSTREAM_REQUEST_FAILED",
        message: `Multi-agent workflow failed. ${describeUpstreamError(error)}`,
      });
    }
  },
};

export const multiAgentClient: XDataClient = {
  provider: "multiagent",
  async searchUsers(query, maxResults = 25) {
    const candidates = await multiAgentDiscoveryProvider.discoverCandidates({ niche: query, limit: maxResults });
    return candidates.slice(0, maxResults).map((candidate) => ({
      xUserId: candidate.account.xUserId ?? candidate.account.handle,
      username: candidate.account.handle,
      displayName: candidate.account.name,
      bio: candidate.account.bio,
      followersCount: candidate.account.followers,
      followingCount: candidate.account.following,
      verified: candidate.account.isVerified,
      profileUrl: candidate.account.profileUrl,
      avatarUrl: candidate.account.avatarUrl,
    }));
  },
  async lookupUsersByUsernames(usernames) {
    const handles = [...new Set(usernames.map((username) => normalizeHandle(username)).filter(Boolean))];
    const payloads = await mapWithConcurrency(
      handles,
      MULTIAGENT_SCRAPE_CONCURRENCY,
      (handle) => queryAgentQlBestEffort(`https://x.com/${handle}`, "lookup"),
    );
    return dedupeProfiles(
      payloads
        .filter((payload): payload is NonNullable<typeof payload> => payload !== null)
        .flatMap((payload) => normalizeProfilesFromPayload(payload)),
    );
  },
  getFollowersPage(): Promise<XProfilesPage> {
    unsupported("network");
  },
  getFollowingPage(): Promise<XProfilesPage> {
    unsupported("network");
  },
  async searchRecentPosts(query, maxResults = 50) {
    const candidates = await multiAgentDiscoveryProvider.discoverCandidates({ niche: query, limit: maxResults });
    return {
      tweets: candidates.flatMap((candidate) => candidate.posts.map((post) => ({
        id: post.id ?? `${candidate.account.handle}:${post.createdAt}`,
        text: post.text,
        createdAt: post.createdAt,
        authorId: candidate.account.xUserId,
        likeCount: post.likes,
        replyCount: post.replies,
        repostCount: post.reposts,
        viewCount: post.views ?? 0,
      }))),
      users: candidates.slice(0, maxResults).map((candidate) => ({
        xUserId: candidate.account.xUserId ?? candidate.account.handle,
        username: candidate.account.handle,
        displayName: candidate.account.name,
        bio: candidate.account.bio,
        followersCount: candidate.account.followers,
        followingCount: candidate.account.following,
        verified: candidate.account.isVerified,
        profileUrl: candidate.account.profileUrl,
        avatarUrl: candidate.account.avatarUrl,
      })),
    };
  },
  searchAllPosts(query, maxResults = 50) {
    return multiAgentClient.searchRecentPosts(query, maxResults);
  },
  async getUserTweets(input) {
    const payload = await queryAgentQl(`https://x.com/${requireUsername(input, "Multi-agent")}`, "tweets");
    return normalizeTweetsFromPayload(payload).slice(0, input.maxResults ?? 30);
  },
};
