import { z } from "zod";
import type { XProfile } from "@/lib/validations/search";
import { DiscoverySourceSchema } from "@/lib/validations/shared";
import { XDataProviderSchema } from "@/lib/validations/x-provider";
import type { XLeadCandidate, XLeadCandidatePost, XResolvedTweet } from "./types";

const NonEmptyStringSchema = z.string().min(1);
const OptionalTrimmedStringSchema = z.string().min(1).optional();
const CountSchema = z.number().int().nonnegative();

export const StrictXProfileSchema = z.object({
  xUserId: NonEmptyStringSchema,
  username: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema,
  bio: z.string(),
  avatarUrl: OptionalTrimmedStringSchema,
  profileUrl: OptionalTrimmedStringSchema,
  followersCount: CountSchema,
  followingCount: CountSchema,
  tweetCount: CountSchema.optional(),
  listedCount: CountSchema.optional(),
  verified: z.boolean().optional(),
  verifiedType: OptionalTrimmedStringSchema,
  location: OptionalTrimmedStringSchema,
  url: OptionalTrimmedStringSchema,
}).strict();

export const StrictLeadImportProfileSchema = StrictXProfileSchema.extend({
  source: DiscoverySourceSchema.optional(),
}).strict();

export const StrictXResolvedTweetSchema = z.object({
  id: NonEmptyStringSchema,
  authorId: OptionalTrimmedStringSchema,
  conversationId: OptionalTrimmedStringSchema,
  createdAt: OptionalTrimmedStringSchema,
  text: z.string(),
  viewCount: CountSchema,
  likeCount: CountSchema,
  replyCount: CountSchema,
  repostCount: CountSchema,
}).strict();

export const StrictXLeadCandidatePostSchema = z.object({
  id: OptionalTrimmedStringSchema,
  text: z.string(),
  createdAt: NonEmptyStringSchema,
  likes: CountSchema,
  replies: CountSchema,
  reposts: CountSchema,
  views: CountSchema.optional(),
}).strict();

export const StrictXLeadCandidateSchema = z.object({
  source: XDataProviderSchema,
  niche: z.string().min(1),
  discoverySource: DiscoverySourceSchema,
  account: z.object({
    handle: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    bio: z.string(),
    location: OptionalTrimmedStringSchema,
    followers: CountSchema,
    following: CountSchema,
    isVerified: z.boolean().optional(),
    createdAt: OptionalTrimmedStringSchema,
    avatarUrl: OptionalTrimmedStringSchema,
    profileUrl: OptionalTrimmedStringSchema,
    xUserId: OptionalTrimmedStringSchema,
  }).strict(),
  metrics: z.object({
    avgLikes: CountSchema,
    avgReplies: CountSchema,
    avgReposts: CountSchema,
    avgViews: CountSchema.optional(),
    postsSampleSize: CountSchema,
  }).strict(),
  posts: z.array(StrictXLeadCandidatePostSchema),
}).strict();

