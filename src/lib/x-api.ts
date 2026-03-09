import type { XProfile } from "@/lib/validations/search";

const X_API_BASE = "https://api.x.com/2";
const USER_FIELDS = [
  "description",
  "location",
  "name",
  "profile_image_url",
  "public_metrics",
  "url",
  "username",
  "verified",
  "verified_type",
].join(",");
const TWEET_FIELDS = [
  "author_id",
  "conversation_id",
  "created_at",
  "lang",
  "public_metrics",
  "text",
].join(",");

type XUser = {
  id: string;
  name: string;
  username: string;
  description?: string;
  profile_image_url?: string;
  location?: string;
  url?: string;
  verified?: boolean;
  verified_type?: string;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
  };
};

type XTweet = {
  id: string;
  author_id?: string;
  conversation_id?: string;
  created_at?: string;
  lang?: string;
  text?: string;
  public_metrics?: {
    impression_count?: number;
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
  };
};

type XResponse<T> = {
  data?: T;
  includes?: {
    users?: XUser[];
  };
  meta?: {
    next_token?: string;
    result_count?: number;
  };
  errors?: Array<{ detail?: string; message?: string }>;
};

type UserListResponse = XResponse<XUser[]>;
type TweetListResponse = XResponse<XTweet[]>;
type XProblemResponse = {
  title?: string;
  detail?: string;
  type?: string;
  status?: number;
};

export class XApiError extends Error {
  status: number;
  title?: string;
  detail?: string;
  type?: string;

  constructor(status: number, problem?: XProblemResponse, fallbackMessage?: string) {
    super(
      fallbackMessage
        ?? problem?.detail
        ?? problem?.title
        ?? `X API request failed (${status})`,
    );
    this.name = "XApiError";
    this.status = status;
    this.title = problem?.title;
    this.detail = problem?.detail;
    this.type = problem?.type;
  }
}

function requireToken(): string {
  const token = process.env.X_API_BEARER_TOKEN;
  if (!token) {
    throw new Error("X_API_BEARER_TOKEN is not set");
  }
  return token;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(headers: Headers): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  }

  const resetAt = headers.get("x-rate-limit-reset");
  if (resetAt) {
    const unix = Number(resetAt);
    if (!Number.isNaN(unix) && unix > 0) {
      return Math.max(0, unix * 1000 - Date.now());
    }
  }

  return 1000;
}

async function xRequest<T>(
  path: string,
  params: Record<string, string | undefined> = {},
  retries = 2,
): Promise<T> {
  const url = new URL(`${X_API_BASE}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${requireToken()}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if ((response.status === 429 || response.status >= 500) && retries > 0) {
    const delay = Math.min(getRetryDelay(response.headers), 5000);
    await sleep(delay);
    return xRequest<T>(path, params, retries - 1);
  }

  if (!response.ok) {
    const text = await response.text();
    let problem: XProblemResponse | undefined;

    try {
      problem = JSON.parse(text) as XProblemResponse;
    } catch {
      problem = undefined;
    }

    throw new XApiError(
      response.status,
      problem,
      `X API request failed (${response.status}): ${text}`,
    );
  }

  return response.json() as Promise<T>;
}

export function buildPostSearchQuery(query: string): string {
  return `(${query}) lang:en -is:retweet`;
}

export function buildReplySearchQuery(query: string, handle: string): string {
  const cleanHandle = handle.replace(/^@/, "");
  return `to:${cleanHandle} (${query}) lang:en -is:retweet`;
}

export function mapXUserToProfile(user: XUser): XProfile {
  return {
    xUserId: user.id,
    username: user.username,
    displayName: user.name,
    bio: user.description ?? "",
    avatarUrl: user.profile_image_url,
    profileUrl: `https://x.com/${user.username}`,
    followersCount: user.public_metrics?.followers_count ?? 0,
    followingCount: user.public_metrics?.following_count ?? 0,
    tweetCount: user.public_metrics?.tweet_count ?? 0,
    listedCount: user.public_metrics?.listed_count ?? 0,
    verified: user.verified ?? false,
    verifiedType: user.verified_type,
    location: user.location,
    url: user.url,
  };
}

export function isUnsupportedAuthenticationError(error: unknown): boolean {
  return (
    error instanceof XApiError
    && error.status === 403
    && error.type === "https://api.twitter.com/2/problems/unsupported-authentication"
  );
}

export async function searchUsers(query: string, maxResults = 25): Promise<XProfile[]> {
  const response = await xRequest<UserListResponse>("/users/search", {
    q: query,
    "user.fields": USER_FIELDS,
    max_results: String(Math.min(100, Math.max(10, maxResults))),
  });

  return (response.data ?? []).map(mapXUserToProfile);
}

