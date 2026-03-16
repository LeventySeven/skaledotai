import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { ProjectAnalysisResult } from "@/lib/validations/projects";
import type { Priority } from "@/lib/validations/shared";
import type { OutreachTemplate } from "@/lib/validations/outreach";
import type { XProfile } from "@/lib/validations/search";
import type { LeadReasoningResult } from "@/lib/validations/lead-reasoning";
import type { InfluencerScore, XLeadCandidate } from "@/lib/x";
import {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_REASONING_EFFORT,
  SEARCH_AI_BATCH_SIZE,
  SEARCH_DISCOVERY_METADATA,
} from "@/lib/constants";
import type { SearchScreeningCandidate } from "@/lib/screening-heuristics";
import {
  buildFallbackSearchQueries,
  getFallbackInfluencerScore,
  getFallbackScreenedIds,
  getFallbackScreeningDecisions,
  isHardRejectedSearchCandidate,
} from "@/lib/screening-heuristics";

// ── Types ─────────────────────────────────────────────────────────────────────

type StructuredResponse<T> = {
  schemaName: string;
  schema: z.ZodType<T>;
  instructions: string;
  input: string;
  fallback: T;
  maxOutputTokens?: number;
};

type StructuredResponseResult<T> = {
  data: T;
  usedFallback: boolean;
};

// ── Client ────────────────────────────────────────────────────────────────────

let client: OpenAI | null | undefined;

function getClient(): OpenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  client = apiKey ? new OpenAI({ apiKey }) : null;
  return client;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ── Response schemas ──────────────────────────────────────────────────────────

const RankingSchema = z.object({
  profileIds: z.array(z.string()),
});

const ScreeningSchema = z.object({
  decisions: z.array(z.object({
    profileId: z.string(),
    include: z.boolean(),
    score: z.number().int().min(0).max(100),
    reason: z.string().default(""),
  })),
});

const QueryExpansionSchema = z.object({
  queries: z.array(z.string().min(1)).max(5),
});

const InfluencerScoreSchema = z.object({
  is_influencer: z.boolean(),
  fit_for_niche: z.boolean(),
  overall_score: z.number().int().min(0).max(100),
  stage: z.enum(["nano", "micro", "mid", "macro"]),
  niche_match_score: z.number().int().min(0).max(100),
  engagement_score: z.number().int().min(0).max(100),
  authenticity_score: z.number().int().min(0).max(100),
  topics: z.array(z.string()),
  notes: z.array(z.string()),
  red_flags: z.array(z.string()),
});

const TopicsPrioritySchema = z.object({
  topics: z.array(z.string()),
  priority: z.enum(["P0", "P1"]),
});

const LeadPoolAnalysisSchema = z.object({
  summary: z.string(),
  selectedLeadIds: z.array(z.string()).max(12),
});

const OutreachTemplateSchema = z.object({
  title: z.string(),
  subject: z.string(),
  body: z.string(),
  replyRate: z.string(),
});

const LeadReasoningSchema = z.object({
  summary: z.string(),
  alignmentBullets: z.array(z.string()).min(1).max(5),
  userGoals: z.array(z.string()).min(1).max(3),
  confidence: z.number().int().min(0).max(100),
  tools: z.array(z.string()).default([]),
  subagents: z.array(z.string()).default([]),
  evidence: z.array(z.object({
    source: z.enum(["name", "handle", "bio", "post"]),
    snippet: z.string(),
    whyItAligns: z.string(),
  })).default([]),
});

// ── Core AI wrapper ───────────────────────────────────────────────────────────

async function structuredResponse<T>({
  schemaName,
  schema,
  instructions,
  input,
  fallback,
  maxOutputTokens,
}: StructuredResponse<T>): Promise<T> {
  const result = await structuredResponseWithMeta({
    schemaName,
    schema,
    instructions,
    input,
    fallback,
    maxOutputTokens,
  });

  return result.data;
}

