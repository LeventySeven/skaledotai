import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Priority, XProfile } from "@/lib/types";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const DEFAULT_REASONING_EFFORT =
  process.env.OPENAI_REASONING_EFFORT ?? "low";

type StructuredResponse<T> = {
  schemaName: string;
  schema: z.ZodType<T>;
  instructions: string;
  input: string;
  fallback: T;
  maxOutputTokens?: number;
};

let client: OpenAI | null | undefined;

function getClient(): OpenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  client = apiKey ? new OpenAI({ apiKey }) : null;
  return client;
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
      model: DEFAULT_MODEL,
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
        effort: DEFAULT_REASONING_EFFORT as
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
