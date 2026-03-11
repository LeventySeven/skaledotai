import "server-only";
import { z } from "zod";
import type {
  XDataClient,
  XDiscoveryInput,
  XDiscoveryProvider,
  XLeadCandidate,
  XResolvedTweet,
  XProfilesPage,
  XPostSearchResult,
} from "./types";
import { XProviderRuntimeError } from "./types";
import { buildLeadCandidate } from "./discovery";
import { parseJsonResponse, parseJsonText } from "./json";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = 60_000;

const OpenRouterPostSchema = z.object({
  id: z.string().optional(),
  text: z.string().default(""),
  createdAt: z.string().default("1970-01-01T00:00:00.000Z"),
  likes: z.number().int().nonnegative().default(0),
  replies: z.number().int().nonnegative().default(0),
  reposts: z.number().int().nonnegative().default(0),
  views: z.number().int().nonnegative().optional(),
}).strict();

const OpenRouterLeadSchema = z.object({
  handle: z.string().min(1),
  name: z.string().min(1),
  bio: z.string().default(""),
  followers: z.number().int().nonnegative().default(0),
  following: z.number().int().nonnegative().default(0),
  isVerified: z.boolean().optional(),
  profileUrl: z.string().url().optional(),
  posts: z.array(OpenRouterPostSchema).default([]),
}).strict();

const OpenRouterLeadResponseSchema = z.object({
  leads: z.array(OpenRouterLeadSchema),
}).strict();

type OpenRouterLead = z.infer<typeof OpenRouterLeadSchema>;
const DEFAULT_OPENROUTER_DISCOVERY_MODEL = "x-ai/grok-4.1-fast";

function contentSnippet(value: unknown): string {
  if (typeof value === "string") return value.trim().slice(0, 240);
  if (Array.isArray(value)) {
    return value
      .map((item) => (item && typeof item === "object" && "text" in item ? String((item as { text: unknown }).text ?? "") : ""))
      .join("")
      .trim()
      .slice(0, 240);
  }
  try {
    return JSON.stringify(value).slice(0, 240);
  } catch {
    return String(value).slice(0, 240);
  }
}

function unsupported(capability: "lookup" | "network" | "tweets"): never {
  throw new XProviderRuntimeError({
    provider: "openrouter",
    capability,
    code: "CAPABILITY_UNSUPPORTED",
    message: `OpenRouter does not support ${capability} operations directly.`,
  });
}

function requireOpenRouterKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new XProviderRuntimeError({
      provider: "openrouter",
      code: "NOT_CONFIGURED",
      message: "OPENROUTER_API_KEY is not set.",
      missingEnv: ["OPENROUTER_API_KEY"],
    });
  }
  return apiKey;
}

const LEAD_JSON_SCHEMA: Record<string, unknown> = {
  name: "x_lead_candidates",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      leads: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            handle: { type: "string" },
            name: { type: "string" },
            bio: { type: "string" },
            followers: { type: "integer", minimum: 0 },
            following: { type: "integer", minimum: 0 },
            isVerified: { type: "boolean" },
            profileUrl: { type: "string" },
            posts: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  text: { type: "string" },
                  createdAt: { type: "string" },
                  likes: { type: "integer", minimum: 0 },
                  replies: { type: "integer", minimum: 0 },
                  reposts: { type: "integer", minimum: 0 },
                  views: { type: "integer", minimum: 0 },
                },
                required: ["text", "createdAt", "likes", "replies", "reposts"],
              },
            },
          },
          required: ["handle", "name", "bio", "followers", "following", "posts"],
        },
      },
    },
    required: ["leads"],
  },
};

