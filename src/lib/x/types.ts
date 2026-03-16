import type { SearchRunStreamSnapshot, XProfile } from "@/lib/validations/search";
import type { XDataProvider } from "./provider";
import type { ProjectRunTraceStep } from "@/lib/validations/project-runs";

export type XUserReference = {
  userId?: string;
  username?: string;
};

export type XResolvedTweet = {
  id: string;
  authorId?: string;
  conversationId?: string;
  createdAt?: string;
  text: string;
  viewCount: number;
  likeCount: number;
  replyCount: number;
  repostCount: number;
};

export type XProfilesPage = {
  profiles: XProfile[];
  nextToken?: string;
};

export type XPostSearchResult = {
  tweets: XResolvedTweet[];
  users: XProfile[];
  nextToken?: string;
};

export type XTweetMetrics = {
  id: string;
  text: string;
  viewCount: number;
  likeCount: number;
  replyCount: number;
  repostCount: number;
};

export type XLeadCandidatePost = {
  id?: string;
  text: string;
  createdAt: string;
  likes: number;
  replies: number;
  reposts: number;
  views?: number;
};

export type XLeadCandidate = {
  source: XDataProvider;
  niche: string;
  discoverySource: "profile_search" | "post_search" | "reply_search" | "followers" | "following";
  account: {
    handle: string;
    name: string;
    bio: string;
    location?: string;
    followers: number;
    following: number;
    isVerified?: boolean;
    createdAt?: string;
    avatarUrl?: string;
    profileUrl?: string;
    xUserId?: string;
  };
  metrics: {
    avgLikes: number;
    avgReplies: number;
    avgReposts: number;
    avgViews?: number;
    postsSampleSize: number;
  };
  posts: XLeadCandidatePost[];
};

export type InfluencerScore = {
  is_influencer: boolean;
  fit_for_niche: boolean;
  overall_score: number;
  stage: "nano" | "micro" | "mid" | "macro";
  niche_match_score: number;
  engagement_score: number;
  authenticity_score: number;
  topics: string[];
  notes: string[];
  red_flags: string[];
};

export type XDiscoveryInput = {
  niche: string;
  seedHandle?: string;
  limit: number;
  minFollowers?: number;
  targetLeadCount?: number;
  goalCount?: number;
  attempt?: number;
  maxAttempts?: number;
  traceRecorder?: (step: ProjectRunTraceStep) => void | Promise<void>;
  snapshotRecorder?: (snapshot: SearchRunStreamSnapshot) => void | Promise<void>;
  /** Callback to capture the planner's interpreted search context (roleTerms, bioTerms, antiGoals) */
  interpretationRecorder?: (interpretation: { roleTerms: string[]; bioTerms: string[]; antiGoals: string[] }) => void;
};

export interface XDiscoveryProvider {
  provider: XDataProvider;
  discoverCandidates(input: XDiscoveryInput): Promise<XLeadCandidate[]>;
}

export class XProviderRuntimeError extends Error {
  readonly provider: XDataProvider;
  readonly code:
    | "NOT_CONFIGURED"
    | "CAPABILITY_UNSUPPORTED"
    | "UPSTREAM_INVALID_RESPONSE"
    | "UPSTREAM_REQUEST_FAILED"
    | "UPSTREAM_RATE_LIMITED";
  readonly capability?: "discovery" | "lookup" | "network" | "tweets";
  readonly missingEnv: string[];

  constructor(input: {
    provider: XDataProvider;
    code:
      | "NOT_CONFIGURED"
      | "CAPABILITY_UNSUPPORTED"
      | "UPSTREAM_INVALID_RESPONSE"
      | "UPSTREAM_REQUEST_FAILED"
      | "UPSTREAM_RATE_LIMITED";
    message: string;
    capability?: "discovery" | "lookup" | "network" | "tweets";
    missingEnv?: string[];
  }) {
    super(input.message);
    this.name = "XProviderRuntimeError";
    this.provider = input.provider;
    this.code = input.code;
    this.capability = input.capability;
    this.missingEnv = input.missingEnv ?? [];
  }
}

export interface XDataClient {
  provider: XDataProvider;
  searchUsers(query: string, maxResults?: number): Promise<XProfile[]>;
  lookupUsersByUsernames(usernames: string[]): Promise<XProfile[]>;
  lookupUsersByIds(userIds: string[]): Promise<XProfile[]>;
  getFollowersPage(input: XUserReference & {
    paginationToken?: string;
    maxResults?: number;
  }): Promise<XProfilesPage>;
  getFollowingPage(input: XUserReference & {
    paginationToken?: string;
    maxResults?: number;
  }): Promise<XProfilesPage>;
  searchRecentPosts(
    query: string,
    maxResults?: number,
    nextToken?: string,
  ): Promise<XPostSearchResult>;
  searchAllPosts(
    query: string,
    maxResults?: number,
    nextToken?: string,
  ): Promise<XPostSearchResult>;
  getUserTweets(input: XUserReference & {
    maxResults?: number;
  }): Promise<XResolvedTweet[]>;
}
