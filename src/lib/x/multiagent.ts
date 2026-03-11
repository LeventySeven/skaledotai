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
} from "./types";
import { XProviderRuntimeError } from "./types";
import { buildLeadCandidate } from "./discovery";
import { dedupeProfiles, normalizeHandle } from "./normalizers";
import { mapWithConcurrency, requireUsername } from "./scraper-utils";
import {
  requireEnv,
  describeUpstreamError,
  MULTIAGENT_SCRAPE_CONCURRENCY,
} from "./multiagent-shared";
import {
  searchTavily,
  normalizeDiscoveredUrls,
} from "./tavily";
import {
  queryAgentQl,
  queryAgentQlBestEffort,
  normalizeProfilesFromPayload,
  normalizeTweetsFromPayload,
} from "./agentql";
import type { ProjectRunTraceStep } from "@/lib/validations/project-runs";
import type { SearchRunStreamSnapshot } from "@/lib/validations/search";

// Re-export builder functions used by tests and docs.
export { buildTavilySearchRequest, normalizeDiscoveredUrls } from "./tavily";
export { buildAgentQlQueryRequest } from "./agentql";

const MULTIAGENT_MAX_QUERIES = 3;
const MULTIAGENT_MAX_URLS = 8;
const MULTIAGENT_PLANNER_TIMEOUT_MS = 8_000;
const MULTIAGENT_NODE_TITLES = {
  planner: "Planner",
  url_finder: "URL Finder",
  profile_scraper: "Profile Scraper",
  aggregator: "Aggregator",
} as const;

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

function getPlannerModel(): ChatOpenAI {
  requireEnv("OPENAI_API_KEY");

  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.MULTIAGENT_PLANNER_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5",
  });
}

function getPlannerModelName(): string {
  return process.env.MULTIAGENT_PLANNER_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5";
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

type MultiAgentNodeName = keyof typeof MULTIAGENT_NODE_TITLES;

type MultiAgentStateSnapshot = {
  queries?: string[];
  urls?: string[];
  scraped?: unknown[];
  candidates?: XLeadCandidate[];
};

function isMultiAgentNodeName(value: string): value is MultiAgentNodeName {
  return value in MULTIAGENT_NODE_TITLES;
}

export function toMultiAgentStreamSnapshot(state: MultiAgentStateSnapshot): SearchRunStreamSnapshot {
  return {
    queries: state.queries?.length ?? 0,
    urls: state.urls?.length ?? 0,
    scraped: state.scraped?.length ?? 0,
    candidates: state.candidates?.length ?? 0,
  };
}

export function buildMultiAgentTraceStep(
  nodeName: MultiAgentNodeName,
  update: MultiAgentStateSnapshot,
  index: number,
  minFollowers: number | undefined,
): ProjectRunTraceStep {
  if (nodeName === "planner") {
    const queries = update.queries ?? [];
    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Generated ${queries.length} bounded discovery queries.`,
      status: "success",
      provider: "multiagent",
      model: getPlannerModelName(),
      bullets: queries.slice(0, MULTIAGENT_MAX_QUERIES).map((query, queryIndex) => `Query ${queryIndex + 1}: ${query}`),
      metrics: [
        { label: "Queries", value: queries.length },
      ],
    };
  }

  if (nodeName === "url_finder") {
    const urls = update.urls ?? [];
    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Resolved ${urls.length} candidate X profile URLs.`,
      status: "success",
      provider: "multiagent",
      bullets: urls.slice(0, 3),
      metrics: [
        { label: "URLs", value: urls.length },
      ],
    };
  }

  if (nodeName === "profile_scraper") {
    const scraped = update.scraped ?? [];
    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Scraped ${scraped.length} profile payloads from candidate URLs.`,
      status: "success",
      provider: "multiagent",
      bullets: [
        "AgentQL completed the bounded profile sweep for the discovered URLs.",
      ],
      metrics: [
        { label: "Payloads", value: scraped.length },
      ],
    };
  }

  const candidates = update.candidates ?? [];
  return {
    id: `multiagent-${index}-${nodeName}`,
    title: MULTIAGENT_NODE_TITLES[nodeName],
    summary: `Normalized ${candidates.length} candidate accounts for downstream screening.`,
    status: "success",
    provider: "multiagent",
    bullets: minFollowers && minFollowers > 0
      ? [`Applied the final floor of ${minFollowers}+ followers inside the aggregation pass.`]
      : [],
    metrics: [
      { label: "Candidates", value: candidates.length },
    ],
  };
}

async function withTimeout<T>(
  upstream: "OpenAI planner",
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
      let stepIndex = 0;
      let latestState: MultiAgentStateSnapshot = {};
      const stream = await graph.stream({
        niche: input.niche,
        seedHandle: input.seedHandle,
        limit: Math.max(4, Math.min(input.limit, MULTIAGENT_MAX_URLS)),
        minFollowers: input.minFollowers,
      }, {
        streamMode: ["updates", "values"],
      });

      for await (const [mode, chunk] of stream) {
        if (mode === "values") {
          latestState = chunk as MultiAgentStateSnapshot;
          await input.snapshotRecorder?.(toMultiAgentStreamSnapshot(latestState));
          continue;
        }

        if (mode !== "updates") continue;
        const entries = Object.entries(chunk as Record<string, MultiAgentStateSnapshot>);
        const [nodeName, update] = entries[0] ?? [];
        if (!nodeName || !update || !isMultiAgentNodeName(nodeName)) continue;
        stepIndex += 1;
        await input.traceRecorder?.(buildMultiAgentTraceStep(nodeName, update, stepIndex, input.minFollowers));
      }

      return latestState.candidates ?? [];
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