export function buildOpenRouterDiscoveryRequest(input: XDiscoveryInput): Record<string, unknown> {
  return {
    model: process.env.OPENROUTER_X_DISCOVERY_MODEL ?? DEFAULT_OPENROUTER_DISCOVERY_MODEL,
    plugins: [
      {
        id: "web",
        engine: "native",
        max_results: Math.max(12, Math.min(50, input.limit * 2)),
        search_prompt: [
          "Search only for x.com or twitter.com profile and tweet pages.",
          "Prioritize real individual creators and operator accounts that are active in the niche.",
          "Do not surface AI assistants, products, brands, bots, org accounts, VC firms, media, or institutions.",
        ].join(" "),
      },
    ],
    messages: [
      {
        role: "system",
        content: [
          "Find high-quality X lead candidates for the provided niche.",
          "Only include real individual people who actively post in the niche or clearly personal operator accounts.",
          "Exclude AI assistants like Grok, brands, bots, official product accounts, publications, VC firms, and generic hype accounts.",
          "Return valid JSON that matches the provided schema.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          niche: input.niche,
          seedHandle: input.seedHandle,
          limit: input.limit,
          minFollowers: input.minFollowers ?? 0,
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: LEAD_JSON_SCHEMA,
    },
  };
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }

  return trimmed;
}

export function parseOpenRouterContent(value: unknown): unknown {
  if (typeof value === "string") {
    return parseJsonText(
      extractJsonText(value),
      (details) => new Error(`OpenRouter content was not valid JSON. ${details}`),
    );
  }
  if (Array.isArray(value)) {
    const text = value
      .map((item) => (item && typeof item === "object" && "text" in item ? String((item as { text: unknown }).text ?? "") : ""))
      .join("")
      .trim();
    return parseJsonText(
      extractJsonText(text),
      (details) => new Error(`OpenRouter content was not valid JSON. ${details}`),
    );
  }
  return value;
}

async function discoverWithOpenRouter(input: XDiscoveryInput): Promise<OpenRouterLead[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_BASE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${requireOpenRouterKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://skale.ai",
        "X-Title": process.env.OPENROUTER_APP_NAME ?? "Skale",
      },
      body: JSON.stringify(buildOpenRouterDiscoveryRequest(input)),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new XProviderRuntimeError({
      provider: "openrouter",
      capability: "discovery",
      code: "UPSTREAM_REQUEST_FAILED",
      message: `OpenRouter request failed.${error instanceof Error && error.name === "AbortError" ? ` Timed out after ${OPENROUTER_TIMEOUT_MS}ms.` : error instanceof Error ? ` ${error.message}` : ""}`,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const details = (await response.text()).trim();
    if (/not a valid model id/i.test(details)) {
      throw new XProviderRuntimeError({
        provider: "openrouter",
        capability: "discovery",
        code: "UPSTREAM_REQUEST_FAILED",
        message: `OpenRouter rejected the configured model ID. Set OPENROUTER_X_DISCOVERY_MODEL to a valid OpenRouter model slug or remove it to use the default (${DEFAULT_OPENROUTER_DISCOVERY_MODEL}). ${details}`,
      });
    }

    throw new XProviderRuntimeError({
      provider: "openrouter",
      capability: "discovery",
      code: response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_REQUEST_FAILED",
      message: `OpenRouter request failed with status ${response.status}.${details ? ` ${details}` : ""}`,
    });
  }

  const payload = await parseJsonResponse<{
    choices?: Array<{ message?: { content?: unknown } }>;
  }>(
    response,
    (details) => new XProviderRuntimeError({
      provider: "openrouter",
      capability: "discovery",
      code: "UPSTREAM_INVALID_RESPONSE",
      message: `OpenRouter returned a non-JSON response. ${details}`,
    }),
  );
  const content = payload.choices?.[0]?.message?.content;
  let parsedContent: unknown;
  try {
    parsedContent = parseOpenRouterContent(content);
  } catch (error) {
    throw new XProviderRuntimeError({
      provider: "openrouter",
      capability: "discovery",
      code: "UPSTREAM_INVALID_RESPONSE",
      message: `OpenRouter returned non-JSON content. ${error instanceof Error ? error.message : "Unexpected parse failure."} Snippet: ${contentSnippet(content)}`,
    });
  }

  let parsed;
  try {
    parsed = OpenRouterLeadResponseSchema.parse(parsedContent);
  } catch (error) {
    throw new XProviderRuntimeError({
      provider: "openrouter",
      capability: "discovery",
      code: "UPSTREAM_INVALID_RESPONSE",
      message: `OpenRouter returned JSON that did not match the expected schema. ${error instanceof Error ? error.message : "Schema validation failed."}`,
    });
  }
  return parsed.leads;
}

function toLeadCandidate(niche: string, lead: OpenRouterLead): XLeadCandidate {
  return buildLeadCandidate(
    "openrouter",
    niche,
    {
      xUserId: lead.handle.replace(/^@/, ""),
      username: lead.handle.replace(/^@/, ""),
      displayName: lead.name,
      bio: lead.bio,
      followersCount: lead.followers,
      followingCount: lead.following,
      verified: lead.isVerified,
      profileUrl: lead.profileUrl ?? `https://x.com/${lead.handle.replace(/^@/, "")}`,
    },
    lead.posts.length > 0 ? "post_search" : "profile_search",
    lead.posts.map((post) => ({
      id: post.id ?? `${lead.handle}:${post.createdAt}:${post.text}`,
      text: post.text,
      createdAt: post.createdAt,
      likeCount: post.likes,
      replyCount: post.replies,
      repostCount: post.reposts,
      viewCount: post.views ?? 0,
    })),
  );
}

export const openRouterDiscoveryProvider: XDiscoveryProvider = {
  provider: "openrouter",
  async discoverCandidates(input) {
    const leads = await discoverWithOpenRouter(input);
    return leads
      .map((lead) => toLeadCandidate(input.niche, lead))
      .filter((candidate) => candidate.account.followers >= (input.minFollowers ?? 0))
      .slice(0, Math.max(input.limit, 1));
  },
};

export const openRouterClient: XDataClient = {
  provider: "openrouter",
  searchUsers() {
    unsupported("lookup");
  },
  lookupUsersByUsernames() {
    unsupported("lookup");
  },
  getFollowersPage(): Promise<XProfilesPage> {
    unsupported("network");
  },
  getFollowingPage(): Promise<XProfilesPage> {
    unsupported("network");
  },
  searchRecentPosts(): Promise<XPostSearchResult> {
    unsupported("lookup");
  },
  searchAllPosts(): Promise<XPostSearchResult> {
    unsupported("lookup");
  },
  getUserTweets(): Promise<XResolvedTweet[]> {
    unsupported("tweets");
  },
};