async function structuredResponseWithMeta<T>({
  schemaName,
  schema,
  instructions,
  input,
  fallback,
  maxOutputTokens,
}: StructuredResponse<T>): Promise<StructuredResponseResult<T>> {
  const openai = getClient();
  if (!openai) return { data: fallback, usedFallback: true };

  try {
    const response = await openai.responses.parse({
      model: DEFAULT_OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: instructions }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: input }],
        },
      ],
      reasoning: {
        effort: DEFAULT_OPENAI_REASONING_EFFORT,
      },
      text: {
        format: zodTextFormat(schema, schemaName),
        verbosity: "low",
      },
      max_output_tokens: maxOutputTokens,
    });

    if (response.output_parsed) {
      return {
        data: response.output_parsed,
        usedFallback: false,
      };
    }

    return {
      data: fallback,
      usedFallback: true,
    };
  } catch (error) {
    console.warn("[openai][structured-response]", JSON.stringify({
      schema: schemaName,
      message: error instanceof Error ? error.message : String(error),
    }));
    return {
      data: fallback,
      usedFallback: true,
    };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function rankProfilesForQuery(
  query: string,
  candidates: Array<XProfile & { samplePosts?: string[] }>,
): Promise<string[]> {
  const fallback = candidates.slice(0, 30).map((c) => c.xUserId);
  if (candidates.length <= 12) return fallback;

  const result = await structuredResponse<{ profileIds: string[] }>({
    schemaName: "profile_relevance_ranking",
    schema: RankingSchema,
    instructions:
      "Return only X profiles that are relevant to the search query. Be inclusive but remove clearly unrelated accounts. Keep the array ordered from most relevant to least relevant.",
    input: JSON.stringify({
      query,
      candidates: candidates.map((c) => ({
        id: c.xUserId,
        handle: `@${c.username}`,
        name: c.displayName,
        bio: c.bio,
        posts: c.samplePosts?.slice(0, 3) ?? [],
      })),
    }),
    fallback: { profileIds: fallback },
    maxOutputTokens: 220,
  });

  return result.profileIds;
}

export async function screenProfilesForLeadSearch(
  query: string,
  candidates: SearchScreeningCandidate[],
  maxResults: number,
): Promise<string[]> {
  const result = await screenProfilesForLeadSearchDetailed(query, candidates, maxResults);
  return result.selectedIds;
}

export type ScreeningInterpretation = {
  roleTerms: string[];
  bioTerms: string[];
  antiGoals: string[];
};

export async function screenProfilesForLeadSearchDetailed(
  query: string,
  candidates: SearchScreeningCandidate[],
  maxResults: number,
  interpretation?: ScreeningInterpretation,
): Promise<{
  selectedIds: string[];
  selectedReasons: Map<string, string>;
  batchSummaries: Array<{
    candidateCount: number;
    includedCount: number;
    usedFallback: boolean;
  }>;
}> {
  if (candidates.length === 0) {
    return {
      selectedIds: [],
      selectedReasons: new Map(),
      batchSummaries: [],
    };
  }
  const prefilteredCandidates = candidates.filter((candidate) => !isHardRejectedSearchCandidate(candidate, query));
  if (prefilteredCandidates.length === 0) {
    return {
      selectedIds: [],
      selectedReasons: new Map(),
      batchSummaries: [],
    };
  }

  const selectedScores = new Map<string, number>();
  const selectedReasons = new Map<string, string>();
  const batchSummaries: Array<{
    candidateCount: number;
    includedCount: number;
    usedFallback: boolean;
  }> = [];

  // Build context-specific decision criteria from the planner's interpretation
  const hasInterpretation = interpretation && (interpretation.roleTerms.length > 0 || interpretation.antiGoals.length > 0);

  const criteriaBlock = hasInterpretation
    ? [
      "",
      "DECISION CRITERIA (from planner — these define what matches and what doesn't for THIS specific query):",
      interpretation!.roleTerms.length > 0
        ? `Include if the person is: ${interpretation!.roleTerms.slice(0, 12).join(", ")}.`
        : "",
      interpretation!.bioTerms.length > 0
        ? `Bio signals that indicate a match: ${interpretation!.bioTerms.slice(0, 10).join(", ")}.`
        : "",
      interpretation!.antiGoals.length > 0
        ? `REJECT if the person is: ${interpretation!.antiGoals.join(", ")}. These are different roles.`
        : "",
    ].filter(Boolean).join("\n")
    : "";

  const screeningPrompt = `Confirm whether pre-screened X/Twitter profiles match the search query. These candidates already passed an initial check — verify and score accurately.

RULES:
1. Include people who clearly hold the queried role or a close synonym. Reject people in different roles, even adjacent ones.
2. Do NOT use partial keyword matches as evidence. A query keyword in a different context is not a match.
3. Exclude organizations, companies, communities, newsletters, job boards — only real individual people.
4. Follower count is irrelevant.
${criteriaBlock}

Score: 80-100 clearly holds the exact role or close synonym, 50-79 likely match with reasonable evidence, 0-49 does NOT match.
Reason: quote the specific part of bio/posts that shows they hold this role. 1-2 sentences.
When in doubt about a borderline candidate, lean toward including with a lower score — the pre-screen already filtered obvious mismatches.`;

  const batches = chunk(prefilteredCandidates, SEARCH_AI_BATCH_SIZE);

  // Run all screening batches in parallel for speed
  const batchResults = await Promise.all(batches.map(async (batch) => {
    const validIds = new Set(batch.map((candidate) => candidate.xUserId));
    const result = await structuredResponseWithMeta<{
      decisions: Array<{ profileId: string; include: boolean; score: number; reason: string }>;
    }>({
      schemaName: "lead_search_screening",
      schema: ScreeningSchema,
      instructions: screeningPrompt,
      input: JSON.stringify({
        query,
        candidates: batch.map((candidate) => {
          const websiteMatch = candidate.bio.match(/https?:\/\/[^\s,)]+/i) ?? candidate.bio.match(/\b([a-z0-9][-a-z0-9]*\.(com|io|co|dev|app|xyz|ai|org|net|me))\b/i);
          return {
            id: candidate.xUserId,
            handle: `@${candidate.username}`,
            name: candidate.displayName,
            bio: candidate.bio,
            website: websiteMatch?.[0] ?? null,
            posts: candidate.samplePosts?.slice(0, 2) ?? [],
          };
        }),
      }),
      fallback: {
        decisions: getFallbackScreeningDecisions(query, batch),
      },
      maxOutputTokens: 4_000,
    });
    return { batch, validIds, result };
  }));

  for (const { batch, validIds, result } of batchResults) {
    let includedCount = 0;

    for (const decision of result.data.decisions) {
      if (!validIds.has(decision.profileId) || !decision.include) continue;
      // Require minimum score of 50 — pre-screening already filtered obvious mismatches
      if (decision.score < 50) continue;
      const current = selectedScores.get(decision.profileId) ?? -1;
      if (decision.score > current) {
        selectedScores.set(decision.profileId, decision.score);
        if (decision.reason) {
          selectedReasons.set(decision.profileId, decision.reason);
        }
      }
      includedCount += 1;
    }

    batchSummaries.push({
      candidateCount: batch.length,
      includedCount,
      usedFallback: result.usedFallback,
    });
  }

  // Keep ALL relevant leads — more relevant leads = better. No artificial cap.
  const selectedIds = prefilteredCandidates
    .filter((candidate) => selectedScores.has(candidate.xUserId))
    .sort((a, b) => {
      const scoreDiff = (selectedScores.get(b.xUserId) ?? 0) - (selectedScores.get(a.xUserId) ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      // Tiebreaker: prefer candidates with sample posts (active niche participation)
      const postDiff = (b.samplePosts?.length ?? 0) - (a.samplePosts?.length ?? 0);
      return postDiff || b.bio.length - a.bio.length;
    })
    .map((candidate) => candidate.xUserId);

  return {
    selectedIds: selectedIds.length > 0
      ? selectedIds
      : getFallbackScreenedIds(query, prefilteredCandidates, maxResults),
    selectedReasons,
    batchSummaries,
  };
}

export async function expandLeadSearchQueries(
  query: string,
  seedHandle?: string,
): Promise<string[]> {
  const fallback = buildFallbackSearchQueries(query, seedHandle);
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) return fallback;

  const result = await structuredResponse<{ queries: string[] }>({
    schemaName: "lead_search_query_expansion",
    schema: QueryExpansionSchema,
    instructions:
      "Generate up to 5 X/Twitter search queries for lead discovery. Focus on finding INDIVIDUALS who hold the exact role described in the query. Keep the original meaning — do not broaden to adjacent or senior roles. For example if the query is 'product designers', search for product designers, UX designers, UI designers — NOT product managers, heads of product, or CEOs. Do not generate queries that would primarily surface companies or organizations. Return plain query strings only.",
    input: JSON.stringify({
      query: normalizedQuery,
      seedHandle,
      parseAccountsTarget: SEARCH_DISCOVERY_METADATA.parseAccountsTarget,
    }),
    fallback: { queries: fallback },
    maxOutputTokens: 220,
  });

  const queries = [...new Set(result.queries.map((item) => item.trim()).filter(Boolean))];
  return queries.length > 0 ? queries : fallback;
}

