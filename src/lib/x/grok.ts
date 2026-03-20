import "@/lib/server-runtime";
import type { XProfile } from "@/lib/validations/search";
import { XProviderRuntimeError } from "./types";

// ── Constants ────────────────────────────────────────────────────────────────

const GROK_API_BASE = "https://api.x.ai";
// Use non-reasoning model — documented for x_search tool use
const GROK_MODEL = process.env.XAI_MODEL ?? "grok-3-fast-latest";
const GROK_SEARCH_TIMEOUT_MS = 45_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGrokApiKey(): string | null {
  return process.env.XAI_API_KEY?.trim() || null;
}

export function isGrokConfigured(): boolean {
  return !!getGrokApiKey();
}

// ── Types (x.ai /v1/responses API) ──────────────────────────────────────────

type GrokInputMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GrokXSearchTool = {
  type: "x_search";
  /** Restrict results to specific X handles (max 10) */
  allowed_x_handles?: string[];
  /** Exclude specific X handles from results (max 10) */
  excluded_x_handles?: string[];
  /** ISO8601 start date filter, e.g. "2025-01-01" */
  from_date?: string;
  /** ISO8601 end date filter */
  to_date?: string;
};

type GrokResponsesRequest = {
  model: string;
  input: GrokInputMessage[];
  tools: GrokXSearchTool[];
  temperature?: number;
};

type GrokResponsesOutput = {
  id: string;
  output: Array<{
    id: string;
    type: string;
    role: string;
    content: Array<{
      type: string;
      text: string;
      annotations?: unknown[];
    }>;
  }>;
};

// ── Profile extraction ───────────────────────────────────────────────────────

const X_HANDLE_RE = /@([A-Za-z0-9_]{1,15})\b/g;

/**
 * Parse Grok's natural-language response to extract X profile handles and any
 * bio/description snippets it provides. Grok returns prose describing users it
 * found via X search — we extract handles and accompanying text.
 */
function extractProfilesFromGrokResponse(text: string): Array<{
  handle: string;
  name: string;
  bio: string;
}> {
  const profiles: Array<{ handle: string; name: string; bio: string }> = [];
  const seen = new Set<string>();

  // Split into lines/paragraphs for per-profile extraction
  const blocks = text.split(/\n{1,}/);

  for (const block of blocks) {
    const handleMatches = [...block.matchAll(X_HANDLE_RE)];
    if (handleMatches.length === 0) continue;

    for (const match of handleMatches) {
      const handle = match[1].toLowerCase();
      if (seen.has(handle)) continue;
      seen.add(handle);

      // Try to extract a display name — often appears as "**Name** (@handle)" or "Name (@handle)"
      const nameMatch = block.match(
        new RegExp(`(?:\\*\\*([^*]+)\\*\\*|([A-Z][A-Za-z\\s.'-]+))\\s*\\(@?${match[1]}\\)`, "i"),
      );
      const name = nameMatch?.[1]?.trim() || nameMatch?.[2]?.trim() || "";

      // Use the rest of the block as a bio snippet (strip the name/handle portion)
      const bioText = block
        .replace(/\*\*[^*]+\*\*/g, "")
        .replace(/@[A-Za-z0-9_]+/g, "")
        .replace(/^[\s\-–—:•*#]+/, "")
        .trim();

      profiles.push({
        handle: match[1],
        name,
        bio: bioText.slice(0, 300),
      });
    }
  }

  return profiles;
}

// ── Main search function ─────────────────────────────────────────────────────

/**
 * Search for X/Twitter user profiles matching a niche query using Grok's
 * x_search tool via the /v1/responses API.
 * Returns lightweight XProfile objects with handle, name, bio.
 * Follower counts are 0 (will be hydrated later by the profile_hydrator).
 */
export async function searchGrokXUsers(
  query: string,
  options?: { roleTerms?: string[]; limit?: number },
): Promise<XProfile[]> {
  const apiKey = getGrokApiKey();
  if (!apiKey) {
    throw new XProviderRuntimeError({
      provider: "multiagent",
      code: "NOT_CONFIGURED",
      message: "XAI_API_KEY is not set.",
      missingEnv: ["XAI_API_KEY"],
    });
  }

  const limit = options?.limit ?? 30;
  const roleContext = options?.roleTerms?.length
    ? `The specific roles/titles to look for: ${options.roleTerms.slice(0, 8).join(", ")}.`
    : "";

  const systemPrompt = [
    "You are a lead research assistant. Use the x_search tool to find real X/Twitter accounts matching the user's query.",
    "Return ONLY a list of accounts you found. For each account include:",
    "- Their @handle",
    "- Their display name",
    "- A brief description from their bio or what they do",
    "",
    "Return INDIVIDUALS, not companies or organizations.",
    `Find up to ${limit} accounts.`,
    "Format each result on its own line as: **Display Name** (@handle) - brief bio description",
    "Do not add commentary, just the list.",
  ].join("\n");

  const userPrompt = [
    `Find X/Twitter accounts of people who are: ${query}`,
    roleContext,
    "Focus on individuals with bios that clearly indicate they hold this role.",
  ].filter(Boolean).join("\n");

  const body: GrokResponsesRequest = {
    model: GROK_MODEL,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    tools: [{ type: "x_search" }],
    temperature: 0,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GROK_SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${GROK_API_BASE}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = (await response.text().catch(() => "")).trim();
      throw new XProviderRuntimeError({
        provider: "multiagent",
        capability: "discovery",
        code: response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_REQUEST_FAILED",
        message: `Grok API request failed with status ${response.status}.${details ? ` ${details}` : ""}`,
      });
    }

    const data = (await response.json()) as GrokResponsesOutput;

    // Extract text from the responses API output format
    let content = "";
    for (const output of data.output ?? []) {
      if (output.type === "message" && output.role === "assistant") {
        for (const block of output.content ?? []) {
          if (block.type === "text" && block.text) {
            content += block.text;
          }
        }
      }
    }

    if (!content) {
      console.warn("[grok][x-search] Empty response content");
      return [];
    }

    const extracted = extractProfilesFromGrokResponse(content);

    console.log("[grok][x-search]", JSON.stringify({
      query,
      responseLength: content.length,
      extractedProfiles: extracted.length,
    }));

    return extracted.slice(0, limit).map((profile) => ({
      xUserId: profile.handle.toLowerCase(),
      username: profile.handle,
      displayName: profile.name || profile.handle,
      bio: profile.bio,
      followersCount: 0,
      followingCount: 0,
      verified: false,
    }));
  } catch (error) {
    if (error instanceof XProviderRuntimeError) throw error;

    const isAbort = error instanceof Error && error.name === "AbortError";
    throw new XProviderRuntimeError({
      provider: "multiagent",
      capability: "discovery",
      code: "UPSTREAM_REQUEST_FAILED",
      message: isAbort
        ? `Grok API request timed out after ${GROK_SEARCH_TIMEOUT_MS}ms.`
        : `Grok API request failed. ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}
