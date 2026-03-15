import type { XProfile } from "@/lib/validations/search";
import type { InfluencerScore, XLeadCandidate } from "@/lib/x";

export type SearchScreeningCandidate = XProfile & {
  samplePosts?: string[];
  source?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

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

export const SEARCH_HARD_EXCLUDE_HANDLES = new Set([
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

export const SEARCH_FALLBACK_SCORE_THRESHOLD = 5;

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

// ── Utilities ─────────────────────────────────────────────────────────────────

export function getSearchQueryTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !SEARCH_QUERY_STOP_WORDS.has(term));

  // Build meaningful multi-word phrases alongside single words
  const terms: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    terms.push(`${words[i]} ${words[i + 1]}`);
  }
  if (words.length >= 2) {
    terms.push(words.join(" "));
  }
  terms.push(...words);

  return [...new Set(terms)];
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

// ── Signal detection ──────────────────────────────────────────────────────────

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

export function isHardRejectedSearchCandidate(candidate: SearchScreeningCandidate, _query?: string): boolean {
  const haystack = buildSearchCandidateText(candidate);
  const personSignal = hasPersonSignal(candidate, haystack);
  if (SEARCH_HARD_EXCLUDE_HANDLES.has(candidate.username.toLowerCase())) return true;
  if (SEARCH_HARD_NON_LEAD_TERMS.some((term) => haystack.includes(term)) && !personSignal) return true;
  return false;
}

// ── Fallback scoring ──────────────────────────────────────────────────────────

export function getFallbackSearchScore(query: string, candidate: SearchScreeningCandidate): number {
  if (isHardRejectedSearchCandidate(candidate, query)) return 0;

  const queryTerms = getSearchQueryTerms(query);
  const haystack = buildSearchCandidateText(candidate);
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term)).length;
  const personSignal = hasPersonSignal(candidate, haystack);
  const companySignal = hasCompanySignal(haystack);
  const hasWeakNonLeadSignal = hasNonLeadSignal(candidate, haystack);
  const postScore = candidate.samplePosts?.length ? 15 : 0;

  let score = Math.min(45, matchedTerms * 15) + postScore;
  if (personSignal) score += 22;
  if (companySignal) score += 14;
  if (!personSignal && !companySignal) score -= 4;
  if (hasWeakNonLeadSignal && !personSignal && !companySignal) score -= 12;
  if (matchedTerms === 0 && !personSignal && !companySignal) score -= 8;

  return Math.max(0, Math.min(100, score));
}

export function getFallbackScreenedIds(
  query: string,
  candidates: SearchScreeningCandidate[],
  _maxResults: number,
): string[] {
  return candidates
    .map((candidate) => ({
      id: candidate.xUserId,
      score: getFallbackSearchScore(query, candidate),
      followers: candidate.followersCount,
    }))
    .filter((candidate) => candidate.score >= SEARCH_FALLBACK_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.id);
}

export function getFallbackScreeningDecisions(
  query: string,
  candidates: SearchScreeningCandidate[],
): Array<{ profileId: string; include: boolean; score: number; reason: string }> {
  const queryTerms = getSearchQueryTerms(query);
  return candidates.map((candidate) => {
    const score = getFallbackSearchScore(query, candidate);
    const haystack = [candidate.displayName, candidate.username, candidate.bio, candidate.samplePosts?.join(" ") ?? ""].join(" ").toLowerCase();
    const matched = queryTerms.filter((term) => haystack.includes(term)).slice(0, 3);
    return {
      profileId: candidate.xUserId,
      include: score >= SEARCH_FALLBACK_SCORE_THRESHOLD,
      score,
      reason: matched.length > 0 ? `Bio/posts contain: ${matched.map((t) => `"${t}"`).join(", ")}` : "",
    };
  });
}

export function buildFallbackSearchQueries(query: string, seedHandle?: string): string[] {
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

// ── Influencer fallback scoring ───────────────────────────────────────────────

function classifyCreatorStage(followers: number): InfluencerScore["stage"] {
  if (followers >= 250_000) return "macro";
  if (followers >= 50_000) return "mid";
  if (followers >= 10_000) return "micro";
  return "nano";
}

export function getFallbackInfluencerScore(candidate: XLeadCandidate): InfluencerScore {
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
