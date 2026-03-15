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
    if (!existing || item.score > existing.score || (item.score === existing.score && (item.evidence?.length ?? 0) > (existing.evidence?.length ?? 0))) {
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
    // Keep the version with more posts (richer signal), then bio length, then followers
    if (!existing || item.posts.length > existing.posts.length || (item.posts.length === existing.posts.length && item.account.bio.length > existing.account.bio.length)) {
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
  const niche = input.niche.trim();
  const geoHints = niche.match(/\b(?:in|from|based in|located in)\s+([A-Za-z][A-Za-z\s]+)/gi)
    ?.map((match) => match.replace(/\b(?:in|from|based in|located in)\s+/i, "").trim())
    .filter(Boolean) ?? [];

  // Keep the full niche as the primary term — don't split into individual words
  return {
    roleTerms: [niche],
    bioTerms: [niche],
    geoHints,
    antiGoals: ["support", "official", "newsroom", "brand account", "large corporation", "celebrity", "media outlet", "institution", "dormant account", "bot"],
    userGoals: [
      `Find ${input.niche} on X.`,
      input.seedHandle ? `Look within @${input.seedHandle.replace(/^@/, "")}'s network.` : "",
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
      "Interpret this lead-search request. The user wants to find X/Twitter accounts that match this niche.",
      "",
      "Generate SYNONYMS and VARIATIONS of the query that mean the same thing. Every term you generate must describe the same type of person as the original query. Never split a multi-word concept into separate unrelated words.",
      "",
      "Extract:",
      "- roleTerms: synonyms and variations of the role the user is looking for. Each term must be a complete phrase that means the same thing as the query. Include the original query as-is, plus realistic variations people would write in their bios.",
      "- bioTerms: how people in this niche describe themselves in bios. Each term must be a complete self-description that stays within the same niche as the query.",
      "- geoHints: optional location signals from the query",
      "- antiGoals: account types to avoid",
      "- userGoals: what the user is looking for (restate simply)",
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

  // When searching within a user's followers, ALL queries scope to verified_followers page
  if (cleanSeed) {
    const vf = `site:x.com/${cleanSeed}/verified_followers`;
    return dedupeQueries([
      `${vf} ${input.niche}`,
      `${vf}`,
      roleBlock ? `${vf} ("${roleBlock}")` : "",
      bioBlock ? `${vf} ("${bioBlock}")` : "",
      geoBlock ? `${vf} "${geoBlock}"` : "",
    ]).slice(0, input.queryBudget);
  }

  return dedupeQueries([
    // Direct niche search — find people with the niche in their profile
    `site:x.com "${input.niche}"`,
    `site:twitter.com "${input.niche}"`,
    // With role terms from AI interpretation
    roleBlock ? `site:x.com ("${roleBlock}")` : "",
    bioBlock ? `site:x.com ("${bioBlock}")` : "",
    // Geo-targeted
    geoBlock ? `site:x.com "${input.niche}" "${geoBlock}"` : "",
    // Later attempts: try role/bio terms individually (each quoted)
    input.attempt >= 2 && input.interpretation.roleTerms[1] ? `site:x.com "${input.interpretation.roleTerms[1]}"` : "",
    input.attempt >= 3 && input.interpretation.bioTerms[1] ? `site:twitter.com "${input.interpretation.bioTerms[1]}"` : "",
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

  // When searching within a user's followers, ALL queries scope to verified_followers
  if (seedHandle) {
    const vf = `site:x.com/${seedHandle}/verified_followers`;
    return dedupeQueries([
      `${vf} ${niche}`,
      `${vf}`,
      `${vf} ${niche} founders creators builders`,
      `${vf} ${niche} people who repost share engage`,
      `${vf} ${niche} indie makers operators`,
      `${vf} ${niche} engaged community members`,
    ]).slice(0, resolveMultiAgentQueryBudget(input));
  }

  return dedupeQueries([
    `${niche} on x`,
    `${niche} x.com`,
    `${niche} twitter`,
    `best ${niche} on x`,
  ]).slice(0, resolveMultiAgentQueryBudget(input));
}

function buildAttemptVariantQueries(niche: string, seedHandle: string | undefined, attempt: number): string[] {
  const cleanSeed = seedHandle?.replace(/^@/, "").trim();

  // When searching within a user's followers, ALL queries scope to verified_followers
  if (cleanSeed) {
    const vf = `site:x.com/${cleanSeed}/verified_followers`;
    return dedupeQueries([
      `${vf} ${niche}`,
      attempt >= 3 ? `${vf}` : "",
    ]);
  }

  return dedupeQueries([
    `site:x.com "${niche}"`,
    `"${niche}" x.com`,
    `${niche} site:twitter.com`,
    attempt >= 3 ? `top ${niche} on x` : "",
    attempt >= 4 ? `${niche} freelance independent` : "",
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

const NICHE_STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one",
  "our", "out", "has", "had", "how", "its", "let", "may", "who", "did", "get", "got",
  "him", "his", "she", "too", "use", "way", "each", "make", "like", "long", "look",
  "many", "most", "some", "than", "them", "then", "very", "when", "come", "made",
  "find", "here", "know", "take", "want", "does", "back", "been", "best", "from",
  "good", "have", "just", "more", "much", "need", "only", "over", "such", "that",
  "they", "this", "time", "what", "will", "with", "work", "your", "about", "being",
  "could", "great", "might", "other", "their", "there", "these", "those", "which",
  "would", "after", "every", "first", "still", "thing", "think", "where", "working",
  "coolest", "awesome", "amazing", "top", "biggest", "most", "real", "people",
]);

function extractKeywords(niche: string): string[] {
  const normalized = normalizeText(niche);
  const words = normalized.split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 3 && !NICHE_STOP_WORDS.has(w));

  // Build meaningful multi-word phrases (bigrams) alongside filtered single words
  const phrases: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  // Full niche as a phrase (if multi-word)
  if (words.length >= 2) {
    phrases.push(words.join(" "));
  }
  // Include individual words but only domain-specific ones (not generic)
  phrases.push(...words);

  return [...new Set(phrases)];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreCandidateHeuristically(niche: string, candidate: XLeadCandidate): { score: number; reasons: string[] } {
  const keywords = extractKeywords(niche);
  const bioText = normalizeText(candidate.account.bio);
  const postTexts = candidate.posts.slice(0, 5).map((post) => normalizeText(post.text));

  // Bio relevance — phrase matches count 3x
  const bioPhraseHits = keywords.filter((kw) => kw.includes(" ") && bioText.includes(kw)).length;
  const bioWordHits = keywords.filter((kw) => !kw.includes(" ") && bioText.includes(kw)).length;
  const bioScore = Math.min(60, (bioPhraseHits * 3 + bioWordHits) * 10);

  // Post relevance — posts with niche keywords
  const postHits = postTexts.filter((text) => keywords.some((kw) => text.includes(kw))).length;
  const postScore = Math.min(40, postHits * 12);

  const score = clampScore(bioScore + postScore);

  const reasons: string[] = [];
  if (bioPhraseHits > 0) reasons.push(`Bio contains: ${keywords.filter((kw) => kw.includes(" ") && bioText.includes(kw)).slice(0, 3).map((k) => `"${k}"`).join(", ")}`);
  else if (bioWordHits > 0) reasons.push(`Bio mentions: ${keywords.filter((kw) => !kw.includes(" ") && bioText.includes(kw)).slice(0, 3).map((k) => `"${k}"`).join(", ")}`);
  if (postHits > 0) reasons.push(`${postHits} post(s) discuss the niche`);

  return { score, reasons };
}

function extractBioWebsiteUrl(bio: string): string | null {
  const urlMatch = bio.match(/https?:\/\/[^\s,)]+/i);
  if (urlMatch) return urlMatch[0];
  // Match domain-like patterns: word.tld
  const domainMatch = bio.match(/\b([a-z0-9][-a-z0-9]*\.(com|io|co|dev|app|xyz|ai|org|net|me|so|gg))\b/i);
  if (domainMatch) return `https://${domainMatch[1]}`;
  return null;
}

async function scrapeWebsiteForEvidence(
  url: string,
  niche: string,
  keywords: string[],
): Promise<SelectionEvidence | null> {
  try {
    const payload = await queryAgentQlBestEffort(url, "discovery");
    if (!payload) return null;
    const text = JSON.stringify(payload).toLowerCase().slice(0, 3000);
    const matched = keywords.filter((kw) => text.includes(kw)).slice(0, 3);
    if (matched.length === 0) return null;
    const snippet = text.slice(0, 200).replace(/["\n\r]/g, " ").trim();
    return {
      source: "bio" as const,
      snippet: `Website (${url}): ${snippet}...`,
      whyItAligns: `Website contains: ${matched.map((h) => `"${h}"`).join(", ")}`,
    };
  } catch {
    return null;
  }
}

function extractSelectionEvidence(niche: string, candidate: XLeadCandidate): SelectionEvidence[] {
  const keywords = extractKeywords(niche);
  const evidence: SelectionEvidence[] = [];

  // Bio evidence — only if niche keywords actually appear in the bio
  if (candidate.account.bio.trim().length > 0) {
    const bioText = normalizeText(candidate.account.bio);
    const bioPhrasesFound = keywords.filter((kw) => kw.includes(" ") && bioText.includes(kw));
    const bioWordsFound = keywords.filter((kw) => !kw.includes(" ") && bioText.includes(kw));
    const bioSnippet = candidate.account.bio.length > 200
      ? candidate.account.bio.slice(0, 200) + "..."
      : candidate.account.bio;

    // Only add bio evidence if actual niche terms were found — not generic creator signals
    if (bioPhrasesFound.length > 0 || bioWordsFound.length >= 2) {
      const matched = [...bioPhrasesFound, ...bioWordsFound].slice(0, 4);
      evidence.push({
        source: "bio",
        snippet: bioSnippet,
        whyItAligns: `Bio contains: ${matched.map((h) => `"${h}"`).join(", ")}`,
      });
    }
  }

  // Post evidence — only posts with actual niche keyword matches
  const nicheMatchingPosts = candidate.posts
    .filter((post) => {
      const text = normalizeText(post.text);
      return keywords.some((kw) => kw.includes(" ") ? text.includes(kw) : text.includes(kw));
    })
    .slice(0, 2);

  for (const post of nicheMatchingPosts) {
    const postSnippet = post.text.length > 180
      ? post.text.slice(0, 180) + "..."
      : post.text;
    const postText = normalizeText(post.text);
    const matched = keywords.filter((kw) => postText.includes(kw)).slice(0, 3);
    evidence.push({
      source: "post",
      snippet: postSnippet,
      whyItAligns: `Post contains: ${matched.map((h) => `"${h}"`).join(", ")}`,
    });
  }

  // Handle signal — only phrase-level matches (not single words)
  const handleText = normalizeText(candidate.account.handle);
  const handleHits = keywords.filter((kw) => handleText.includes(kw));
  if (handleHits.length > 0) {
    evidence.push({
      source: "handle",
      snippet: `@${candidate.account.handle.replace(/^@/, "")}`,
      whyItAligns: `Handle contains: ${handleHits.map((h) => `"${h}"`).join(", ")}`,
    });
  }

  return evidence;
}

function sortScoredCandidates(items: ScoredCandidate[]): ScoredCandidate[] {
  return [...items].sort((left, right) => {
    const scoreDiff = right.score - left.score;
    if (scoreDiff !== 0) return scoreDiff;
    // Tiebreaker: prefer candidates with more evidence pieces (deeper niche fit)
    const evidenceDiff = (right.evidence?.length ?? 0) - (left.evidence?.length ?? 0);
    if (evidenceDiff !== 0) return evidenceDiff;
    // Final tiebreaker: prefer candidates with posts (active participation)
    return right.candidate.posts.length - left.candidate.posts.length;
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
    const discoveredUrls = normalizeDiscoveredUrls(
      results,
      resolveMultiAgentUrlLimit(input.limit, input.goalCount),
    );

    // When searching within a user's followers, inject the verified_followers URL
    // as a priority scrape target so AgentQL can extract profiles from it directly.
    const cleanSeed = input.seedHandle?.replace(/^@/, "").trim();
    if (cleanSeed) {
      const verifiedFollowersUrl = `https://x.com/${cleanSeed}/verified_followers`;
      if (!discoveredUrls.includes(verifiedFollowersUrl)) {
        discoveredUrls.unshift(verifiedFollowersUrl);
      }
    }

    return {
      candidateUrls: discoveredUrls,
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
      if (!existing || candidate.posts.length > existing.posts.length || (candidate.posts.length === existing.posts.length && candidate.account.bio.length > existing.account.bio.length)) {
        byHandle.set(key, candidate);
      }
    }
  }

  // Sort by bio/post relevance to the niche, not by follower count
  const keywords = extractKeywords(state.niche);
  return [...byHandle.values()].sort((left, right) => {
    const leftRelevance = keywords.filter((kw) => normalizeText([left.account.bio, ...left.posts.map((p) => p.text)].join(" ")).includes(kw)).length;
    const rightRelevance = keywords.filter((kw) => normalizeText([right.account.bio, ...right.posts.map((p) => p.text)].join(" ")).includes(kw)).length;
    if (rightRelevance !== leftRelevance) return rightRelevance - leftRelevance;
    return right.posts.length - left.posts.length;
  });
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
  seedHandle: Annotation<string | undefined>,
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
  .addNode("candidate_scorer", async (state) => {
    const keywords = extractKeywords(state.niche);

    // Phase 1: Score all candidates and collect website URLs to scrape
    const prescoredCandidates = state.candidates.map((candidate) => ({
      candidate,
      heuristic: scoreCandidateHeuristically(state.niche, candidate),
      evidence: extractSelectionEvidence(state.niche, candidate),
      websiteUrl: extractBioWebsiteUrl(candidate.account.bio),
    }));

    // Phase 2: Scrape websites in parallel (only for candidates that have one)
    const websiteCandidates = prescoredCandidates.filter((c) => c.websiteUrl);
    if (websiteCandidates.length > 0) {
      const websiteResults = await mapWithConcurrency(
        websiteCandidates,
        MULTIAGENT_SCRAPE_CONCURRENCY,
        async (c) => scrapeWebsiteForEvidence(c.websiteUrl!, state.niche, keywords),
      );
      websiteCandidates.forEach((c, i) => {
        const result = websiteResults[i];
        if (result) c.evidence.push(result);
      });
    }

    // Phase 3: Filter to candidates with at least one evidence source
    const scored: ScoredCandidate[] = prescoredCandidates
      .filter((c) => c.evidence.length > 0)
      .map((c) => ({
        candidate: c.candidate,
        score: c.heuristic.score,
        reasons: c.heuristic.reasons,
        attempt: state.attempt,
        evidence: c.evidence,
      }));

    return {
      activeSubagent: "candidate_scorer" as const,
      scored,
    };
  })
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
    // Keep all scored candidates — don't cap. More relevant leads = better.
    const candidates = sortedScores.map((item) => item.candidate);
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
        seedHandle: state.seedHandle,
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
