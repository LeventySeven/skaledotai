import "server-only";
import { z } from "zod";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import type {
  XDataClient,
  XDiscoveryInput,
  XDiscoveryProvider,
  XLeadCandidate,
  XPostSearchResult,
  XProfilesPage,
  XResolvedTweet,
  XUserReference,
} from "./types";
import { XProviderRuntimeError } from "./types";
import { buildLeadCandidate } from "./discovery";
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

const MULTIAGENT_MAX_QUERIES = 4;
const MULTIAGENT_MAX_URLS = 18;

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

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

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
    temperature: 0,
  });
}

async function buildQueries(input: XDiscoveryInput): Promise<string[]> {
  const planner = getPlannerModel().withStructuredOutput(QueryPlanSchema, { name: "x_query_plan" });
  const result = await planner.invoke([
    "Generate a bounded set of X lead discovery queries.",
    "Keep the list compact, deduplicated, and focused on individual creators in the niche.",
    "Prefer queries that surface profile pages, relevant tweet threads, and seed-handle adjacency.",
    JSON.stringify({
      niche: input.niche,
      seedHandle: input.seedHandle,
      limit: input.limit,
    }),
  ].join("\n"));

  return result.queries;
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
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildTavilySearchRequest(query, limit)),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Tavily request failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json() as { results?: TavilyResult[] };
  return payload.results ?? [];
}

function normalizeDiscoveredUrls(results: TavilyResult[], limit: number): string[] {
  const urls = new Set<string>();

  for (const result of results) {
    if (!result.url) continue;

    try {
      const url = new URL(result.url);
      if (url.hostname !== "x.com" && url.hostname !== "twitter.com" && url.hostname !== "www.twitter.com") {
        continue;
      }
      urls.add(url.toString());
    } catch {
      continue;
    }

    if (urls.size >= limit) break;
  }

  return [...urls];
}

async function queryAgentQl(url: string): Promise<unknown> {
  const response = await fetch("https://api.agentql.com/v1/query-data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": requireEnv("AGENTQL_API_KEY"),
    },
    body: JSON.stringify(buildAgentQlQueryRequest(url)),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`AgentQL request failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

export function buildAgentQlQueryRequest(url: string): Record<string, unknown> {
  return {
    url,
    query: `
      query XProfileData {
        profile {
          id
          username
          name
          bio
          profileUrl
          avatarUrl
          followersCount
          followingCount
          verified
        }
        tweets(limit: 12) {
          id
          text
          createdAt
          likeCount
          replyCount
          repostCount
          viewCount
          authorId
        }
      }
    `,
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

async function scrapeProfile(reference: XUserReference): Promise<unknown> {
  const username = requireUsername(reference, "Multi-agent");
  return queryAgentQl(`https://x.com/${username}`);
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
      urls: normalizeDiscoveredUrls(results.flat(), Math.max(6, Math.min(MULTIAGENT_MAX_URLS, state.limit * 2))),
    };
  })
  .addNode("profile_scraper", async (state) => ({
    scraped: await Promise.all(
      state.urls.slice(0, Math.max(6, Math.min(MULTIAGENT_MAX_URLS, state.limit * 2))).map((url) => queryAgentQl(url)),
    ),
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
        .slice(0, Math.max(state.limit * 2, state.limit)),
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
    const result = await graph.invoke({
      niche: input.niche,
      seedHandle: input.seedHandle,
      limit: input.limit,
      minFollowers: input.minFollowers,
    });

    return result.candidates;
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
    const payloads = await Promise.all(handles.map((handle) => scrapeProfile({ username: handle })));
    return dedupeProfiles(payloads.flatMap((payload) => normalizeProfilesFromPayload(payload)));
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
    const payload = await scrapeProfile(input);
    return normalizeTweetsFromPayload(payload).slice(0, input.maxResults ?? 30);
  },
};
