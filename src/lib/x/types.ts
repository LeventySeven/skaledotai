import type { XProfile } from "@/lib/validations/search";
import type { XDataProvider } from "./provider";

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

export interface XDataClient {
  provider: XDataProvider;
  searchUsers(query: string, maxResults?: number): Promise<XProfile[]>;
  lookupUsersByUsernames(usernames: string[]): Promise<XProfile[]>;
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

