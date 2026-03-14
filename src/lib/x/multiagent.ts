import "@/lib/server-runtime";
import { z } from "zod";
import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { expandLeadSearchQueries } from "@/lib/openai";
import type { XProfile } from "@/lib/validations/search";
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
import { lookupUsersByIds as lookupXUsersByIds } from "./api";
import { lookupTwitterApiUsersByIds } from "./twitterapi";
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
import {
  MULTIAGENT_NODE_TITLES,
  MULTIAGENT_MAX_QUERIES,
  type MultiAgentNodeName,
  type MultiAgentSubagentName,
  type MultiAgentRecoveryState,
  type MultiAgentStopReason,
  type MultiAgentPlannerMode,
  type MultiAgentErrorRecord,
  type ScrapedPayload,
  type ScoredCandidate,
  type SelectionEvidence,
  type PlannerResult,
  type PlannerAgentInput,
  type SourceFanoutAgentInput,
  type ScraperAgentInput,
} from "./multiagent-types";
import {
  type MultiAgentStateSnapshot,
  isMultiAgentNodeName,
  buildMultiAgentTraceStep,
  toMultiAgentStreamSnapshot,
} from "./multiagent-trace";

// Re-export trace utilities for consumers.
export { toMultiAgentStreamSnapshot, buildMultiAgentTraceStep } from "./multiagent-trace";
export type { MultiAgentStateSnapshot } from "./multiagent-trace";

// Re-export builder functions used by tests and docs.
export { buildTavilySearchRequest, normalizeDiscoveredUrls } from "./tavily";
export { buildAgentQlQueryRequest } from "./agentql";

const MULTIAGENT_MIN_QUERIES = 3;
const MULTIAGENT_MIN_URLS = 12;
const MULTIAGENT_MAX_URLS = 96;
const MULTIAGENT_MIN_BATCH_SIZE = 3;
const MULTIAGENT_MAX_BATCH_SIZE = 12;
const DEFAULT_MULTIAGENT_PLANNER_TIMEOUT_MS = 45_000;
const MIN_MULTIAGENT_PLANNER_TIMEOUT_MS = 5_000;
const MAX_MULTIAGENT_PLANNER_TIMEOUT_MS = 120_000;

const mergeUniqueStrings = (left: string[], right: string[]): string[] => {
  const merged = [...left];
  const seen = new Set(left.map((value) => value.toLowerCase()));

  for (const value of right) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }

  return merged;
};

const mergeScrapedPayloads = (left: ScrapedPayload[], right: ScrapedPayload[]): ScrapedPayload[] => {
  const byUrl = new Map(left.map((item) => [item.url, item]));
  for (const item of right) byUrl.set(item.url, item);
  return [...byUrl.values()];
};

const mergeScoredCandidates = (left: ScoredCandidate[], right: ScoredCandidate[]): ScoredCandidate[] => {
  const byHandle = new Map(left.map((item) => [
    item.candidate.account.handle.replace(/^@/, "").toLowerCase(),
    item,
  ]));

  for (const item of right) {
    const key = item.candidate.account.handle.replace(/^@/, "").toLowerCase();
    const existing = byHandle.get(key);
    if (!existing || item.score > existing.score || item.candidate.account.followers > existing.candidate.account.followers) {
      byHandle.set(key, item);
    }
  }

  return [...byHandle.values()];
};

const mergeCandidates = (left: XLeadCandidate[], right: XLeadCandidate[]): XLeadCandidate[] => {
  const byHandle = new Map(left.map((item) => [
    item.account.handle.replace(/^@/, "").toLowerCase(),
    item,
  ]));

  for (const item of right) {
    const key = item.account.handle.replace(/^@/, "").toLowerCase();
    const existing = byHandle.get(key);
    if (!existing || item.account.followers > existing.account.followers) {
      byHandle.set(key, item);
    }
  }

  return [...byHandle.values()];
};

