import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { ProjectAnalysisResult } from "@/lib/validations/projects";
import type { Priority } from "@/lib/validations/shared";
import type { OutreachTemplate } from "@/lib/validations/outreach";
import type { XProfile } from "@/lib/validations/search";
import type { InfluencerScore, XLeadCandidate } from "@/lib/x";
import {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_REASONING_EFFORT,
  SEARCH_AI_BATCH_SIZE,
  SEARCH_DISCOVERY_METADATA,
} from "@/lib/constants";

type StructuredResponse<T> = {
  schemaName: string;
  schema: z.ZodType<T>;
  instructions: string;
  input: string;
  fallback: T;
  maxOutputTokens?: number;
};

let client: OpenAI | null | undefined;

type SearchScreeningCandidate = XProfile & {
  samplePosts?: string[];
  source?: string;
};

const SEARCH_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "best",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "twitter",
  "x",
]);

const SEARCH_HARD_NON_LEAD_TERMS = [
  "assistant",
  "bot",
  "customer support",
  "newsroom",
  "parody account",
  "automated account",
];

const SEARCH_SOFT_NON_LEAD_TERMS = [
  "support",
  "newsroom",
  "breaking news",
  "parody",
  "automated",
  "fan account",
];

const SEARCH_HARD_EXCLUDE_HANDLES = new Set([
  "grok",
  "chatgpt",
  "claude",
  "claudeai",
  "gemini",
  "openai",
  "xai",
  "langchain",
  "ieee",
  "elonmusk",
]);

const SEARCH_FALLBACK_SCORE_THRESHOLD = 5;

const SEARCH_PERSON_TERMS = [
  "founder",
  "cofounder",
  "engineer",
  "developer",
  "designer",
  "builder",
  "cto",
  "ceo",
  "operator",
  "indie hacker",
  "i build",
  "building",
  "i'm",
  "i am",
  "my work",
  "i write",
  "i build",
  "working on",
];

const SEARCH_FIRST_PERSON_TERMS = [
  " i'm ",
  " i am ",
  " my ",
  " i build ",
  " working on ",
  " founded ",
  " building ",
  " i write ",
];

const SEARCH_ORG_TERMS = [
  "customer support",
  "newsroom",
  "parody account",
  "fan account",
  "automated account",
];

const SEARCH_COMPANY_TERMS = [
  "company",
  "startup",
  "software",
  "product",
  "platform",
  "team",
  "building",
  "we build",
  "we're building",
  "for developers",
  "for founders",
  "b2b",
  "saas",
];

function classifyCreatorStage(followers: number): InfluencerScore["stage"] {
  if (followers >= 250_000) return "macro";
  if (followers >= 50_000) return "mid";
  if (followers >= 10_000) return "micro";
  return "nano";
}

function getFallbackInfluencerScore(candidate: XLeadCandidate): InfluencerScore {
  const haystack = [
    candidate.account.name,
    candidate.account.handle,
    candidate.account.bio,
    candidate.posts.map((post) => post.text).join(" "),
  ].join(" ").toLowerCase();
  const nicheTerms = getSearchQueryTerms(candidate.niche);
  const nicheMatchScore = Math.min(
    100,
    nicheTerms.filter((term) => haystack.includes(term)).length * 18,
  );
  const engagementScore = Math.min(
    100,
    Math.round(
      Math.log10(
        candidate.metrics.avgLikes
        + candidate.metrics.avgReplies * 2
        + candidate.metrics.avgReposts * 2
        + 10,
      ) * 28,
    ),
  );
  const authenticityPenalty = SEARCH_SOFT_NON_LEAD_TERMS.some((term) => haystack.includes(term)) ? 20 : 0;
  const authenticityBonus = SEARCH_PERSON_TERMS.some((term) => haystack.includes(term)) ? 18 : 0;
  const authenticityScore = Math.max(0, Math.min(100, 65 + authenticityBonus - authenticityPenalty));
  const overallScore = Math.round((nicheMatchScore * 0.45) + (engagementScore * 0.25) + (authenticityScore * 0.3));
  const isInfluencer = overallScore >= 55 && authenticityScore >= 45;
  const fitForNiche = nicheMatchScore >= 40;

  return {
    is_influencer: isInfluencer,
    fit_for_niche: fitForNiche,
    overall_score: overallScore,
    stage: classifyCreatorStage(candidate.account.followers),
    niche_match_score: nicheMatchScore,
    engagement_score: engagementScore,
    authenticity_score: authenticityScore,
    topics: nicheTerms.slice(0, 5),
    notes: candidate.posts.slice(0, 2).map((post) => post.text).filter(Boolean),
    red_flags: authenticityPenalty > 0 ? ["Possible brand/product or non-person account signal"] : [],
  };
}

