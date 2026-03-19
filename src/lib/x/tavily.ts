import "@/lib/server-runtime";
import { z } from "zod";
import { XProviderRuntimeError } from "./types";
import {
  requireEnv,
  throwNetworkFailure,
  throwResponseFailure,
  throwInvalidResponse,
  parseUpstreamJson,
  MULTIAGENT_FETCH_TIMEOUT_MS,
} from "./multiagent-shared";

export type TavilyResult = {
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

export function buildTavilySearchRequest(
  query: string,
  limit: number,
  options?: { excludeTerms?: string[] },
): Record<string, unknown> {
  // If antiGoal exclusion terms are provided, append them as negative keywords
  // to reduce irrelevant results at the source. This is cheaper than filtering later.
  let enhancedQuery = query;
  if (options?.excludeTerms?.length) {
    // Take top 3 exclusions to avoid making the query too long for Tavily
    const exclusions = options.excludeTerms
      .slice(0, 3)
      .map((term) => `-"${term}"`)
      .join(" ");
    enhancedQuery = `${query} ${exclusions}`;
  }

  return {
    api_key: requireEnv("TAVILY_API_KEY"),
    query: enhancedQuery,
    search_depth: "advanced",
    include_domains: ["x.com", "twitter.com"],
    max_results: Math.max(5, Math.min(20, Math.ceil(limit / 2))),
  };
}

export async function searchTavilyWithExclusions(
  query: string,
  limit: number,
  excludeTerms?: string[],
): Promise<TavilyResult[]> {
  return searchTavilyInternal(query, limit, { excludeTerms });
}

export async function searchTavily(query: string, limit: number): Promise<TavilyResult[]> {
  return searchTavilyInternal(query, limit);
}

async function searchTavilyInternal(
  query: string,
  limit: number,
  options?: { excludeTerms?: string[] },
): Promise<TavilyResult[]> {
  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MULTIAGENT_FETCH_TIMEOUT_MS);

    response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildTavilySearchRequest(query, limit, options)),
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
  } catch (error) {
    throwNetworkFailure("discovery", "Tavily", error);
  }

  if (!response.ok) {
    await throwResponseFailure("discovery", "Tavily", response);
  }

  try {
    const payload = TavilyResponseSchema.parse(await parseUpstreamJson(response, "Tavily", "discovery"));
    // Sort by Tavily's relevance score when available (don't discard free signal)
    return payload.results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
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

      urls.add(`https://x.com/${handle.toLowerCase()}`);
    } catch {
      continue;
    }

    if (urls.size >= limit) break;
  }

  return [...urls];
}