const MultiAgentState = Annotation.Root({
  niche: Annotation<string>,
  seedHandle: Annotation<string | undefined>,
  limit: Annotation<number>,
  minFollowers: Annotation<number | undefined>,
  targetLeadCount: Annotation<number>,
  goalCount: Annotation<number>,
  attempt: Annotation<number>,
  maxAttempts: Annotation<number>,
  queryBudget: Annotation<number>,
  scrapeBatchSize: Annotation<number>,
  plannerMode: Annotation<MultiAgentPlannerMode>({
    reducer: (_left, right) => right,
    default: () => "initial",
  }),
  recoveryState: Annotation<MultiAgentRecoveryState | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  stopReason: Annotation<MultiAgentStopReason | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  activeNode: Annotation<MultiAgentNodeName | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  activeSubagent: Annotation<MultiAgentSubagentName | string | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  completedNodes: Annotation<MultiAgentNodeName[]>({
    reducer: (left, right) => mergeUniqueStrings(left, right) as MultiAgentNodeName[],
    default: () => [],
  }),
  userGoals: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  roleTerms: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  bioTerms: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  geoHints: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  antiGoals: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  plannedQueries: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  currentQueries: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  candidateUrls: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  processedUrls: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  repairUrls: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  scraped: Annotation<ScrapedPayload[]>({
    reducer: mergeScrapedPayloads,
    default: () => [],
  }),
  scored: Annotation<ScoredCandidate[]>({
    reducer: mergeScoredCandidates,
    default: () => [],
  }),
  candidates: Annotation<XLeadCandidate[]>({
    reducer: mergeCandidates,
    default: () => [],
  }),
  errors: Annotation<MultiAgentErrorRecord[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  firstPassCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  lastAttemptYield: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  plannerFallbackUsed: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  traceQuery: Annotation<string | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  traceBatchUrls: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  hydratedCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  hydrationTools: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  recoveryNote: Annotation<string | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
});

const QueryPlanSchema = z.object({
  queries: z.array(z.string()).min(2).max(8),
}).strict();

const GoalInterpretationSchema = z.object({
  roleTerms: z.array(z.string()).default([]),
  bioTerms: z.array(z.string()).default([]),
  geoHints: z.array(z.string()).default([]),
  antiGoals: z.array(z.string()).default([]),
  userGoals: z.array(z.string()).default([]),
}).strict();

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
    reasoning: {
      effort: "medium",
    },
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

type GoalInterpretation = z.infer<typeof GoalInterpretationSchema>;

function buildHeuristicGoalInterpretation(input: {
  niche: string;
  seedHandle?: string;
}): GoalInterpretation {
  const keywords = extractKeywords(input.niche);
  const geoHints = input.niche.match(/\b(?:in|from|based in|located in)\s+([A-Za-z][A-Za-z\s]+)/gi)
    ?.map((match) => match.replace(/\b(?:in|from|based in|located in)\s+/i, "").trim())
    .filter(Boolean) ?? [];

  return {
    roleTerms: keywords.slice(0, 5),
    bioTerms: keywords.slice(0, 6),
    geoHints,
    antiGoals: ["support", "official", "newsroom", "brand account", "large corporation", "celebrity", "media outlet", "institution"],
    userGoals: [
      `Find individual X accounts aligned with ${input.niche}.`,
      input.seedHandle ? `Prefer accounts adjacent to @${input.seedHandle.replace(/^@/, "")}.` : "",
    ].filter(Boolean),
  };
}

async function interpretLeadSearchGoals(input: {
  niche: string;
  seedHandle?: string;
}): Promise<GoalInterpretation> {
  const fallback = buildHeuristicGoalInterpretation(input);

  try {
    const interpreter = getPlannerModel().withStructuredOutput(GoalInterpretationSchema, { name: "lead_goal_interpretation" });
    const result = await withTimeout("OpenAI planner", resolveMultiAgentPlannerTimeoutMs(), () => interpreter.invoke([
      "Interpret this lead-search request for a multi-agent X discovery system.",
      "",
      "WHAT IS A LEAD: A lead is a real person or small reachable company that you could actually DM or email for outreach. Think founders, indie hackers, solo creators, small startup teams, freelancers, consultants, engineers, designers, operators — people who would realistically read and respond to a cold message.",
      "",
      "NOT A LEAD: Large corporations (Apple, Google, Nike), celebrity/public-figure accounts with millions of followers, brand accounts, official support/news accounts, bots, parody accounts, media outlets, and institutions. These are NOT leads because they won't respond to outreach.",
      "",
      "Extract target role terms, useful bio terms, optional geo hints, anti-goals, and short user goals.",
      "Favor individual creators, operators, founders, designers, engineers, and practitioners over brand/support/news accounts.",
      "Add anti-goals for large companies, corporations, official brand accounts, and celebrity accounts.",
      JSON.stringify(input),
    ].join("\n")));

    return {
      roleTerms: dedupeQueries(result.roleTerms ?? []),
      bioTerms: dedupeQueries(result.bioTerms ?? []),
      geoHints: dedupeQueries(result.geoHints ?? []),
      antiGoals: dedupeQueries(result.antiGoals ?? []),
      userGoals: dedupeQueries(result.userGoals ?? []),
    };
  } catch (error) {
    console.warn("[x-provider][multiagent][goal-interpreter]", JSON.stringify({
      message: describeUpstreamError(error),
      usingHeuristicInterpretation: true,
    }));
    return fallback;
  }
}

function buildGoogleDorkQueries(input: {
  niche: string;
  seedHandle?: string;
  attempt: number;
  queryBudget: number;
  interpretation: GoalInterpretation;
}): string[] {
  const roleBlock = input.interpretation.roleTerms.slice(0, 3).join('" OR "');
  const bioBlock = input.interpretation.bioTerms.slice(0, 4).join('" OR "');
  const geoBlock = input.interpretation.geoHints[0]?.trim();
  const cleanSeed = input.seedHandle?.replace(/^@/, "").trim();

  return dedupeQueries([
    `site:x.com "${input.niche}" ${roleBlock ? `("${roleBlock}")` : ""}`,
    `site:twitter.com "${input.niche}" ${bioBlock ? `("${bioBlock}")` : ""}`,
    roleBlock ? `site:x.com (${input.interpretation.roleTerms.slice(0, 3).join(" OR ")}) "${input.niche}"` : "",
    geoBlock ? `site:x.com "${input.niche}" "${geoBlock}"` : "",
    cleanSeed ? `site:x.com "${input.niche}" ("@${cleanSeed}" OR "similar to @${cleanSeed}")` : "",
    input.attempt >= 2 ? `site:x.com "${input.niche}" ("bio" OR "designer" OR "founder" OR "engineer")` : "",
    input.attempt >= 3 ? `site:x.com "${input.niche}" ("shipping" OR "building" OR "threads")` : "",
    input.attempt >= 4 ? `site:twitter.com "${input.niche}" ("creator" OR "operator" OR "maker")` : "",
  ]).slice(0, input.queryBudget);
}

function resolveMultiAgentQueryBudget(input: Pick<XDiscoveryInput, "goalCount" | "targetLeadCount" | "limit">): number {
  const requestedCount = input.goalCount ?? input.targetLeadCount ?? input.limit;
  if (requestedCount >= 220) return 8;
  if (requestedCount >= 120) return 6;
  if (requestedCount >= 60) return 4;
  return MULTIAGENT_MIN_QUERIES;
}

export function buildMultiAgentHeuristicQueries(input: XDiscoveryInput): string[] {
  const niche = input.niche.trim();
  const seedHandle = input.seedHandle?.replace(/^@/, "").trim();
  const queries = [
    niche,
    `${niche} founders builders engineers creators on x`,
    `${niche} real people personal accounts on x`,
    `${niche} operators shipping threads on x`,
    seedHandle ? `${niche} accounts similar to @${seedHandle} on x` : "",
    seedHandle ? `people replying to @${seedHandle} about ${niche} on x` : "",
  ];

  return dedupeQueries(queries).slice(0, resolveMultiAgentQueryBudget(input));
}

function buildAttemptVariantQueries(niche: string, seedHandle: string | undefined, attempt: number): string[] {
  const cleanSeed = seedHandle?.replace(/^@/, "").trim();

  return dedupeQueries([
    `${niche} founders builders operators threads on x`,
    `${niche} engineers creators practitioners sharing wins on x`,
    `${niche} startup teams makers people to follow on x`,
    cleanSeed ? `${niche} mutuals around @${cleanSeed} on x` : "",
    attempt >= 3 ? `${niche} hiring building shipping on x` : "",
    attempt >= 4 ? `${niche} devtools saas founders on x` : "",
  ]);
}

function resolveMultiAgentUrlLimit(limit: number, goalCount?: number): number {
  const requested = Math.max(limit, goalCount ?? 0);
  return Math.max(MULTIAGENT_MIN_URLS, Math.min(MULTIAGENT_MAX_URLS, Math.ceil(requested * 0.22)));
}

function resolveMultiAgentScrapeBatchSize(limit: number, goalCount?: number): number {
  const urlBudget = resolveMultiAgentUrlLimit(limit, goalCount);
  return Math.max(
    MULTIAGENT_MIN_BATCH_SIZE,
    Math.min(MULTIAGENT_MAX_BATCH_SIZE, Math.ceil(urlBudget / 6)),
  );
}

function resolveMultiAgentPlannerTimeoutMs(): number {
  const rawValue = process.env.MULTIAGENT_PLANNER_TIMEOUT_MS?.trim();
  if (!rawValue) return DEFAULT_MULTIAGENT_PLANNER_TIMEOUT_MS;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return DEFAULT_MULTIAGENT_PLANNER_TIMEOUT_MS;

  return Math.max(
    MIN_MULTIAGENT_PLANNER_TIMEOUT_MS,
    Math.min(MAX_MULTIAGENT_PLANNER_TIMEOUT_MS, Math.round(parsed)),
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}



function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

function extractKeywords(niche: string): string[] {
  return [...new Set(
    normalizeText(niche)
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3),
  )];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreCandidateHeuristically(niche: string, candidate: XLeadCandidate): { score: number; reasons: string[] } {
  const keywords = extractKeywords(niche);
  const profileText = normalizeText([
    candidate.account.name,
    candidate.account.bio,
    ...candidate.posts.slice(0, 5).map((post) => post.text),
  ].join(" "));

  const topicalHits = keywords.filter((keyword) => profileText.includes(keyword)).length;
  const followerScore = Math.min(28, Math.round(Math.log10(candidate.account.followers + 10) * 8));
  const engagementBase = candidate.metrics.avgLikes
    + (candidate.metrics.avgReplies * 2)
    + (candidate.metrics.avgReposts * 2)
    + ((candidate.metrics.avgViews ?? 0) / 500);
  const engagementScore = Math.min(30, Math.round(Math.log10(engagementBase + 10) * 10));
  const postSignal = candidate.posts.length > 0 ? 10 : 0;
  const topicScore = Math.min(24, topicalHits * 6);
  const handlePenalty = /(support|official|news|updates|hq|team)/i.test(candidate.account.handle) ? 18 : 0;
  const brandPenalty = /\b(official|support|newsroom|company|inc|labs|hq)\b/i.test(candidate.account.bio) ? 14 : 0;
  const largeCorporatePenalty = candidate.account.followers >= 500_000 && !/(founder|ceo|cto|i build|i'm|my |engineer|designer)/i.test(candidate.account.bio) ? 30 : 0;
  const score = clampScore(12 + followerScore + engagementScore + postSignal + topicScore - handlePenalty - brandPenalty - largeCorporatePenalty);

  const reasons: string[] = [];
  if (topicalHits > 0) reasons.push(`${topicalHits} niche keyword hits across bio/posts`);
  if (candidate.account.followers >= 5_000) reasons.push(`Follower base ${candidate.account.followers.toLocaleString()}`);
  if (candidate.posts.length > 0) reasons.push(`${candidate.posts.length} recent sample posts`);
  if (engagementScore >= 16) reasons.push("Healthy engagement signals");
  if (handlePenalty > 0 || brandPenalty > 0) reasons.push("Brand or support-account penalty applied");
  if (largeCorporatePenalty > 0) reasons.push("Large corporate account — unlikely to respond to outreach");

  return {
    score,
    reasons: reasons.length > 0 ? reasons : ["Baseline creator-fit heuristic score"],
  };
}

function extractSelectionEvidence(niche: string, candidate: XLeadCandidate): SelectionEvidence[] {
  const keywords = extractKeywords(niche);
  const evidence: SelectionEvidence[] = [];

  // Profile signal extraction: name
  const nameHits = keywords.filter((kw) => normalizeText(candidate.account.name).includes(kw));
  if (nameHits.length > 0) {
    evidence.push({
      source: "name",
      snippet: candidate.account.name,
      whyItAligns: `Found "${nameHits.join('", "')}" in name, which aligns with "${niche}".`,
    });
  }

  // Handle signal
  const handleHits = keywords.filter((kw) => normalizeText(candidate.account.handle).includes(kw));
  if (handleHits.length > 0) {
    evidence.push({
      source: "handle",
      snippet: `@${candidate.account.handle.replace(/^@/, "")}`,
      whyItAligns: `Found "${handleHits.join('", "')}" in handle, which aligns with "${niche}".`,
    });
  }

  // Bio signal
  if (candidate.account.bio.trim().length > 0) {
    const bioHits = keywords.filter((kw) => normalizeText(candidate.account.bio).includes(kw));
    if (bioHits.length > 0) {
      const bioSnippet = candidate.account.bio.length > 140
        ? candidate.account.bio.slice(0, 140) + "..."
        : candidate.account.bio;
      evidence.push({
        source: "bio",
        snippet: bioSnippet,
        whyItAligns: `Found "${bioHits.join('", "')}" in bio, which aligns with "${niche}".`,
      });
    }
  }

  // Post signal extraction: up to 2 posts
  const matchingPosts = candidate.posts
    .filter((post) => keywords.some((kw) => normalizeText(post.text).includes(kw)))
    .slice(0, 2);
  for (const post of matchingPosts) {
    const postSnippet = post.text.length > 160
      ? post.text.slice(0, 160) + "..."
      : post.text;
    const postHits = keywords.filter((kw) => normalizeText(post.text).includes(kw));
    evidence.push({
      source: "post",
      snippet: postSnippet,
      whyItAligns: `Found "${postHits.join('", "')}" in post, which aligns with "${niche}".`,
    });
  }

  // Audience signal
  if (candidate.account.followers >= 1_000) {
    evidence.push({
      source: "audience",
      snippet: `${candidate.account.followers.toLocaleString()} followers`,
      whyItAligns: `Reachable audience size suggests this is someone worth contacting about "${niche}".`,
    });
  }

  return evidence;
}

function sortScoredCandidates(items: ScoredCandidate[]): ScoredCandidate[] {
  return [...items].sort((left, right) => {
    const scoreDiff = right.score - left.score;
    if (scoreDiff !== 0) return scoreDiff;
    return right.candidate.account.followers - left.candidate.account.followers;
  });
}

function getPlannerFallbackError(attempt: number, reason: string): MultiAgentErrorRecord {
  return {
    stage: "planner",
    attempt,
    code: "UPSTREAM_INVALID_RESPONSE",
    message: reason,
  };
}

function withNewQueries(queries: string[], plannedQueries: string[]): string[] {
  const seen = new Set(plannedQueries.map((value) => value.toLowerCase()));
  return dedupeQueries(queries).filter((query) => !seen.has(query.toLowerCase()));
}

async function withTimeout<T>(
  upstream: "OpenAI planner",
  timeoutMs: number,
  work: () => Promise<T>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const workPromise = work();
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

async function buildPlannerQueries(
  input: PlannerAgentInput,
  interpretationOverride?: GoalInterpretation,
): Promise<PlannerResult> {
  const interpretation = interpretationOverride ?? await interpretLeadSearchGoals({
    niche: input.niche,
    seedHandle: input.seedHandle,
  });
  const heuristicQueries = buildMultiAgentHeuristicQueries({
    niche: input.niche,
    seedHandle: input.seedHandle,
    limit: input.limit,
    targetLeadCount: input.targetLeadCount,
    goalCount: input.goalCount,
  });
  const dorkQueries = buildGoogleDorkQueries({
    niche: input.niche,
    seedHandle: input.seedHandle,
    attempt: input.attempt,
    queryBudget: input.queryBudget,
    interpretation,
  });
  const variants = buildAttemptVariantQueries(input.niche, input.seedHandle, input.attempt);
  const baseBudget = input.queryBudget;

  if (input.recoveryState === "json_repair") {
    const repairQueries = withNewQueries(
      [...dorkQueries, ...variants, ...heuristicQueries],
      input.plannedQueries,
    ).slice(0, baseBudget);

    return {
      queries: repairQueries,
      plannerMode: "repair",
      usedFallback: true,
      userGoals: interpretation.userGoals,
      geoHints: interpretation.geoHints,
      antiGoals: interpretation.antiGoals,
      plannerError: getPlannerFallbackError(
        input.attempt,
        "Planner switched to deterministic dork queries after structured output drift.",
      ),
    };
  }

  if (input.recoveryState === "low_yield") {
    const expanded = await expandLeadSearchQueries(input.niche, input.seedHandle);
    const expansionQueries = withNewQueries(
      [...expanded, ...dorkQueries, ...variants, ...heuristicQueries],
      input.plannedQueries,
    ).slice(0, Math.min(MULTIAGENT_MAX_QUERIES, baseBudget + 1));

    return {
      queries: expansionQueries,
      plannerMode: "expansion",
      usedFallback: false,
      userGoals: interpretation.userGoals,
      geoHints: interpretation.geoHints,
      antiGoals: interpretation.antiGoals,
    };
  }

  if (input.recoveryState === "rate_limited") {
    const throttleQueries = withNewQueries(
      [...dorkQueries, ...heuristicQueries, ...variants],
      input.plannedQueries,
    ).slice(0, Math.max(2, baseBudget - 1));

    return {
      queries: throttleQueries,
      plannerMode: "throttle",
      usedFallback: false,
      userGoals: interpretation.userGoals,
      geoHints: interpretation.geoHints,
      antiGoals: interpretation.antiGoals,
    };
  }

  return {
    queries: withNewQueries(
      [...dorkQueries, ...heuristicQueries, ...variants],
      input.plannedQueries,
    ).slice(0, baseBudget),
    plannerMode: "initial",
    usedFallback: false,
    userGoals: interpretation.userGoals,
    geoHints: interpretation.geoHints,
    antiGoals: interpretation.antiGoals,
  };
}

async function runSourceFanoutAgent(input: SourceFanoutAgentInput): Promise<{
  candidateUrls: string[];
  errors: MultiAgentErrorRecord[];
}> {
  try {
    const results = await searchTavily(input.query, input.limit);
    return {
      candidateUrls: normalizeDiscoveredUrls(
        results,
        resolveMultiAgentUrlLimit(input.limit, input.goalCount),
      ),
      errors: [],
    };
  } catch (error) {
    if (error instanceof XProviderRuntimeError) {
      return {
        candidateUrls: [],
        errors: [{
          stage: "source_fanout",
          attempt: input.attempt,
          code: error.code,
          message: error.message,
          query: input.query,
        }],
      };
    }
    throw error;
  }
}

async function runScraperAgent(input: ScraperAgentInput): Promise<{
  processedUrls: string[];
  scraped: ScrapedPayload[];
  errors: MultiAgentErrorRecord[];
}> {
  const scraped: ScrapedPayload[] = [];
  const processedUrls: string[] = [];
  const errors: MultiAgentErrorRecord[] = [];

  await mapWithConcurrency(
    input.urls,
    MULTIAGENT_SCRAPE_CONCURRENCY,
    async (url) => {
      try {
        const payload = await queryAgentQl(url, "discovery");
        scraped.push({ url, payload });
      } catch (error) {
        if (error instanceof XProviderRuntimeError) {
          errors.push({
            stage: "scraper",
            attempt: input.attempt,
            code: error.code,
            message: error.message,
            url,
          });
          return;
        }

        throw error;
      } finally {
        processedUrls.push(url);
      }
    },
  );

  return {
    processedUrls,
    scraped,
    errors,
  };
}

function normalizeCandidatesFromScrapedState(state: typeof MultiAgentState.State): XLeadCandidate[] {
  const byHandle = new Map<string, XLeadCandidate>();

  for (const item of state.scraped) {
    const profiles = normalizeProfilesFromPayload(item.payload);
    const tweets = normalizeTweetsFromPayload(item.payload);

    for (const profile of profiles) {
      const candidate = buildLeadCandidate(
        "multiagent",
        state.niche,
        profile,
        tweets.length > 0 ? "post_search" : "profile_search",
        tweets.filter((tweet) => !tweet.authorId || tweet.authorId === profile.xUserId),
      );

      if (candidate.account.followers < (state.minFollowers ?? 0)) continue;

      const key = candidate.account.handle.replace(/^@/, "").toLowerCase();
      const existing = byHandle.get(key);
      if (!existing || candidate.account.followers > existing.account.followers) {
        byHandle.set(key, candidate);
      }
    }
  }

  return [...byHandle.values()].sort((left, right) => right.account.followers - left.account.followers);
}

function mergeCandidateWithProfile(candidate: XLeadCandidate, profile: XProfile): XLeadCandidate {
  return {
    ...candidate,
    account: {
      ...candidate.account,
      handle: profile.username || candidate.account.handle,
      name: profile.displayName || candidate.account.name,
      bio: profile.bio.trim().length > 0 ? profile.bio : candidate.account.bio,
      location: profile.location ?? candidate.account.location,
      followers: Math.max(candidate.account.followers, profile.followersCount),
      following: Math.max(candidate.account.following, profile.followingCount),
      isVerified: profile.verified ?? candidate.account.isVerified,
      avatarUrl: profile.avatarUrl ?? candidate.account.avatarUrl,
      profileUrl: profile.profileUrl ?? candidate.account.profileUrl,
      xUserId: profile.xUserId ?? candidate.account.xUserId,
    },
  };
}

async function hydrateCandidates(candidates: XLeadCandidate[]): Promise<{
  candidates: XLeadCandidate[];
  hydratedCount: number;
  tools: string[];
}> {
  const ids = [...new Set(
    candidates
      .map((candidate) => candidate.account.xUserId?.trim())
      .filter((value): value is string => Boolean(value)),
  )];

  if (ids.length === 0) {
    return {
      candidates,
      hydratedCount: 0,
      tools: ["AgentQL"],
    };
  }

  let profiles: XProfile[] = [];
  let tools = ["AgentQL"];

  try {
    profiles = await lookupTwitterApiUsersByIds(ids);
    tools = [...tools, "TwitterAPI.io"];
  } catch (error) {
    if (
      error instanceof XProviderRuntimeError
      && (error.code === "NOT_CONFIGURED" || error.code === "UPSTREAM_REQUEST_FAILED" || error.code === "UPSTREAM_INVALID_RESPONSE")
    ) {
      try {
        profiles = await lookupXUsersByIds(ids);
        tools = [...tools, "X API"];
      } catch {
        profiles = [];
      }
    } else {
      throw error;
    }
  }

  const byId = new Map(profiles.map((profile) => [profile.xUserId, profile]));
  const byHandle = new Map(profiles.map((profile) => [profile.username.toLowerCase(), profile]));
  let hydratedCount = 0;

  return {
    candidates: candidates.map((candidate) => {
      const profile = (
        candidate.account.xUserId ? byId.get(candidate.account.xUserId) : undefined
      ) ?? byHandle.get(candidate.account.handle.replace(/^@/, "").toLowerCase());

      if (!profile) return candidate;
      hydratedCount += 1;
      return mergeCandidateWithProfile(candidate, profile);
    }),
    hydratedCount,
    tools,
  };
}

const PlannerSubgraphState = Annotation.Root({
  niche: Annotation<string>,
  seedHandle: Annotation<string | undefined>,
  limit: Annotation<number>,
  targetLeadCount: Annotation<number>,
  goalCount: Annotation<number>,
  attempt: Annotation<number>,
  maxAttempts: Annotation<number>,
  queryBudget: Annotation<number>,
  recoveryState: Annotation<MultiAgentRecoveryState | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  plannedQueries: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  currentQueries: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  plannerMode: Annotation<MultiAgentPlannerMode>({
    reducer: (_left, right) => right,
    default: () => "initial",
  }),
  plannerFallbackUsed: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  plannerError: Annotation<MultiAgentErrorRecord | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  userGoals: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  roleTerms: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  bioTerms: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  geoHints: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  antiGoals: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  activeSubagent: Annotation<MultiAgentSubagentName | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
});

const plannerSubgraph = new StateGraph(PlannerSubgraphState)
  .addNode("goal_interpreter", async (state) => {
    const interpretation = await interpretLeadSearchGoals({
      niche: state.niche,
      seedHandle: state.seedHandle,
    });

    return {
      activeSubagent: "goal_interpreter" as const,
      userGoals: interpretation.userGoals,
      roleTerms: interpretation.roleTerms,
      bioTerms: interpretation.bioTerms,
      geoHints: interpretation.geoHints,
      antiGoals: interpretation.antiGoals,
    };
  })
  .addNode("dork_planner", async (state) => {
    const plan = await buildPlannerQueries({
      attempt: state.attempt,
      currentQueries: state.currentQueries,
      goalCount: state.goalCount,
      limit: state.limit,
      maxAttempts: state.maxAttempts,
      niche: state.niche,
      plannedQueries: state.plannedQueries,
      queryBudget: state.queryBudget,
      recoveryState: state.recoveryState,
      seedHandle: state.seedHandle,
      targetLeadCount: state.targetLeadCount,
    }, {
      roleTerms: state.roleTerms,
      bioTerms: state.bioTerms,
      geoHints: state.geoHints,
      antiGoals: state.antiGoals,
      userGoals: state.userGoals,
    });

    return {
      activeSubagent: "dork_planner" as const,
      currentQueries: plan.queries,
      plannerMode: plan.plannerMode,
      plannerFallbackUsed: plan.usedFallback,
      plannerError: plan.plannerError,
      userGoals: plan.userGoals,
      geoHints: plan.geoHints,
      antiGoals: plan.antiGoals,
    };
  })
  .addEdge(START, "goal_interpreter")
  .addEdge("goal_interpreter", "dork_planner")
  .addEdge("dork_planner", END)
  .compile();

const SourceResearchSubgraphState = Annotation.Root({
  attempt: Annotation<number>,
  goalCount: Annotation<number>,
  limit: Annotation<number>,
  query: Annotation<string>,
  candidateUrls: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  errors: Annotation<MultiAgentErrorRecord[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  activeSubagent: Annotation<MultiAgentSubagentName | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
});

const sourceResearchSubgraph = new StateGraph(SourceResearchSubgraphState)
  .addNode("source_researcher", async (state) => {
    const result = await runSourceFanoutAgent(state);
    return {
      activeSubagent: "source_researcher" as const,
      candidateUrls: result.candidateUrls,
      errors: result.errors,
    };
  })
  .addEdge(START, "source_researcher")
  .addEdge("source_researcher", END)
  .compile();

const HydrationScoringSubgraphState = Annotation.Root({
  niche: Annotation<string>,
  attempt: Annotation<number>,
  candidates: Annotation<XLeadCandidate[]>({
    reducer: mergeCandidates,
    default: () => [],
  }),
  scored: Annotation<ScoredCandidate[]>({
    reducer: mergeScoredCandidates,
    default: () => [],
  }),
  hydratedCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  hydrationTools: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  activeSubagent: Annotation<MultiAgentSubagentName | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
});

const hydrationScoringSubgraph = new StateGraph(HydrationScoringSubgraphState)
  .addNode("profile_hydrator", async (state) => {
    const hydrated = await hydrateCandidates(state.candidates);

    return {
      activeSubagent: "profile_hydrator" as const,
      candidates: hydrated.candidates,
      hydratedCount: hydrated.hydratedCount,
      hydrationTools: hydrated.tools,
    };
  })
  .addNode("candidate_scorer", async (state) => ({
    activeSubagent: "candidate_scorer" as const,
    scored: state.candidates.map((candidate) => {
      const heuristic = scoreCandidateHeuristically(state.niche, candidate);
      const evidence = extractSelectionEvidence(state.niche, candidate);
      return {
        candidate,
        score: heuristic.score,
        reasons: heuristic.reasons,
        attempt: state.attempt,
        evidence,
      } satisfies ScoredCandidate;
    }),
  }))
  .addEdge(START, "profile_hydrator")
  .addEdge("profile_hydrator", "candidate_scorer")
  .addEdge("candidate_scorer", END)
  .compile();

function resolveLowYieldThreshold(goalCount: number): number {
  return Math.max(6, Math.ceil(goalCount * 0.12));
}

function summarizeMultiAgentErrors(errors: MultiAgentErrorRecord[], limit = 3): string {
  const items = errors
    .slice(-limit)
    .map((error) => {
      const location = error.query ? ` query=${error.query}` : error.url ? ` url=${error.url}` : "";
      return `${error.stage}:${error.code}${location} - ${error.message}`;
    });

  return items.join(" | ");
}

const graph = new StateGraph(MultiAgentState)
  .addNode("planner", async (state) => {
    const plan = await plannerSubgraph.invoke({
      niche: state.niche,
      seedHandle: state.seedHandle,
      limit: state.limit,
      targetLeadCount: state.targetLeadCount,
      goalCount: state.goalCount,
      attempt: state.attempt,
      maxAttempts: state.maxAttempts,
      queryBudget: state.queryBudget,
      recoveryState: state.recoveryState,
      plannedQueries: state.plannedQueries,
      currentQueries: state.currentQueries,
    });

    return {
      activeNode: "planner" as const,
      activeSubagent: plan.activeSubagent,
      completedNodes: ["planner" as const],
      plannerMode: plan.plannerMode,
      currentQueries: plan.currentQueries,
      plannedQueries: plan.currentQueries,
      plannerFallbackUsed: plan.plannerFallbackUsed,
      userGoals: plan.userGoals,
      geoHints: plan.geoHints,
      antiGoals: plan.antiGoals,
      errors: plan.plannerError ? [plan.plannerError] : [],
      traceQuery: undefined,
      traceBatchUrls: [],
      recoveryNote: undefined,
    };
  })
  .addNode("source_fanout", async (state: SourceFanoutAgentInput) => {
    const result = await sourceResearchSubgraph.invoke(state);

    return {
      activeNode: "source_fanout" as const,
      activeSubagent: result.activeSubagent,
      completedNodes: ["source_fanout" as const],
      candidateUrls: result.candidateUrls,
      errors: result.errors,
      traceQuery: state.query,
    };
  })
  .addNode("scrape_router", async () => ({
    activeNode: "scraper" as const,
    activeSubagent: "source_researcher" as const,
    traceQuery: undefined,
  }))
  .addNode("scraper", async (state: ScraperAgentInput) => {
    const result = await runScraperAgent(state);

    return {
      activeNode: "scraper" as const,
      activeSubagent: "source_researcher" as const,
      completedNodes: ["scraper" as const],
      processedUrls: result.processedUrls,
      scraped: result.scraped,
      errors: result.errors,
      traceBatchUrls: state.urls,
    };
  })
  .addNode("scorer", async (state) => {
    const knownHandles = new Set(state.scored.map((item) => item.candidate.account.handle.replace(/^@/, "").toLowerCase()));
    const scoredSubgraph = await hydrationScoringSubgraph.invoke({
      niche: state.niche,
      attempt: state.attempt,
      candidates: normalizeCandidatesFromScrapedState(state)
        .filter((candidate) => !knownHandles.has(candidate.account.handle.replace(/^@/, "").toLowerCase())),
    });

    return {
      activeNode: "scorer" as const,
      activeSubagent: scoredSubgraph.activeSubagent,
      completedNodes: ["scorer" as const],
      scored: scoredSubgraph.scored,
      hydratedCount: scoredSubgraph.hydratedCount,
      hydrationTools: scoredSubgraph.hydrationTools,
      traceBatchUrls: [],
      traceQuery: undefined,
    };
  })
  .addNode("validator", async (state) => {
    const sortedScores = sortScoredCandidates(state.scored);
    const candidates = sortedScores
      .map((item) => item.candidate)
      .slice(0, Math.max(state.goalCount, state.limit));
    const attemptYield = sortedScores.filter((item) => item.attempt === state.attempt).length;
    const attemptErrors = state.errors.filter((error) => error.attempt === state.attempt);
    const rateLimited = attemptErrors.filter((error) => error.code === "UPSTREAM_RATE_LIMITED");
    const invalidResponses = attemptErrors.filter((error) => error.code === "UPSTREAM_INVALID_RESPONSE");
    const repairUrls = mergeUniqueStrings(
      [],
      attemptErrors
        .map((error) => error.url)
        .filter((value): value is string => Boolean(value)),
    ).slice(0, state.scrapeBatchSize);
    const satisfied = candidates.length >= state.goalCount;
    const queryExhausted = !satisfied
      && state.currentQueries.length === 0
      && repairUrls.length === 0;
    const stopReason: MultiAgentStopReason | undefined = satisfied
      ? "goal_reached"
      : state.attempt >= state.maxAttempts
        ? "max_attempts"
        : queryExhausted
          ? "query_exhausted"
          : undefined;
    const recoveryState = stopReason
      ? undefined
      : rateLimited.length > 0
        ? "rate_limited"
        : invalidResponses.length > 0 || state.plannerFallbackUsed
          ? "json_repair"
          : attemptYield < resolveLowYieldThreshold(state.goalCount)
            ? "low_yield"
            : undefined;

    return {
      activeNode: "validator" as const,
      activeSubagent: "validator" as const,
      completedNodes: ["validator" as const],
      candidates,
      stopReason,
      recoveryState,
      repairUrls,
      firstPassCount: state.firstPassCount > 0 ? state.firstPassCount : state.attempt === 1 ? candidates.length : 0,
      lastAttemptYield: attemptYield,
    };
  })
  .addNode("recovery", async (state) => {
    const nextAttempt = Math.min(state.maxAttempts, state.attempt + 1);
    const nextQueryBudget = state.recoveryState === "low_yield"
      ? Math.min(MULTIAGENT_MAX_QUERIES, state.queryBudget + 1)
      : state.recoveryState === "rate_limited"
        ? Math.max(2, state.queryBudget - 1)
        : state.queryBudget;
    const nextScrapeBatchSize = state.recoveryState === "rate_limited" || state.recoveryState === "json_repair"
      ? Math.max(MULTIAGENT_MIN_BATCH_SIZE, Math.floor(state.scrapeBatchSize / 2))
      : state.scrapeBatchSize;
    const note = state.recoveryState === "rate_limited"
      ? "Rate limits detected, so the graph narrowed query breadth and cut scraper batch size before retrying."
      : state.recoveryState === "json_repair"
        ? "JSON repair mode engaged, so the planner will lean on deterministic heuristic queries and smaller scrape batches."
        : "Low-yield recovery expanded the query pool for another bounded pass.";

    return {
      activeNode: "recovery" as const,
      activeSubagent: "recovery" as const,
      completedNodes: ["recovery" as const],
      attempt: nextAttempt,
      queryBudget: nextQueryBudget,
      scrapeBatchSize: nextScrapeBatchSize,
      currentQueries: [],
      plannerFallbackUsed: false,
      recoveryNote: note,
      traceBatchUrls: state.repairUrls,
    };
  })
  .addEdge(START, "planner")
  .addConditionalEdges("planner", (state) => {
    if (state.currentQueries.length > 0) {
      return state.currentQueries.map((query) => new Send("source_fanout", {
        attempt: state.attempt,
        goalCount: state.goalCount,
        limit: state.limit,
        query,
      } satisfies SourceFanoutAgentInput));
    }

    if (state.repairUrls.length > 0) {
      return "scrape_router";
    }

    return "validator";
  })
  .addEdge("source_fanout", "scrape_router")
  .addConditionalEdges("scrape_router", (state) => {
    const prioritizedRepairUrls = mergeUniqueStrings([], state.repairUrls);
    const pendingUrls = mergeUniqueStrings(
      prioritizedRepairUrls,
      state.candidateUrls.filter((url) => !state.processedUrls.includes(url)),
    );
    const limitedUrls = pendingUrls.slice(0, resolveMultiAgentUrlLimit(state.limit, state.goalCount));
    const batches = chunk(limitedUrls, Math.max(MULTIAGENT_MIN_BATCH_SIZE, state.scrapeBatchSize));

    if (batches.length === 0) {
      return "scorer";
    }

    return batches.map((urls) => new Send("scraper", {
      attempt: state.attempt,
      urls,
    } satisfies ScraperAgentInput));
  })
  .addEdge("scraper", "scorer")
  .addEdge("scorer", "validator")
  .addConditionalEdges("validator", (state) => (
    state.stopReason ? END : "recovery"
  ))
  .addEdge("recovery", "planner")
  .compile();

export const multiAgentDiscoveryProvider: XDiscoveryProvider = {
  provider: "multiagent",
  async discoverCandidates(input) {
    let latestState: MultiAgentStateSnapshot = {};

    try {
      let stepIndex = 0;
      const maxAttempts = input.maxAttempts ?? 1;
      const stream = await graph.stream({
        niche: input.niche,
        seedHandle: input.seedHandle,
        limit: input.limit,
        minFollowers: input.minFollowers,
        targetLeadCount: input.targetLeadCount ?? input.limit,
        goalCount: input.goalCount ?? input.limit,
        attempt: input.attempt ?? 1,
        maxAttempts,
        queryBudget: resolveMultiAgentQueryBudget(input),
        scrapeBatchSize: resolveMultiAgentScrapeBatchSize(input.limit, input.goalCount),
      }, {
        streamMode: ["updates", "values"],
        recursionLimit: Math.max(28, maxAttempts * 8),
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
        await input.traceRecorder?.(buildMultiAgentTraceStep(nodeName, update, stepIndex, input.minFollowers, getPlannerModelName()));
      }

      if ((latestState.candidates?.length ?? 0) === 0 && (latestState.errors?.length ?? 0) > 0) {
        const errorSummary = summarizeMultiAgentErrors(latestState.errors ?? []);
        console.warn("[x-provider][multiagent][workflow]", JSON.stringify({
          attempt: latestState.attempt ?? input.attempt ?? 1,
          stopReason: latestState.stopReason,
          recoveryState: latestState.recoveryState,
          errorCount: latestState.errors?.length ?? 0,
          errors: latestState.errors,
        }));

        throw new XProviderRuntimeError({
          provider: "multiagent",
          capability: "discovery",
          code: "UPSTREAM_REQUEST_FAILED",
          message: `Multi-agent workflow exhausted without candidates. ${errorSummary}`,
        });
      }

      return latestState.candidates ?? [];
    } catch (error) {
      if ((latestState.errors?.length ?? 0) > 0) {
        console.warn("[x-provider][multiagent][workflow]", JSON.stringify({
          attempt: latestState.attempt ?? input.attempt ?? 1,
          stopReason: latestState.stopReason,
          recoveryState: latestState.recoveryState,
          errorCount: latestState.errors?.length ?? 0,
          errors: latestState.errors,
        }));
      }

      if (error instanceof XProviderRuntimeError) throw error;
      throw new XProviderRuntimeError({
        provider: "multiagent",
        capability: "discovery",
        code: "UPSTREAM_REQUEST_FAILED",
        message: `Multi-agent workflow failed. ${describeUpstreamError(error)}${(latestState.errors?.length ?? 0) > 0 ? ` Recent stage errors: ${summarizeMultiAgentErrors(latestState.errors ?? [])}` : ""}`,
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
  lookupUsersByIds() {
    throw new XProviderRuntimeError({
      provider: "multiagent",
      capability: "lookup",
      code: "CAPABILITY_UNSUPPORTED",
      message: "Multi-agent lookup does not support direct lookup by X user ID.",
    });
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
