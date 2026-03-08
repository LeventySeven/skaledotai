import OpenAI from "openai";
import type { Priority, XProfile } from "@/lib/types";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

type StructuredResponse<T> = {
  schemaName: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
  fallback: T;
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
}: StructuredResponse<T>): Promise<T> {
  const openai = getClient();
  if (!openai) return fallback;

  try {
    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          strict: true,
          schema,
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return fallback;
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

export async function rankProfilesForQuery(
  query: string,
  candidates: Array<XProfile & { samplePosts?: string[] }>,
): Promise<string[]> {
  const fallback = candidates.slice(0, 30).map((c) => c.xUserId);

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
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        profileIds: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["profileIds"],
    },
    instructions:
      "Return only X profiles that are relevant to the search query. Be inclusive but remove clearly unrelated accounts. Keep the array ordered from most relevant to least relevant.",
    input,
    fallback: { profileIds: fallback },
  });

  return result.profileIds;
}

export async function extractTopicsAndPriority(
  niche: string | undefined,
  bio: string,
  posts: string[],
): Promise<{ topics: string[]; priority: Priority }> {
  const result = await structuredResponse<{ topics: string[]; priority: Priority }>({
    schemaName: "profile_topics_priority",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        topics: {
          type: "array",
          items: { type: "string" },
        },
        priority: {
          type: "string",
          enum: ["P0", "P1"],
        },
      },
      required: ["topics", "priority"],
    },
    instructions: niche
      ? `Analyze the X profile and recent posts for creator outreach. The niche we care about is "${niche}". Return up to 5 short topics and a priority of P0 or P1.`
      : "Analyze the X profile and recent posts. Return up to 5 short topics and a conservative outreach priority of P0 or P1.",
    input: JSON.stringify({
      bio,
      posts: posts.slice(0, 20),
    }),
    fallback: { topics: [], priority: "P1" },
  });

  return result;
}