export async function lookupUsersByUsernames(usernames: string[]): Promise<XProfile[]> {
  const unique = [...new Set(usernames.map((u) => u.replace(/^@/, "").trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const chunks: XProfile[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const slice = unique.slice(i, i + 100);
    const response = await xRequest<UserListResponse>("/users/by", {
      usernames: slice.join(","),
      "user.fields": USER_FIELDS,
    });
    chunks.push(...(response.data ?? []).map(mapXUserToProfile));
  }

  return chunks;
}

export async function lookupUsersByIds(userIds: string[]): Promise<XProfile[]> {
  const unique = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const chunks: XProfile[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const slice = unique.slice(i, i + 100);
    const response = await xRequest<UserListResponse>("/users", {
      ids: slice.join(","),
      "user.fields": USER_FIELDS,
    });
    chunks.push(...(response.data ?? []).map(mapXUserToProfile));
  }

  return chunks;
}

export async function getFollowersPage(
  userId: string,
  paginationToken?: string,
  maxResults = 1000,
): Promise<{ profiles: XProfile[]; nextToken?: string }> {
  const response = await xRequest<UserListResponse>(`/users/${userId}/followers`, {
    "user.fields": USER_FIELDS,
    max_results: String(Math.min(1000, Math.max(10, maxResults))),
    pagination_token: paginationToken,
  });

  return {
    profiles: (response.data ?? []).map(mapXUserToProfile),
    nextToken: response.meta?.next_token,
  };
}

export async function getFollowingPage(
  userId: string,
  paginationToken?: string,
  maxResults = 1000,
): Promise<{ profiles: XProfile[]; nextToken?: string }> {
  const response = await xRequest<UserListResponse>(`/users/${userId}/following`, {
    "user.fields": USER_FIELDS,
    max_results: String(Math.min(1000, Math.max(10, maxResults))),
    pagination_token: paginationToken,
  });

  return {
    profiles: (response.data ?? []).map(mapXUserToProfile),
    nextToken: response.meta?.next_token,
  };
}

export async function searchRecentPosts(
  query: string,
  maxResults = 50,
  nextToken?: string,
): Promise<{ tweets: XTweet[]; users: XProfile[]; nextToken?: string }> {
  const response = await xRequest<TweetListResponse>("/tweets/search/recent", {
    query,
    expansions: "author_id",
    "tweet.fields": TWEET_FIELDS,
    "user.fields": USER_FIELDS,
    max_results: String(Math.min(100, Math.max(10, maxResults))),
    next_token: nextToken,
  });

  return {
    tweets: response.data ?? [],
    users: (response.includes?.users ?? []).map(mapXUserToProfile),
    nextToken: response.meta?.next_token,
  };
}

export async function searchAllPosts(
  query: string,
  maxResults = 50,
  nextToken?: string,
): Promise<{ tweets: XTweet[]; users: XProfile[]; nextToken?: string }> {
  const response = await xRequest<TweetListResponse>("/tweets/search/all", {
    query,
    expansions: "author_id",
    "tweet.fields": TWEET_FIELDS,
    "user.fields": USER_FIELDS,
    max_results: String(Math.min(100, Math.max(10, maxResults))),
    next_token: nextToken,
  });

  return {
    tweets: response.data ?? [],
    users: (response.includes?.users ?? []).map(mapXUserToProfile),
    nextToken: response.meta?.next_token,
  };
}

export async function getUserTweets(userId: string, maxResults = 30): Promise<XTweet[]> {
  const response = await xRequest<TweetListResponse>(`/users/${userId}/tweets`, {
    exclude: "retweets,replies",
    "tweet.fields": TWEET_FIELDS,
    max_results: String(Math.min(100, Math.max(5, maxResults))),
  });

  return response.data ?? [];
}

export type XTweetMetrics = {
  id: string;
  text: string;
  viewCount: number;
  likeCount: number;
  replyCount: number;
  repostCount: number;
};

export function mapTweetsToMetrics(tweets: XTweet[]): XTweetMetrics[] {
  return tweets.map((tweet) => ({
    id: tweet.id,
    text: tweet.text ?? "",
    viewCount: tweet.public_metrics?.impression_count ?? 0,
    likeCount: tweet.public_metrics?.like_count ?? 0,
    replyCount: tweet.public_metrics?.reply_count ?? 0,
    repostCount: tweet.public_metrics?.retweet_count ?? 0,
  }));
}