function getClient(): OpenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  client = apiKey ? new OpenAI({ apiKey }) : null;
  return client;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getSearchQueryTerms(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9+#.-]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && !SEARCH_QUERY_STOP_WORDS.has(term)),
  )];
}

function buildSearchCandidateText(candidate: SearchScreeningCandidate): string {
  return [
    candidate.displayName,
    candidate.username,
    candidate.bio,
    candidate.samplePosts?.join(" ") ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function hasPersonSignal(candidate: SearchScreeningCandidate, haystack: string): boolean {
  const displayName = candidate.displayName.trim();
  const looksLikeOrgName = /\b(partners|capital|labs|ventures|foundation|institute|media|studio|fund|org|university)\b/i.test(displayName);
  const looksLikePersonName = /^[a-z][a-z.'-]+(?:\s+[a-z][a-z.'-]+){1,3}$/i.test(displayName) && !looksLikeOrgName;
  const firstPersonSignal = SEARCH_FIRST_PERSON_TERMS.some((term) => haystack.includes(term));
  if (looksLikeOrgName) return firstPersonSignal;
  return looksLikePersonName || firstPersonSignal || SEARCH_PERSON_TERMS.some((term) => haystack.includes(term));
}

function hasCompanySignal(haystack: string): boolean {
  return SEARCH_COMPANY_TERMS.some((term) => haystack.includes(term));
}

function hasNonLeadSignal(candidate: SearchScreeningCandidate, haystack: string): boolean {
  return (
    SEARCH_HARD_EXCLUDE_HANDLES.has(candidate.username.toLowerCase())
    || SEARCH_SOFT_NON_LEAD_TERMS.some((term) => haystack.includes(term))
    || SEARCH_ORG_TERMS.some((term) => haystack.includes(term))
  );
}

function isHardRejectedSearchCandidate(candidate: SearchScreeningCandidate): boolean {
  const haystack = buildSearchCandidateText(candidate);
  const personSignal = hasPersonSignal(candidate, haystack);

  if (SEARCH_HARD_EXCLUDE_HANDLES.has(candidate.username.toLowerCase())) return true;
  if (SEARCH_HARD_NON_LEAD_TERMS.some((term) => haystack.includes(term)) && !personSignal) return true;

  return false;
}

function getFallbackSearchScore(query: string, candidate: SearchScreeningCandidate): number {
  if (isHardRejectedSearchCandidate(candidate)) return 0;

  const queryTerms = getSearchQueryTerms(query);
  const haystack = buildSearchCandidateText(candidate);
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term)).length;
  const personSignal = hasPersonSignal(candidate, haystack);
  const companySignal = hasCompanySignal(haystack);
  const hasWeakNonLeadSignal = hasNonLeadSignal(candidate, haystack);
  const followerScore = Math.min(20, Math.round(Math.log10(candidate.followersCount + 10) * 6));
  const postScore = candidate.samplePosts?.length ? 12 : 0;

  let score = Math.min(36, matchedTerms * 12) + followerScore + postScore;
  if (personSignal) score += 22;
  if (companySignal) score += 14;
  if (!personSignal && !companySignal) score -= 4;
  if (hasWeakNonLeadSignal && !personSignal && !companySignal) score -= 12;
  if (matchedTerms === 0 && !personSignal && !companySignal) score -= 8;

  return Math.max(0, Math.min(100, score));
}

