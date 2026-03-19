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

function unsupported(capability: "discovery" | "tweets"): never {
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

const TwitterApiFollowersResponseSchema = z.object({
  users: z.array(TwitterApiUserSchema).default([]),
  has_next_page: z.boolean().optional(),
  next_cursor: z.string().optional(),
  status: z.enum(["success", "error"]).optional(),
  msg: z.string().optional(),
}).passthrough();

export async function getTwitterApiFollowersPage(
  userName: string,
  cursor?: string,
): Promise<{ profiles: XProfile[]; nextToken?: string }> {
  const params: Record<string, string> = { userName };
  if (cursor) params.cursor = cursor;

  const response = await twitterApiRequest<z.infer<typeof TwitterApiFollowersResponseSchema>>(
    "/twitter/user/followers",
    params,
  );
  const parsed = TwitterApiFollowersResponseSchema.parse(response);
  return {
    profiles: parsed.users.map(mapTwitterApiUserToProfile),
    nextToken: parsed.has_next_page ? parsed.next_cursor : undefined,
  };
}

export async function getTwitterApiFollowingPage(
  userName: string,
  cursor?: string,
): Promise<{ profiles: XProfile[]; nextToken?: string }> {
  const params: Record<string, string> = { userName };
  if (cursor) params.cursor = cursor;

  const response = await twitterApiRequest<z.infer<typeof TwitterApiFollowersResponseSchema>>(
    "/twitter/user/following",
    params,
  );
  const parsed = TwitterApiFollowersResponseSchema.parse(response);
  return {
    profiles: parsed.users.map(mapTwitterApiUserToProfile),
    nextToken: parsed.has_next_page ? parsed.next_cursor : undefined,
  };
}

// ── User Search ───────────────────────────────────────────────────────────────
// GET /twitter/user/search — search users by keyword, returns ~20 per page.

const TwitterApiSearchUsersResponseSchema = z.object({
  users: z.array(TwitterApiUserSchema).default([]),
  has_next_page: z.boolean().optional(),
  next_cursor: z.string().optional(),
  status: z.enum(["success", "error"]).optional(),
  msg: z.string().optional(),
}).passthrough();

export async function searchTwitterApiUsers(
  query: string,
  options?: { cursor?: string; maxPages?: number },
): Promise<XProfile[]> {
  requireApiKey();
  const maxPages = options?.maxPages ?? 3;
  const allProfiles: XProfile[] = [];
  let cursor = options?.cursor;

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { query };
    if (cursor) params.cursor = cursor;

    const response = await twitterApiRequest<z.infer<typeof TwitterApiSearchUsersResponseSchema>>(
      "/twitter/user/search",
      params,
    );
    const parsed = TwitterApiSearchUsersResponseSchema.parse(response);
    allProfiles.push(...parsed.users.map(mapTwitterApiUserToProfile));

    if (!parsed.has_next_page || !parsed.next_cursor) break;
    cursor = parsed.next_cursor;
  }

  return allProfiles;
}

// ── Verified Followers ────────────────────────────────────────────────────────
// GET /twitter/user/verifiedFollowers — returns ~20 verified followers per page.

const TwitterApiVerifiedFollowersResponseSchema = z.object({
  followers: z.array(TwitterApiUserSchema).default([]),
  has_next_page: z.boolean().optional(),
  next_cursor: z.string().optional(),
  status: z.enum(["success", "error"]).optional(),
  msg: z.string().optional(),
  message: z.string().optional(),
}).passthrough();

export async function getTwitterApiVerifiedFollowersPage(
  userId: string,
  cursor?: string,
): Promise<{ profiles: XProfile[]; nextToken?: string }> {
  const params: Record<string, string> = { user_id: userId };
  if (cursor) params.cursor = cursor;

  const response = await twitterApiRequest<z.infer<typeof TwitterApiVerifiedFollowersResponseSchema>>(
    "/twitter/user/verifiedFollowers",
    params,
  );
  const parsed = TwitterApiVerifiedFollowersResponseSchema.parse(response);
  return {
    profiles: parsed.followers.map(mapTwitterApiUserToProfile),
    nextToken: parsed.has_next_page ? parsed.next_cursor : undefined,
  };
}

export async function getTwitterApiVerifiedFollowers(
  userId: string,
  maxPages = 5,
): Promise<XProfile[]> {
  const allProfiles: XProfile[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await getTwitterApiVerifiedFollowersPage(userId, cursor);
    allProfiles.push(...result.profiles);
    if (!result.nextToken) break;
    cursor = result.nextToken;
  }

  return allProfiles;
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
  async getFollowersPage(input) {
    const username = (input.username ?? "").replace(/^@/, "").trim();
    if (!username) {
      throw new XProviderRuntimeError({
        provider: "twitterapi",
        capability: "network",
        code: "CAPABILITY_UNSUPPORTED",
        message: "TwitterAPI.io followers lookup requires a username.",
      });
    }
    return getTwitterApiFollowersPage(username, input.paginationToken);
  },
  async getFollowingPage(input) {
    const username = (input.username ?? "").replace(/^@/, "").trim();
    if (!username) {
      throw new XProviderRuntimeError({
        provider: "twitterapi",
        capability: "network",
        code: "CAPABILITY_UNSUPPORTED",
        message: "TwitterAPI.io following lookup requires a username.",
      });
    }
    return getTwitterApiFollowingPage(username, input.paginationToken);
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