export async function scoreLeadCandidate(candidate: XLeadCandidate): Promise<InfluencerScore> {
  return structuredResponse<InfluencerScore>({
    schemaName: "influencer_candidate_score",
    schema: InfluencerScoreSchema,
    instructions:
      "Score whether this X/Twitter account is a strong influencer or creator lead for the niche. Prefer real individual creators, founders, operators, engineers, and domain experts. Penalize brands, bots, generic product accounts, and weak niche fit. Return conservative, internally consistent scores.",
    input: JSON.stringify(candidate),
    fallback: getFallbackInfluencerScore(candidate),
    maxOutputTokens: 240,
  });
}

export async function extractTopicsAndPriority(
  niche: string | undefined,
  bio: string,
  posts: string[],
): Promise<{ topics: string[]; priority: Priority }> {
  if (bio.trim().length === 0 && posts.length === 0) {
    return { topics: [], priority: "P1" };
  }

  return structuredResponse<{ topics: string[]; priority: Priority }>({
    schemaName: "profile_topics_priority",
    schema: TopicsPrioritySchema,
    instructions: niche
      ? `Analyze the X profile and recent posts for creator outreach. The niche we care about is "${niche}". Return up to 5 short topics and a priority of P0 or P1.`
      : "Analyze the X profile and recent posts. Return up to 5 short topics and a conservative outreach priority of P0 or P1.",
    input: JSON.stringify({
      bio,
      posts: posts.slice(0, 20),
    }),
    fallback: { topics: [], priority: "P1" },
    maxOutputTokens: 160,
  });
}

