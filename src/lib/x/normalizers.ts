import type { XProfile } from "@/lib/validations/search";
import type { XResolvedTweet } from "./types";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) return undefined;
    const numeric = Number(cleaned);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function readFromRecords<T>(
  records: JsonRecord[],
  keys: string[],
  reader: (value: unknown) => T | undefined,
): T | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = reader(record[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function readPublicMetric(records: JsonRecord[], keys: string[]): number | undefined {
  for (const record of records) {
    const publicMetrics = asRecord(record.public_metrics) ?? asRecord(record.publicMetrics);
    if (!publicMetrics) continue;

    for (const key of keys) {
      const value = readNumber(publicMetrics[key]);
      if (value !== undefined) return value;
    }
  }

  return undefined;
}

function buildProfileRecords(value: unknown): JsonRecord[] {
  const record = asRecord(value);
  if (!record) return [];

  return [
    record,
    asRecord(record.author),
    asRecord(record.user),
    asRecord(record.userInfo),
    asRecord(record.profile),
    asRecord(record.account),
    asRecord(record.fullProfile),
    asRecord(record.user_data),
  ].filter((candidate): candidate is JsonRecord => Boolean(candidate));
}

function buildTweetRecords(value: unknown): JsonRecord[] {
  const record = asRecord(value);
  if (!record) return [];

  return [
    record,
    asRecord(record.tweet),
    asRecord(record.status),
    asRecord(record.post),
  ].filter((candidate): candidate is JsonRecord => Boolean(candidate));
}

export function normalizeHandle(value: string | undefined): string | undefined {
  return value?.replace(/^@/, "").trim() || undefined;
}

export function normalizeScrapedProfile(
  value: unknown,
  fallbackUsername?: string,
): XProfile | null {
  const records = buildProfileRecords(value);
  if (records.length === 0) return null;

  const username = normalizeHandle(
    readFromRecords(records, [
      "username",
      "userName",
      "screenName",
      "screen_name",
      "handle",
      "twitterHandle",
      "authorUserName",
    ], readString) ?? fallbackUsername,
  );
  const xUserId = readFromRecords(records, [
    "id",
    "userId",
    "user_id",
    "rest_id",
    "twitterId",
    "authorId",
    "author_id",
  ], readString) ?? username;

  if (!username && !xUserId) return null;

  const followersCount =
    readFromRecords(records, [
      "followersCount",
      "followers",
      "followers_count",
      "subscriberCount",
    ], readNumber)
    ?? readPublicMetric(records, ["followers_count", "followersCount"])
    ?? asArray(records[0]?.followers).length
    ?? 0;
  const followingCount =
    readFromRecords(records, [
      "followingCount",
      "following",
      "following_count",
      "friendsCount",
    ], readNumber)
    ?? readPublicMetric(records, ["following_count", "followingCount", "friends_count"])
    ?? asArray(records[0]?.following).length
    ?? 0;

  const profileUrl = readFromRecords(records, [
    "profileUrl",
    "twitterUrl",
  ], readString) ?? (username ? `https://x.com/${username}` : undefined);

  return {
    xUserId: xUserId ?? username ?? "",
    username: username ?? xUserId ?? "",
    displayName: readFromRecords(records, [
      "name",
      "displayName",
      "fullName",
      "authorName",
    ], readString) ?? username ?? xUserId ?? "",
    bio: readFromRecords(records, [
      "description",
      "bio",
      "profileDescription",
      "about",
    ], readString) ?? "",
    avatarUrl: readFromRecords(records, [
      "profilePicture",
      "avatar",
      "avatarUrl",
      "profileImageUrl",
      "profile_image_url",
      "imgUrl",
      "picture",
    ], readString),
    profileUrl,
    followersCount,
    followingCount,
    tweetCount:
      readFromRecords(records, [
        "tweetCount",
        "tweetsCount",
        "statusesCount",
        "statuses_count",
      ], readNumber)
      ?? readPublicMetric(records, ["tweet_count", "tweets_count"]),
    listedCount:
      readFromRecords(records, [
        "listedCount",
        "listed_count",
      ], readNumber)
      ?? readPublicMetric(records, ["listed_count", "listedCount"]),
    verified:
      readFromRecords(records, ["verified", "isVerified"], readBoolean)
      ?? false,
    verifiedType: readFromRecords(records, [
      "verifiedType",
      "verified_type",
    ], readString),
    location: readFromRecords(records, ["location"], readString),
    url: readFromRecords(records, ["website", "expandedUrl", "externalUrl"], readString),
  };
}

function isReplyOrRetweet(
  records: JsonRecord[],
  text: string,
  id: string | undefined,
  conversationId: string | undefined,
): boolean {
  const retweetFlag = readFromRecords(records, [
    "isRetweet",
    "retweeted",
  ], readBoolean);
  if (retweetFlag === true) return true;

  if (records.some((record) => Boolean(record.retweetedStatus) || Boolean(record.retweetedTweet))) {
    return true;
  }

  if (text.startsWith("RT @")) return true;

  const replyFlag = readFromRecords(records, ["isReply"], readBoolean);
  if (replyFlag === true) return true;

  const replyTo = readFromRecords(records, [
    "inReplyToStatusId",
    "inReplyToId",
    "inReplyToTweetId",
    "inReplyTo",
  ], readString);
  if (replyTo) return true;

  return Boolean(conversationId && id && conversationId !== id);
}

export function normalizeScrapedTweet(
  value: unknown,
  options?: { excludeRepliesAndRetweets?: boolean },
): XResolvedTweet | null {
  const records = buildTweetRecords(value);
  if (records.length === 0) return null;

  const id = readFromRecords(records, [
    "id",
    "tweetId",
    "statusId",
    "rest_id",
  ], readString);
  const text = readFromRecords(records, [
    "text",
    "fullText",
    "tweetText",
    "content",
    "body",
  ], readString) ?? "";
  const authorProfile = normalizeScrapedProfile(value);
  const conversationId = readFromRecords(records, [
    "conversationId",
    "conversation_id",
    "threadId",
  ], readString);
  const createdAt = readFromRecords(records, [
    "createdAt",
    "created_at",
    "timestamp",
    "time",
    "date",
  ], readString);

  if (options?.excludeRepliesAndRetweets && isReplyOrRetweet(records, text, id, conversationId)) {
    return null;
  }

  if (!id && !text) return null;

  const authorId =
    readFromRecords(records, [
      "authorId",
      "author_id",
      "userId",
      "user_id",
      "ownerId",
    ], readString)
    ?? authorProfile?.xUserId;

  return {
    id: id ?? [authorId ?? "tweet", createdAt, text].filter(Boolean).join(":"),
    authorId,
    conversationId,
    createdAt,
    text,
    viewCount:
      readFromRecords(records, [
        "viewCount",
        "views",
        "impressionCount",
        "impressions",
      ], readNumber)
      ?? readPublicMetric(records, ["impression_count", "view_count", "viewCount"])
      ?? 0,
    likeCount:
      readFromRecords(records, [
        "likeCount",
        "likes",
        "favoriteCount",
      ], readNumber)
      ?? readPublicMetric(records, ["like_count", "favorite_count", "likes"])
      ?? 0,
    replyCount:
      readFromRecords(records, [
        "replyCount",
        "replies",
        "commentCount",
      ], readNumber)
      ?? readPublicMetric(records, ["reply_count", "replyCount"])
      ?? 0,
    repostCount:
      readFromRecords(records, [
        "retweetCount",
        "reposts",
        "repostCount",
      ], readNumber)
      ?? readPublicMetric(records, ["retweet_count", "repost_count", "retweetCount"])
      ?? 0,
  };
}

export function extractNestedItems(value: unknown, key: string): unknown[] {
  const record = asRecord(value);
  if (!record) return [];
  return asArray(record[key]);
}

export function dedupeProfiles(profiles: XProfile[]): XProfile[] {
  const byId = new Map<string, XProfile>();

  for (const profile of profiles) {
    const key = profile.xUserId || profile.username;
    const existing = byId.get(key);
    if (!existing || profile.followersCount > existing.followersCount) {
      byId.set(key, profile);
    }
  }

  return [...byId.values()];
}
