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
  searchTavilyWithExclusions,
  normalizeDiscoveredUrls,
} from "./tavily";
import {
  queryAgentQl,
  queryAgentQlBestEffort,
  normalizeProfilesFromPayload,
  normalizeTweetsFromPayload,
} from "./agentql";
import { NICHE_EXAMPLES, selectRelevantExamples } from "./niche-examples";
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
  /** Cleaned search phrase from the planner's interpretation */
  normalizedQuery: Annotation<string>({
    reducer: (_left, right) => right || _left,
    default: () => "",
  }),
  queryType: Annotation<GoalInterpretation["queryType"]>({
    reducer: (_left, right) => right || _left,
    default: () => "role",
  }),
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
  /** Raw candidates scraped this attempt before pre-screening */
  lastAttemptRawCount: Annotation<number>({
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
  /** The cleaned search phrase extracted from the user's input. No filler words, no "I want to find", just the core role or niche. This is what goes into Google dork queries. */
  normalizedQuery: z.string().default(""),
  /** What kind of query this is: role (looking for people with a job title), product (looking for users of/builders of a product), or niche (looking for people in a space/industry). */
  queryType: z.enum(["role", "product", "niche"]).default("role"),
  roleTerms: z.array(z.string()).default([]),
  bioTerms: z.array(z.string()).default([]),
  geoHints: z.array(z.string()).default([]),
  antiGoals: z.array(z.string()).default([]),
  userGoals: z.array(z.string()).default([]),
}).strict();

type GoalInterpretation = z.infer<typeof GoalInterpretationSchema>;

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

/**
 * Build singular, plural, and discipline-form variants of a role phrase.
 * E.g. "product designers" -> ["product designers", "product designer", "product design"]
 *      "startup founder"   -> ["startup founder", "startup founders", "startup founding"]
 */
function buildRoleVariants(role: string): string[] {
  const trimmed = role.trim().toLowerCase();
  const variants = new Set<string>([trimmed]);

  // Singular / plural of the full phrase
  for (const v of pluralVariants(trimmed)) variants.add(v);

  // Discipline form: strip the person suffix to get the field name
  // "product designers" -> "product design", "startup founders" -> "startup founding"
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) {
    const lastWord = words[words.length - 1];
    const prefix = words.slice(0, -1).join(" ");

    // Common person-suffix → discipline mappings
    const disciplineMappings: Record<string, string> = {
      designer: "design", designers: "design",
      developer: "development", developers: "development",
      engineer: "engineering", engineers: "engineering",
      founder: "founding", founders: "founding",
      marketer: "marketing", marketers: "marketing",
      manager: "management", managers: "management",
      researcher: "research", researchers: "research",
      consultant: "consulting", consultants: "consulting",
      architect: "architecture", architects: "architecture",
      strategist: "strategy", strategists: "strategy",
      writer: "writing", writers: "writing",
      analyst: "analytics", analysts: "analytics",
      creator: "creation", creators: "creation",
      educator: "education", educators: "education",
      photographer: "photography", photographers: "photography",
      illustrator: "illustration", illustrators: "illustration",
      animator: "animation", animators: "animation",
    };

    const discipline = disciplineMappings[lastWord];
    if (discipline) {
      variants.add(`${prefix} ${discipline}`);
    }
  }

  return [...variants];
}

/**
 * Strip natural-language filler from user input to get the core search term.
 * "I want to find motion designers" → "motion designers"
 * "looking for AI startup founders in Europe" → "AI startup founders in Europe"
 * "product designers" → "product designers" (no change)
 */
function heuristicNormalizeQuery(raw: string): string {
  return raw
    .replace(/^(?:i\s+(?:want|need|am looking|would like)\s+to\s+(?:find|search|discover|get|look for)\s+)/i, "")
    .replace(/^(?:find\s+(?:me\s+)?|search\s+for\s+|looking\s+for\s+|give\s+me\s+|show\s+me\s+|get\s+me\s+)/i, "")
    .replace(/^(?:best|top|popular|trending|famous)\s+/i, "")
    .replace(/\s+(?:on\s+(?:x|twitter|x\.com))\s*$/i, "")
    .replace(/\s+(?:please|pls)\s*$/i, "")
    .trim();
}