export async function analyzeLeadPoolForProject(input: {
  projectNames: string[];
  candidates: Array<{
    id: string;
    name: string;
    handle: string;
    bio: string;
    followers: number;
    postCount: number;
    avgViews: number;
    avgLikes: number;
    avgReplies: number;
    avgReposts: number;
    topics: string[];
    samplePosts: string[];
    pricingSignal: string;
  }>;
}): Promise<Pick<ProjectAnalysisResult, "summary" | "selectedLeadIds">> {
  const result = await analyzeLeadPoolForProjectDetailed(input);
  return {
    summary: result.summary,
    selectedLeadIds: result.selectedLeadIds,
  };
}

export async function analyzeLeadPoolForProjectDetailed(input: {
  projectNames: string[];
  candidates: Array<{
    id: string;
    name: string;
    handle: string;
    bio: string;
    followers: number;
    postCount: number;
    avgViews: number;
    avgLikes: number;
    avgReplies: number;
    avgReposts: number;
    topics: string[];
    samplePosts: string[];
    pricingSignal: string;
  }>;
}): Promise<Pick<ProjectAnalysisResult, "summary" | "selectedLeadIds"> & { usedFallback: boolean }> {
  const fallback = {
    summary:
      "Selected the strongest leads by audience size, posting activity, engagement, and commercial signals.",
    selectedLeadIds: input.candidates.slice(0, 8).map((candidate) => candidate.id),
  };

  if (input.candidates.length === 0) {
    return {
      ...fallback,
      usedFallback: true,
    };
  }

  const result = await structuredResponseWithMeta<Pick<ProjectAnalysisResult, "summary" | "selectedLeadIds">>({
    schemaName: "project_lead_pool_analysis",
    schema: LeadPoolAnalysisSchema,
    instructions:
      "You are selecting the best outreach targets from multiple X/Twitter project lists. Favor candidates that combine relevance, stronger audiences, consistent posting activity, meaningful engagement, and higher inferred commercial pricing power. Return a short summary and the ids of the best candidates.",
    input: JSON.stringify(input),
    fallback,
    maxOutputTokens: 320,
  });

  return {
    summary: result.data.summary,
    selectedLeadIds: result.data.selectedLeadIds.filter((id) =>
      input.candidates.some((candidate) => candidate.id === id),
    ),
    usedFallback: result.usedFallback,
  };
}