function normalizeRequiredString(value: string | undefined, fallback = ""): string {
  const trimmed = value?.trim() ?? "";
  const resolved = trimmed || fallback.trim();
  if (!resolved) throw new Error("Missing required string value.");
  return resolved;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHandle(value: string | undefined, fallback?: string): string {
  const normalized = (value ?? fallback ?? "").replace(/^@/, "").trim();
  if (!normalized) throw new Error("Missing required X handle.");
  return normalized;
}

function normalizeCount(value: number | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.round(value);
}

function logStrictJsonDrop(scope: string, index: number, error: unknown): void {
  console.warn("[x-provider][structured-json]", JSON.stringify({
    scope,
    index,
    message: error instanceof Error ? error.message : String(error),
  }));
}

export function ensureStrictXProfile(profile: XProfile): XProfile {
  const username = normalizeHandle(profile.username, profile.xUserId);
  const xUserId = normalizeRequiredString(profile.xUserId, username);

  return StrictXProfileSchema.parse({
    xUserId,
    username,
    displayName: normalizeRequiredString(profile.displayName, username),
    bio: normalizeOptionalString(profile.bio) ?? "",
    avatarUrl: normalizeOptionalString(profile.avatarUrl),
    profileUrl: normalizeOptionalString(profile.profileUrl),
    followersCount: normalizeCount(profile.followersCount),
    followingCount: normalizeCount(profile.followingCount),
    tweetCount: profile.tweetCount !== undefined ? normalizeCount(profile.tweetCount) : undefined,
    listedCount: profile.listedCount !== undefined ? normalizeCount(profile.listedCount) : undefined,
    verified: profile.verified,
    verifiedType: normalizeOptionalString(profile.verifiedType),
    location: normalizeOptionalString(profile.location),
    url: normalizeOptionalString(profile.url),
  });
}

export function ensureStrictLeadImportProfile(
  profile: XProfile & { source?: string },
): XProfile & { source?: z.infer<typeof DiscoverySourceSchema> } {
  const strictProfile = ensureStrictXProfile(profile);

  return StrictLeadImportProfileSchema.parse({
    ...strictProfile,
    source: typeof profile.source === "string" ? profile.source.trim() || undefined : undefined,
  });
}

export function ensureStrictXResolvedTweet(tweet: XResolvedTweet): XResolvedTweet {
  const id = normalizeRequiredString(tweet.id, [
    tweet.authorId?.trim(),
    tweet.createdAt?.trim(),
    tweet.text?.trim(),
  ].filter(Boolean).join(":"));

  return StrictXResolvedTweetSchema.parse({
    id,
    authorId: normalizeOptionalString(tweet.authorId),
    conversationId: normalizeOptionalString(tweet.conversationId),
    createdAt: normalizeOptionalString(tweet.createdAt),
    text: typeof tweet.text === "string" ? tweet.text : "",
    viewCount: normalizeCount(tweet.viewCount),
    likeCount: normalizeCount(tweet.likeCount),
    replyCount: normalizeCount(tweet.replyCount),
    repostCount: normalizeCount(tweet.repostCount),
  });
}

export function ensureStrictXLeadCandidatePost(post: XLeadCandidatePost): XLeadCandidatePost {
  return StrictXLeadCandidatePostSchema.parse({
    id: normalizeOptionalString(post.id),
    text: typeof post.text === "string" ? post.text : "",
    createdAt: normalizeRequiredString(post.createdAt, new Date(0).toISOString()),
    likes: normalizeCount(post.likes),
    replies: normalizeCount(post.replies),
    reposts: normalizeCount(post.reposts),
    views: post.views !== undefined ? normalizeCount(post.views) : undefined,
  });
}

export function ensureStrictXLeadCandidate(candidate: XLeadCandidate): XLeadCandidate {
  const handle = normalizeHandle(candidate.account.handle, candidate.account.xUserId);
  const xUserId = normalizeOptionalString(candidate.account.xUserId);
  const posts = candidate.posts.map(ensureStrictXLeadCandidatePost);

  return StrictXLeadCandidateSchema.parse({
    source: candidate.source,
    niche: normalizeRequiredString(candidate.niche),
    discoverySource: candidate.discoverySource,
    account: {
      handle,
      name: normalizeRequiredString(candidate.account.name, handle),
      bio: normalizeOptionalString(candidate.account.bio) ?? "",
      location: normalizeOptionalString(candidate.account.location),
      followers: normalizeCount(candidate.account.followers),
      following: normalizeCount(candidate.account.following),
      isVerified: candidate.account.isVerified,
      createdAt: normalizeOptionalString(candidate.account.createdAt),
      avatarUrl: normalizeOptionalString(candidate.account.avatarUrl),
      profileUrl: normalizeOptionalString(candidate.account.profileUrl),
      xUserId,
    },
    metrics: {
      avgLikes: normalizeCount(candidate.metrics.avgLikes),
      avgReplies: normalizeCount(candidate.metrics.avgReplies),
      avgReposts: normalizeCount(candidate.metrics.avgReposts),
      avgViews: candidate.metrics.avgViews !== undefined ? normalizeCount(candidate.metrics.avgViews) : undefined,
      postsSampleSize: Math.max(normalizeCount(candidate.metrics.postsSampleSize, posts.length), posts.length),
    },
    posts,
  });
}

function ensureStrictBatch<TIn, TOut = TIn>(items: TIn[], scope: string, ensure: (item: TIn) => TOut): TOut[] {
  return items.flatMap((item, index) => {
    try {
      return [ensure(item)];
    } catch (error) {
      logStrictJsonDrop(scope, index, error);
      return [];
    }
  });
}

export function ensureStrictXProfiles(profiles: XProfile[], scope: string): XProfile[] {
  return ensureStrictBatch(profiles, scope, ensureStrictXProfile);
}

export function ensureStrictLeadImportProfiles(
  profiles: Array<XProfile & { source?: string }>,
  scope: string,
): Array<XProfile & { source?: z.infer<typeof DiscoverySourceSchema> }> {
  return ensureStrictBatch(profiles, scope, ensureStrictLeadImportProfile);
}

export function ensureStrictXResolvedTweets(tweets: XResolvedTweet[], scope: string): XResolvedTweet[] {
  return ensureStrictBatch(tweets, scope, ensureStrictXResolvedTweet);
}

export function ensureStrictXLeadCandidates(candidates: XLeadCandidate[], scope: string): XLeadCandidate[] {
  return ensureStrictBatch(candidates, scope, ensureStrictXLeadCandidate);
}