function buildHeuristicGoalInterpretation(input: {
  niche: string;
  seedHandle?: string;
}): GoalInterpretation {
  const niche = input.niche.trim();
  const normalized = heuristicNormalizeQuery(niche);
  const geoHints = normalized.match(/\b(?:in|from|based in|located in)\s+([A-Za-z][A-Za-z\s]+)/gi)
    ?.map((match) => match.replace(/\b(?:in|from|based in|located in)\s+/i, "").trim())
    .filter(Boolean) ?? [];

  const roleVariants = buildRoleVariants(normalized);

  return {
    normalizedQuery: normalized,
    queryType: "role",
    roleTerms: roleVariants,
    bioTerms: roleVariants,
    geoHints,
    antiGoals: ["support", "official", "newsroom", "brand account", "large corporation", "celebrity", "media outlet", "institution", "dormant account", "bot"],
    userGoals: [
      `Find ${normalized} on X.`,
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
    const promptParts = [
      "Interpret this lead-search request. The user wants to find X/Twitter accounts matching their query.",
      "",
      "## STEP 0: NORMALIZE THE QUERY",
      "",
      "The user might type anything — natural language, a role, a product, or a niche. Your FIRST job is to extract a clean search phrase.",
      "",
      "Examples:",
      '  "I want to find motion designers" → normalizedQuery: "motion designers", queryType: "role"',
      '  "looking for AI startup founders in Europe" → normalizedQuery: "AI startup founders", queryType: "role", geoHints: ["Europe"]',
      '  "product designers" → normalizedQuery: "product designers", queryType: "role"',
      '  "people who use Figma" → normalizedQuery: "Figma users", queryType: "product"',
      '  "AI SaaS tool builders" → normalizedQuery: "AI SaaS builders", queryType: "niche"',
      '  "DTC ecommerce brands" → normalizedQuery: "DTC ecommerce", queryType: "niche"',
      "",
      "Strip filler words ('I want to find', 'looking for', 'best', 'top', 'on X'). Keep domain qualifiers ('AI', 'crypto', 'DTC'). Keep geo if present.",
      "",
      "## STEP 1: DETERMINE QUERY TYPE",
      "",
      "- **role**: User is looking for people with a specific job/profession (most common). Example: 'motion designers', 'startup founders', 'DevRel engineers'",
      "- **product**: User is looking for users/builders of a specific product or tool. Example: 'Figma power users', 'Notion template creators'",
      "- **niche**: User is looking for people in a space/industry without a specific job title. Example: 'AI SaaS', 'web3 gaming', 'DTC ecommerce'",
      "",
      "## STEP 2: GENERATE TERMS (adapted to queryType)",
      "",
      "### For queryType = 'role':",
      "Think about how people on X describe this role in their bios. Key insight: people almost ALWAYS write the SINGULAR form in bios, not plural.",
      "  - Bio says: 'Motion Designer' NOT 'Motion Designers'",
      "  - Bio says: 'Product Designer at @Figma' NOT 'Product Designers at Figma'",
      "  - Bio says: 'Founder & CEO' NOT 'Startup Founders'",
      "",
      "So roleTerms MUST include the singular form as the primary search term. Also include:",
      "  - Plural (for posts, lists, articles that mention the role)",
      "  - Discipline/field form ('motion design', 'product design')",
      "  - X-specific abbreviations: 'SWE', 'PM', 'DevRel'",
      "  - Common seniority prefixes people actually write: 'senior', 'lead', 'staff', 'principal', 'head of'",
      "  - Adjacent synonyms (same work, different title): 'motion graphics designer' = 'motion designer'",
      "",
      "### For queryType = 'product':",
      "  - roleTerms: people who use/build with this product ('Figma designer', 'Notion creator', 'Webflow developer')",
      "  - bioTerms: how they mention it ('building with @product', 'powered by @product', '@product template maker')",
      "",
      "### For queryType = 'niche':",
      "  - roleTerms: common roles within this niche ('DTC brand founder', 'ecommerce operator', 'web3 game developer')",
      "  - bioTerms: how people in this space describe themselves ('building in web3 gaming', 'DTC brand operator')",
      "",
      "## STEP 3: THINK ABOUT X/TWITTER BIOS SPECIFICALLY",
      "",
      "People on X write bios in a very specific way. Study these real patterns:",
      "  - '[Role] at @[Company]' → 'Motion Designer at @Netflix'",
      "  - '[Role] | [Side project]' → 'Product Designer | Building @MyApp'",
      "  - '[Role] • [Passion]' → 'UX Designer • Design systems nerd'",
      "  - 'Head of [Discipline] at @[Company]' → 'Head of Motion at @Apple'",
      "  - '[Discipline] @[Company]' → 'Motion Design @Google'",
      "  - 'I [verb] [thing]' → 'I design motion for brands'",
      "  - '[Emoji] [Role]' → '✨ Motion Designer'",
      "",
      "Generate bioTerms that match these REAL patterns for the specific query.",
      "",
      "## STEP 4: IDENTIFY ANTI-GOALS",
      "",
      "Name the specific adjacent roles/account types that share keywords but are NOT what the user wants.",
      "Be specific to THIS query. For 'motion designers': 'motion graphics company (org)', 'video editor (different role)', 'animator (unless also does motion design)'.",
      "",
      "## RULES",
      "",
      "- normalizedQuery MUST be a clean, search-ready phrase. No filler, no 'I want to find'.",
      "- Every roleTerms entry must unambiguously identify the role. No single generic words.",
      "- bioTerms must be realistic X bio phrases — how people ACTUALLY write, not formal titles.",
      "- antiGoals must name SPECIFIC confusable roles, not generic terms like 'irrelevant'.",
      "- ALWAYS include singular form as primary roleTerms entry (this is how bios are written on X).",
      "- NEVER output lone words ('product', 'design', 'motion'). Always a phrase or compound title.",
    ];

    if (NICHE_EXAMPLES) {
      // Select only the 2-3 most relevant examples + structural patterns to stay within token budget.
      // LangGraph docs: "Balance context completeness against token costs."
      const relevantExamples = selectRelevantExamples(input.niche, 3);
      promptParts.push(
        "",
        "## REFERENCE EXAMPLES",
        "",
        "Below are a few relevant examples. Study the PATTERNS, not the content:",
        "- How roleTerms cover singular/plural/discipline/synonym forms",
        "- How bioTerms reflect real bio language, not formal titles",
        "- How antiGoals name specific confusable roles",
        "",
        "DO NOT copy terms from these examples unless the query exactly matches one.",
        "For any other query, apply the same structural patterns but generate terms specific to that query's role.",
        "",
        relevantExamples,
      );
    }

    promptParts.push(
      "",
      "## OUTPUT",
      "",
      "For the query below, generate:",
      "- normalizedQuery: the clean search phrase extracted from the user's input (no filler, just the core role/niche).",
      "- queryType: 'role' | 'product' | 'niche' — what kind of query this is.",
      "- roleTerms: SINGULAR form first, then plural, discipline, synonyms. Every entry must unambiguously identify the role.",
      "- bioTerms: realistic X bio phrases — how people actually write on X, not formal titles.",
      "- geoHints: location signals extracted from the query (if any).",
      "- antiGoals: specific roles/account types that look similar but are NOT this role. Name exact titles.",
      "- userGoals: what the user is looking for (restate simply).",
      "",
      JSON.stringify(input),
    );

    const result = await withTimeout("OpenAI planner", resolveMultiAgentPlannerTimeoutMs(), () => interpreter.invoke(promptParts.join("\n")));

    return {
      normalizedQuery: result.normalizedQuery?.trim() || heuristicNormalizeQuery(input.niche),
      queryType: result.queryType ?? "role",
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
  // Use the normalized query (cleaned of filler words) for dork queries, not the raw user input.
  // "I want to find motion designers" → searches for "motion designer" (singular, how bios are written)
  const normalized = input.interpretation.normalizedQuery || input.niche;
  // Primary search term: first roleTerm (singular) is the best match for X bios
  const primaryTerm = input.interpretation.roleTerms[0] || normalized;
  const roleBlock = input.interpretation.roleTerms.slice(0, 3).join('" OR "');
  const bioBlock = input.interpretation.bioTerms.slice(0, 4).join('" OR "');
  const geoBlock = input.interpretation.geoHints[0]?.trim();
  const cleanSeed = input.seedHandle?.replace(/^@/, "").trim();

  // When searching within a user's followers, ALL queries scope to verified_followers page
  if (cleanSeed) {
    const vf = `site:x.com/${cleanSeed}/verified_followers`;
    return dedupeQueries([
      `${vf} "${primaryTerm}"`,
      `${vf}`,
      roleBlock ? `${vf} ("${roleBlock}")` : "",
      bioBlock ? `${vf} ("${bioBlock}")` : "",
      geoBlock ? `${vf} "${primaryTerm}" "${geoBlock}"` : "",
    ]).slice(0, input.queryBudget);
  }

  return dedupeQueries([
    // Primary: search for the singular role term (how people write it in bios)
    `site:x.com "${primaryTerm}"`,
    // Secondary: try normalized query (may include plural or qualifiers)
    primaryTerm !== normalized ? `site:x.com "${normalized}"` : `site:twitter.com "${primaryTerm}"`,
    // With role terms OR block
    roleBlock ? `site:x.com ("${roleBlock}")` : "",
    // With bio terms OR block
    bioBlock ? `site:x.com ("${bioBlock}")` : "",
    // Geo-targeted
    geoBlock ? `site:x.com "${primaryTerm}" "${geoBlock}"` : "",
    // Later attempts: try individual role/bio terms
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

function pluralVariants(phrase: string): string[] {
  const variants = [phrase];
  // "designers" -> "designer", "designer" -> "designers"
  if (phrase.endsWith("s") && !phrase.endsWith("ss")) {
    variants.push(phrase.slice(0, -1));
  } else {
    variants.push(phrase + "s");
  }
  // Handle multi-word: apply to last word
  if (phrase.includes(" ")) {
    const parts = phrase.split(" ");
    const last = parts[parts.length - 1];
    if (last.endsWith("s") && !last.endsWith("ss")) {
      variants.push([...parts.slice(0, -1), last.slice(0, -1)].join(" "));
    } else {
      variants.push([...parts.slice(0, -1), last + "s"].join(" "));
    }
  }
  return variants;
}

function extractKeywords(niche: string): string[] {
  const normalized = normalizeText(niche);
  const words = normalized.split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 3 && !NICHE_STOP_WORDS.has(w));

  const phrases: string[] = [];

  // Full niche phrase + singular/plural + discipline variants (these are the highest-value matches)
  if (words.length >= 2) {
    const fullPhrase = words.join(" ");
    phrases.push(...buildRoleVariants(fullPhrase));
  }

  // Bigrams + their variants
  for (let i = 0; i < words.length - 1; i++) {
    phrases.push(...pluralVariants(`${words[i]} ${words[i + 1]}`));
  }

  // Individual words + their variants — kept for weak-signal scoring but
  // callers should weight these much lower than phrase matches
  for (const word of words) {
    phrases.push(...pluralVariants(word));
  }

  return [...new Set(phrases)];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreCandidateHeuristically(niche: string, candidate: XLeadCandidate): { score: number; reasons: string[] } {
  const keywords = extractKeywords(niche);
  const bioText = normalizeText(candidate.account.bio);
  // Examine more posts (up to 15) for better signal
  const postTexts = candidate.posts.slice(0, 15).map((post) => normalizeText(post.text));

  // Bio relevance — phrase matches are the primary signal, single words are near-worthless
  const phraseKeywords = keywords.filter((kw) => kw.includes(" "));
  const singleKeywords = keywords.filter((kw) => !kw.includes(" "));
  const bioPhraseHits = phraseKeywords.filter((kw) => bioText.includes(kw)).length;
  const bioWordHits = singleKeywords.filter((kw) => bioText.includes(kw)).length;

  // Phrases worth 22 each. Single words are worth only 1pt — they should NEVER be enough alone.
  // A CEO with "product" in bio gets 1pt. A "product designer" gets 22pts.
  const bioScore = Math.min(60, bioPhraseHits * 22 + bioWordHits * 1);

  // Post relevance — phrase matches in posts confirm the role
  const postPhraseHits = postTexts.filter((text) => phraseKeywords.some((kw) => text.includes(kw))).length;
  const postScore = Math.min(30, postPhraseHits * 10);

  // Require at least one phrase match (bio or posts) to score above 20
  const hasAnyPhraseMatch = bioPhraseHits > 0 || postPhraseHits > 0;
  const rawScore = bioScore + postScore;
  const score = clampScore(hasAnyPhraseMatch ? rawScore : Math.min(15, rawScore));

  const reasons: string[] = [];
  if (bioPhraseHits > 0) reasons.push(`Bio contains: ${phraseKeywords.filter((kw) => bioText.includes(kw)).slice(0, 3).map((k) => `"${k}"`).join(", ")}`);
  else if (bioWordHits > 0) reasons.push(`Bio mentions: ${singleKeywords.filter((kw) => bioText.includes(kw)).slice(0, 3).map((k) => `"${k}"`).join(", ")}`);
  if (postPhraseHits > 0) reasons.push(`${postPhraseHits} post(s) discuss the niche`);

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

    // Add bio evidence if any niche term was found
    if (bioPhrasesFound.length > 0 || bioWordsFound.length > 0) {
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

  if (input.recoveryState === "precision_filtered") {
    // Candidates were found but almost all were the wrong role.
    // Generate highly targeted queries using the exact role terms from interpretation.
    const roleTargetedQueries = [
      ...interpretation.roleTerms.slice(0, 5).map((term) => `site:x.com "${term}"`),
      ...interpretation.bioTerms.slice(0, 3).map((term) => `site:x.com "${term}"`),
      ...interpretation.roleTerms.slice(0, 2).map((term) => `site:twitter.com "${term}"`),
    ];
    const precisionQueries = withNewQueries(
      [...roleTargetedQueries, ...dorkQueries],
      input.plannedQueries,
    ).slice(0, Math.min(MULTIAGENT_MAX_QUERIES, baseBudget + 2));

    return {
      queries: precisionQueries,
      plannerMode: "precision",
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
    const results = input.excludeTerms?.length
      ? await searchTavilyWithExclusions(input.query, input.limit, input.excludeTerms)
      : await searchTavily(input.query, input.limit);
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

      // NOTE: minFollowers is intentionally NOT applied during discovery.
      // Filtering by followers biases toward popularity over relevance — a real
      // motion designer with 200 followers is more valuable than a CEO with 50K.
      // The user can still filter by followers in the UI after leads are found.

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
  normalizedQuery: Annotation<string>({
    reducer: (_left, right) => right || _left,
    default: () => "",
  }),
  queryType: Annotation<GoalInterpretation["queryType"]>({
    reducer: (_left, right) => right || _left,
    default: () => "role",
  }),
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
      normalizedQuery: interpretation.normalizedQuery,
      queryType: interpretation.queryType,
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
      normalizedQuery: state.normalizedQuery,
      queryType: state.queryType,
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

// ── Lightweight AI pre-screen ────────────────────────────────────────────────
// Runs inside the scorer node to filter obvious non-matches BEFORE they
// accumulate in the candidate pool and influence the validator's goal-reached
// decision. Uses the planner model (already warm) with a small structured output.

const PreScreenDecisionSchema = z.object({
  decisions: z.array(z.object({
    handle: z.string(),
    relevant: z.boolean(),
    confidence: z.number().min(0).max(100),
  })),
}).strict();

type SearchContext = {
  roleTerms: string[];
  bioTerms: string[];
  antiGoals: string[];
};

async function preScreenCandidates(
  niche: string,
  candidates: Array<{ candidate: XLeadCandidate; heuristic: { score: number; reasons: string[] }; evidence: SelectionEvidence[] }>,
  context?: SearchContext,
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();

  const model = getPlannerModel().withStructuredOutput(PreScreenDecisionSchema, { name: "lead_pre_screen" });

  const candidateSummaries = candidates.map((c) => ({
    handle: c.candidate.account.handle,
    name: c.candidate.account.name,
    bio: c.candidate.account.bio.slice(0, 200),
    posts: c.candidate.posts.slice(0, 2).map((p) => p.text.slice(0, 120)),
  }));

  // Build context-specific rules from the planner's interpretation
  const hasContext = context && (context.roleTerms.length > 0 || context.antiGoals.length > 0);

  const contextRules = hasContext
    ? [
      "",
      "DECISION CRITERIA (from planner — use these as your primary reference):",
      context!.roleTerms.length > 0
        ? `A person is relevant if their bio/posts indicate they are: ${context!.roleTerms.slice(0, 10).join(", ")}.`
        : "",
      context!.bioTerms.length > 0
        ? `Look for these bio signals: ${context!.bioTerms.slice(0, 8).join(", ")}.`
        : "",
      context!.antiGoals.length > 0
        ? `A person is NOT relevant if they are: ${context!.antiGoals.join(", ")}. These are different roles — reject them.`
        : "",
    ].filter(Boolean).join("\n")
    : "";

  try {
    const result = await withTimeout("OpenAI planner", 30_000, () => model.invoke([
      `Quick relevance check: does each profile ACTUALLY hold the role "${niche}"?`,
      "",
      "For each profile, check their bio and posts to decide if they genuinely do this work.",
      "- relevant=true: the person holds this exact role or a close synonym.",
      "- relevant=false: different role, organization, or insufficient evidence.",
      "- confidence: 80-100 clear match, 60-79 likely match, below 60 not a match.",
      "",
      "Key rules:",
      "- A keyword from the query appearing in a different context is NOT a match.",
      "- Organizations, communities, newsletters, job boards = always irrelevant.",
      "- Adjacent senior roles (VP, Head of, Director of) are NOT the same as the hands-on role unless the query specifically asks for them.",
      contextRules,
      "",
      JSON.stringify({ niche, candidates: candidateSummaries }),
    ].join("\n")));

    // Build set of handles that passed
    const passed = new Set<string>();
    for (const d of result.decisions) {
      if (d.relevant && d.confidence >= 60) {
        passed.add(d.handle.replace(/^@/, "").toLowerCase());
      }
    }
    return passed;
  } catch (error) {
    console.warn("[multiagent][pre-screen] AI pre-screen failed, passing all candidates through:", describeUpstreamError(error));
    // On failure, pass everyone through — the final screening will catch them
    return new Set(candidates.map((c) => c.candidate.account.handle.replace(/^@/, "").toLowerCase()));
  }
}

const HydrationScoringSubgraphState = Annotation.Root({
  niche: Annotation<string>,
  attempt: Annotation<number>,
  // Shared search context — propagated from parent graph so every subagent
  // (scorer, pre-screen, heuristic filter) can use the interpreted role terms
  roleTerms: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  bioTerms: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
  antiGoals: Annotation<string[]>({
    reducer: mergeUniqueStrings,
    default: () => [],
  }),
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
  /** How many candidates existed before pre-screening filtered them */
  rawCandidateCount: Annotation<number>({
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

    // Phase 3: AI pre-screen — filter obvious non-matches before they enter the pool
    // Pass roleTerms/bioTerms/antiGoals so the pre-screen has full interpreted context
    const passedHandles = await preScreenCandidates(state.niche, prescoredCandidates, {
      roleTerms: state.roleTerms,
      bioTerms: state.bioTerms,
      antiGoals: state.antiGoals,
    });

    const scored: ScoredCandidate[] = prescoredCandidates
      .filter((c) => passedHandles.has(c.candidate.account.handle.replace(/^@/, "").toLowerCase()))
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
      rawCandidateCount: prescoredCandidates.length,
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
      normalizedQuery: plan.normalizedQuery,
      queryType: plan.queryType,
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
      roleTerms: state.roleTerms,
      bioTerms: state.bioTerms,
      antiGoals: state.antiGoals,
      candidates: normalizeCandidatesFromScrapedState(state)
        .filter((candidate) => !knownHandles.has(candidate.account.handle.replace(/^@/, "").toLowerCase())),
    });

    return {
      activeNode: "scorer" as const,
      activeSubagent: scoredSubgraph.activeSubagent,
      completedNodes: ["scorer" as const],
      scored: scoredSubgraph.scored,
      hydratedCount: scoredSubgraph.hydratedCount,
      lastAttemptRawCount: scoredSubgraph.rawCandidateCount,
      hydrationTools: scoredSubgraph.hydrationTools,
      traceBatchUrls: [],
      traceQuery: undefined,
    };
  })
  .addNode("validator", async (state) => {
    const sortedScores = sortScoredCandidates(state.scored);
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

    // Detect precision filtering: many raw candidates scraped but few survived pre-screen
    // This means the queries found people, but the WRONG people — need more targeted queries
    const rawCount = state.lastAttemptRawCount;
    const precisionFiltered = rawCount > 0 && attemptYield < Math.ceil(rawCount * 0.15);

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
          : precisionFiltered
            ? "precision_filtered"
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
    const nextQueryBudget = state.recoveryState === "low_yield" || state.recoveryState === "precision_filtered"
      ? Math.min(MULTIAGENT_MAX_QUERIES, state.queryBudget + 2)
      : state.recoveryState === "rate_limited"
        ? Math.max(2, state.queryBudget - 1)
        : state.queryBudget;
    const nextScrapeBatchSize = state.recoveryState === "rate_limited" || state.recoveryState === "json_repair"
      ? Math.max(MULTIAGENT_MIN_BATCH_SIZE, Math.floor(state.scrapeBatchSize / 2))
      : state.scrapeBatchSize;

    let note: string;

    if (state.recoveryState === "precision_filtered") {
      note = "Pre-screening rejected most candidates as wrong role. Planner will generate roleTerms-targeted queries to find the exact role.";
    } else if (state.recoveryState === "rate_limited") {
      note = "Rate limits detected, so the graph narrowed query breadth and cut scraper batch size before retrying.";
    } else if (state.recoveryState === "json_repair") {
      note = "JSON repair mode engaged, so the planner will lean on deterministic heuristic queries and smaller scrape batches.";
    } else {
      note = "Low-yield recovery expanded the query pool for another bounded pass.";
    }

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
        excludeTerms: state.antiGoals.slice(0, 5),
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

      // Report the planner's interpreted search context so downstream screening can use it
      if (input.interpretationRecorder && (latestState.roleTerms?.length || latestState.bioTerms?.length || latestState.antiGoals?.length)) {
        input.interpretationRecorder({
          roleTerms: latestState.roleTerms ?? [],
          bioTerms: latestState.bioTerms ?? [],
          antiGoals: latestState.antiGoals ?? [],
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
