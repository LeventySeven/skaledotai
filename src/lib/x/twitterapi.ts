import "@/lib/server-runtime";
import { z } from "zod";
import type { XProfile } from "@/lib/validations/search";
import { ensureStrictXProfile } from "./contracts";
import { parseJsonResponse, tryParseJsonText } from "./json";
import type { XDataClient, XProfilesPage, XPostSearchResult, XResolvedTweet } from "./types";
import { XProviderRuntimeError } from "./types";

const TWITTERAPI_BASE = "https://api.twitterapi.io";

const TwitterApiUrlEntitySchema = z.object({
  expanded_url: z.string().optional(),
}).passthrough();

const TwitterApiProfileBioSchema = z.object({
  description: z.string().optional(),
  entities: z.object({
    url: z.object({
      urls: z.array(TwitterApiUrlEntitySchema).default([]),
    }).optional(),
  }).optional(),
}).passthrough();

const TwitterApiUserSchema = z.object({
  id: z.string(),
  userName: z.string().optional(),
  username: z.string().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
  isBlueVerified: z.boolean().optional(),
  verifiedType: z.string().optional(),
  profilePicture: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  followers: z.number().optional(),
  following: z.number().optional(),
  statusesCount: z.number().optional(),
  favouritesCount: z.number().optional(),
  canDm: z.boolean().optional(),
  createdAt: z.string().optional(),
  profile_bio: TwitterApiProfileBioSchema.optional(),
}).passthrough();

const TwitterApiBatchUsersResponseSchema = z.object({
  users: z.array(TwitterApiUserSchema).default([]),
  status: z.enum(["success", "error"]).optional(),
  msg: z.string().optional(),
}).strict();

type TwitterApiUser = z.infer<typeof TwitterApiUserSchema>;

class TwitterApiIoError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TwitterApiIoError";
    this.status = status;
  }
}

function requireApiKey(): string {
  const apiKey = process.env.TWITTERAPI_IO_KEY?.trim();
  if (!apiKey) {
    throw new XProviderRuntimeError({
      provider: "twitterapi",
      capability: "lookup",
      code: "NOT_CONFIGURED",
      message: "TwitterAPI.io is not configured.",
      missingEnv: ["TWITTERAPI_IO_KEY"],
    });
  }

  return apiKey;
}

function unsupported(capability: "discovery" | "network" | "tweets"): never {
  throw new XProviderRuntimeError({
    provider: "twitterapi",
    capability,
    code: "CAPABILITY_UNSUPPORTED",
    message: `TwitterAPI.io does not support ${capability} operations directly.`,
  });
}

function readProfileBioUrl(user: TwitterApiUser): string | undefined {
  const urls = user.profile_bio?.entities?.url?.urls ?? [];
  return urls.find((item) => typeof item.expanded_url === "string" && item.expanded_url.trim().length > 0)?.expanded_url;
}

function mapTwitterApiUserToProfile(user: TwitterApiUser): XProfile {
  const username = (user.userName ?? user.username ?? "").replace(/^@/, "").trim();
  const bio = user.description?.trim() || user.profile_bio?.description?.trim() || "";

  return ensureStrictXProfile({
    xUserId: user.id,
    username: username || user.id,
    displayName: user.name?.trim() || username || user.id,
    bio,
    avatarUrl: user.profilePicture?.trim() || undefined,
    profileUrl: user.url?.trim() || (username ? `https://x.com/${username}` : undefined),
    followersCount: user.followers ?? 0,
    followingCount: user.following ?? 0,
    tweetCount: user.statusesCount,
    listedCount: undefined,
    verified: user.isBlueVerified ?? false,
    verifiedType: user.verifiedType?.trim() || undefined,
    location: user.location?.trim() || undefined,
    url: readProfileBioUrl(user),
  });
}

async function twitterApiRequest<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`${TWITTERAPI_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      "X-API-Key": requireApiKey(),
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    const parsed = tryParseJsonText<{ msg?: string }>(body);
    throw new TwitterApiIoError(
      response.status,
      parsed.success ? (parsed.data.msg ?? `TwitterAPI.io request failed (${response.status})`) : `TwitterAPI.io request failed (${response.status})`,
    );
  }

  return parseJsonResponse<T>(
    response,
    (details) => new TwitterApiIoError(response.status, `TwitterAPI.io returned invalid JSON. ${details}`),
  );
}

export async function lookupTwitterApiUsersByIds(userIds: string[]): Promise<XProfile[]> {
  const unique = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const response = await twitterApiRequest<z.infer<typeof TwitterApiBatchUsersResponseSchema>>(
    "/twitter/user/batch_info_by_ids",
    { userIds: unique.join(",") },
  );
  const parsed = TwitterApiBatchUsersResponseSchema.parse(response);
  return parsed.users.map(mapTwitterApiUserToProfile);
}

export const twitterApiClient: XDataClient = {
  provider: "twitterapi",
  searchUsers() {
    unsupported("discovery");
  },
  lookupUsersByUsernames() {
    throw new XProviderRuntimeError({
      provider: "twitterapi",
      capability: "lookup",
      code: "CAPABILITY_UNSUPPORTED",
      message: "TwitterAPI.io username lookup is not implemented; use user ID hydration.",
    });
  },
  lookupUsersByIds(userIds) {
    return lookupTwitterApiUsersByIds(userIds);
  },
  getFollowersPage(): Promise<XProfilesPage> {
    unsupported("network");
  },
  getFollowingPage(): Promise<XProfilesPage> {
    unsupported("network");
  },
  searchRecentPosts(): Promise<XPostSearchResult> {
    unsupported("tweets");
  },
  searchAllPosts(): Promise<XPostSearchResult> {
    unsupported("tweets");
  },
  getUserTweets(): Promise<XResolvedTweet[]> {
    unsupported("tweets");
  },
};