export async function generateOutreachTemplate(input: {
  projectNames: string[];
  leads: Array<{
    name: string;
    handle: string;
    bio: string;
    followers: number;
    topics: string[];
    postActivity: string;
  }>;
  templateExamples: Array<{
    title: string;
    subject: string;
    body: string;
    replyRate: string;
  }>;
  requestedStyle?: string;
}): Promise<Omit<OutreachTemplate, "id" | "generated">> {
  const fallbackExample = input.templateExamples[0] ?? {
    title: "Template",
    subject: "Quick note",
    body: "Hi {{name}},\n\nI came across your work and was really impressed.\n\nWould love to connect!\n\nBest,",
    replyRate: "35%",
  };

  const primaryProject = input.projectNames[0]?.trim() || "selected project";
  const projectLabel = primaryProject.length > 42 ? primaryProject.slice(0, 42).trim() : primaryProject;
  const strongestLead = input.leads[0];
  const strongestTopic =
    strongestLead?.topics.find((topic) => topic.trim().length > 0)
    ?? strongestLead?.bio
      .split(/[,.|]/)
      .map((part) => part.trim())
      .find((part) => part.length > 0)
    ?? "your recent work";

  const fallback = {
    title: `${projectLabel} intro`,
    subject: `${projectLabel} collaboration idea`,
    body:
      `Hi {{name}},\n\n` +
      `I was reviewing people in ${projectLabel} and your perspective on ${strongestTopic} stood out.\n` +
      `Would love to compare notes and see if there is a fit to collaborate.\n\n` +
      "Best,",
    replyRate: fallbackExample.replyRate,
  };

  return structuredResponse<typeof fallback>({
    schemaName: "outreach_template_generation",
    schema: OutreachTemplateSchema,
    instructions:
      "Generate one outreach template for X/Twitter leads. Keep the output close in length and simplicity to the provided examples, but do not copy any example sentence verbatim. Personalize the message using the selected project context, lead bios, lead topics, and posting activity. The result must feel like it was written for this project set specifically, not like a generic cold message. Use only plain text, keep {{name}} intact, avoid hype, and keep the message compact. Reply rate should be a short estimate like 35% or 42%.",
    input: JSON.stringify({
      ...input,
      variationHint: new Date().toISOString(),
      hardRules: [
        "Do not repeat the example subject lines exactly.",
        "Do not repeat the example opening lines exactly.",
        "Mention a concrete project/theme/topic signal from the provided context.",
        "Keep the overall size similar to the examples.",
      ],
    }),
    fallback,
    maxOutputTokens: 260,
  });
}

export async function generateLeadReasoning(input: {
  query: string;
  lead: {
    name: string;
    handle: string;
    bio: string;
    location?: string;
    followers: number;
    following?: number;
  };
  stats?: {
    postCount: number;
    avgViews?: number;
    avgLikes?: number;
    avgReplies?: number;
    avgReposts?: number;
    topTopics?: string[];
  } | null;
  tools: string[];
  subagents: string[];
}): Promise<LeadReasoningResult> {
  const fallbackEvidence: LeadReasoningResult["evidence"] = [];
  if (input.lead.bio.trim().length > 0) {
    const bioSnippet = input.lead.bio.length > 180 ? input.lead.bio.slice(0, 180) + "..." : input.lead.bio;
    fallbackEvidence.push({
      source: "bio",
      snippet: bioSnippet,
      whyItAligns: `Bio: "${bioSnippet}"`,
    });
  }

  const fallback = {
    summary: input.lead.bio.trim().length > 0
      ? `Bio: "${input.lead.bio.slice(0, 120)}${input.lead.bio.length > 120 ? "..." : ""}"`
      : `No bio available for @${input.lead.handle}.`,
    alignmentBullets: [
      input.lead.bio.trim().length > 0
        ? `Bio says: "${input.lead.bio.slice(0, 160)}${input.lead.bio.length > 160 ? "..." : ""}"`
        : "No bio text available.",
      input.stats?.topTopics?.length
        ? `Posts about: ${input.stats.topTopics.slice(0, 3).join(", ")}.`
        : "No post topics available.",
    ],
    userGoals: [
      `Search query: "${input.query}"`,
    ],
    confidence: input.lead.bio.trim().length > 0 ? 40 : 10,
    tools: input.tools,
    subagents: input.subagents,
    evidence: fallbackEvidence,
  } satisfies LeadReasoningResult;

  const result = await structuredResponse<LeadReasoningResult>({
    schemaName: "lead_reasoning",
    schema: LeadReasoningSchema,
    instructions:
      "Analyze whether this profile matches the search query. Read the full bio and understand what the person actually does for a living.\n\nRules:\n- Summary: one sentence stating what the person does. No filler.\n- alignmentBullets: quote the specific part of the bio that proves they hold the exact role from the query. No vague statements.\n- Evidence: quote the bio text that shows they actually do this work.\n- If the person holds a DIFFERENT role (e.g. query is 'product designers' but person is a CEO, product manager, or researcher), set confidence below 20.\n- If the profile belongs to an organization/company/community, set confidence below 10.\n- Never mention follower count.\n- Match the ROLE described in the query, not just keywords. 'Product' alone does not mean 'product designer'. 'Design' in 'designed a company' does not mean designer.",
    input: JSON.stringify(input),
    fallback,
    maxOutputTokens: 500,
  });

  return {
    ...result,
    tools: result.tools.length > 0 ? result.tools : input.tools,
    subagents: result.subagents.length > 0 ? result.subagents : input.subagents,
    evidence: result.evidence.length > 0 ? result.evidence : fallbackEvidence,
  };
}