function getFallbackScreenedIds(
  query: string,
  candidates: SearchScreeningCandidate[],
  maxResults: number,
): string[] {
  return candidates
    .map((candidate) => ({
      id: candidate.xUserId,
      score: getFallbackSearchScore(query, candidate),
      followers: candidate.followersCount,
    }))
    .filter((candidate) => candidate.score >= SEARCH_FALLBACK_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.followers - a.followers)
    .slice(0, maxResults)
    .map((candidate) => candidate.id);
}

function getFallbackScreeningDecisions(
  query: string,
  candidates: SearchScreeningCandidate[],
): Array<{ profileId: string; include: boolean; score: number }> {
  return candidates.map((candidate) => {
    const score = getFallbackSearchScore(query, candidate);
    return {
      profileId: candidate.xUserId,
      include: score >= SEARCH_FALLBACK_SCORE_THRESHOLD,
      score,
    };
  });
}

async function structuredResponse<T>({
  schemaName,
  schema,
  instructions,
  input,
  fallback,
  maxOutputTokens,
}: StructuredResponse<T>): Promise<T> {
  const openai = getClient();
  if (!openai) return fallback;

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
        effort: DEFAULT_OPENAI_REASONING_EFFORT as
          | "none"
          | "minimal"
          | "low"
          | "medium"
          | "high"
          | "xhigh",
      },
      text: {
        format: zodTextFormat(schema, schemaName),
        verbosity: "low",
      },
      max_output_tokens: maxOutputTokens,
    });

    return response.output_parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export async function rankProfilesForQuery(
  query: string,
  candidates: Array<XProfile & { samplePosts?: string[] }>,
): Promise<string[]> {
  const fallback = candidates.slice(0, 30).map((c) => c.xUserId);
  if (candidates.length <= 12) return fallback;

  const input = JSON.stringify({
    query,
    candidates: candidates.map((c) => ({
      id: c.xUserId,
      handle: `@${c.username}`,
      name: c.displayName,
      bio: c.bio,
      posts: c.samplePosts?.slice(0, 3) ?? [],
    })),
  });

  const result = await structuredResponse<{ profileIds: string[] }>({
    schemaName: "profile_relevance_ranking",
    schema: z.object({
      profileIds: z.array(z.string()),
    }),
    instructions:
      "Return only X profiles that are relevant to the search query. Be inclusive but remove clearly unrelated accounts. Keep the array ordered from most relevant to least relevant.",
    input,
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
  if (candidates.length === 0) return [];
  const prefilteredCandidates = candidates.filter((candidate) => !isHardRejectedSearchCandidate(candidate));
  if (prefilteredCandidates.length === 0) return [];

  const selectedScores = new Map<string, number>();

  for (const batch of chunk(prefilteredCandidates, SEARCH_AI_BATCH_SIZE)) {
    const validIds = new Set(batch.map((candidate) => candidate.xUserId));
    const result = await structuredResponse<{
      decisions: Array<{ profileId: string; include: boolean; score: number }>;
    }>({
      schemaName: "lead_search_screening",
      schema: z.object({
        decisions: z.array(z.object({
          profileId: z.string(),
          include: z.boolean(),
          score: z.number().int().min(0).max(100),
        })),
      }),
      instructions:
        "You are screening X/Twitter search results for an outreach CRM. Use a high-recall filter. Keep plausible leads when they are relevant to the niche, including both people and companies that could realistically be contacted. Reject only clearly unusable accounts such as assistants, bots, support/newsroom accounts, parody or fan accounts, global celebrity/public-figure accounts, and accounts that are plainly unrelated to the query. When uncertain, keep the account and give it a moderate score.",
      input: JSON.stringify({
        query,
        candidates: batch.map((candidate) => ({
          id: candidate.xUserId,
          handle: `@${candidate.username}`,
          name: candidate.displayName,
          bio: candidate.bio,
          followers: candidate.followersCount,
          source: candidate.source,
          posts: candidate.samplePosts?.slice(0, 3) ?? [],
        })),
      }),
      fallback: {
        decisions: getFallbackScreeningDecisions(query, batch),
      },
      maxOutputTokens: 3_000,
    });

    for (const decision of result.decisions) {
      if (!validIds.has(decision.profileId) || !decision.include) continue;
      const current = selectedScores.get(decision.profileId) ?? -1;
      if (decision.score > current) {
        selectedScores.set(decision.profileId, decision.score);
      }
    }
  }

  const selectedIds = prefilteredCandidates
    .filter((candidate) => selectedScores.has(candidate.xUserId))
    .sort((a, b) => {
      const scoreDiff = (selectedScores.get(b.xUserId) ?? 0) - (selectedScores.get(a.xUserId) ?? 0);
      return scoreDiff || b.followersCount - a.followersCount;
    })
    .slice(0, maxResults)
    .map((candidate) => candidate.xUserId);

  return selectedIds.length > 0
    ? selectedIds
    : getFallbackScreenedIds(query, prefilteredCandidates, maxResults);
}

function buildFallbackSearchQueries(query: string, seedHandle?: string): string[] {
  const cleanSeed = seedHandle?.replace(/^@/, "").trim();
  const normalized = query.trim();
  const variants = [
    normalized,
    `"${normalized}"`,
    `${normalized} founders builders engineers`,
    `${normalized} startups companies teams`,
    `${normalized} creators operators builders`,
    cleanSeed ? `${normalized} people and companies like @${cleanSeed}` : "",
  ];

  return [...new Set(variants.filter(Boolean))].slice(0, 5);
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
    schema: z.object({
      queries: z.array(z.string().min(1)).max(5),
    }),
    instructions:
      "Generate up to 5 X/Twitter search queries for lead discovery. Maximize recall on the first pass and avoid over-constraining. Keep the original meaning, add adjacent role and company variants when useful, and produce queries that can surface both individual and company leads in the niche. Prefer broad, useful search strings over narrow filters. Return plain query strings only.",
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
  const fallback = getFallbackInfluencerScore(candidate);

  return structuredResponse<InfluencerScore>({
    schemaName: "influencer_candidate_score",
    schema: z.object({
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
    }),
    instructions:
      "Score whether this X/Twitter account is a strong influencer or creator lead for the niche. Prefer real individual creators, founders, operators, engineers, and domain experts. Penalize brands, bots, generic product accounts, and weak niche fit. Return conservative, internally consistent scores.",
    input: JSON.stringify(candidate),
    fallback,
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

  const result = await structuredResponse<{ topics: string[]; priority: Priority }>({
    schemaName: "profile_topics_priority",
    schema: z.object({
      topics: z.array(z.string()),
      priority: z.enum(["P0", "P1"]),
    }),
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

  return result;
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
  const fallback = {
    summary:
      "Selected the strongest leads by audience size, posting activity, engagement, and commercial signals.",
    selectedLeadIds: input.candidates.slice(0, 8).map((candidate) => candidate.id),
  };

  if (input.candidates.length === 0) return fallback;

  const result = await structuredResponse<Pick<ProjectAnalysisResult, "summary" | "selectedLeadIds">>({
    schemaName: "project_lead_pool_analysis",
    schema: z.object({
      summary: z.string(),
      selectedLeadIds: z.array(z.string()).max(12),
    }),
    instructions:
      "You are selecting the best outreach targets from multiple X/Twitter project lists. Favor candidates that combine relevance, stronger audiences, consistent posting activity, meaningful engagement, and higher inferred commercial pricing power. Return a short summary and the ids of the best candidates.",
    input: JSON.stringify(input),
    fallback,
    maxOutputTokens: 320,
  });

  return {
    summary: result.summary,
    selectedLeadIds: result.selectedLeadIds.filter((id) =>
      input.candidates.some((candidate) => candidate.id === id),
    ),
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

  const result = await structuredResponse<typeof fallback>({
    schemaName: "outreach_template_generation",
    schema: z.object({
      title: z.string(),
      subject: z.string(),
      body: z.string(),
      replyRate: z.string(),
    }),
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

  return result;
}
