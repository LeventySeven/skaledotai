import "server-only";
import type { XDataClient, XTweetMetrics } from "./types";
import type { XDataProvider } from "./provider";
import {
  getFollowersPage as getXFollowersPage,
  getFollowingPage as getXFollowingPage,
  getUserTweets as getXUserTweets,
  lookupUsersByUsernames as lookupXUsersByUsernames,
  searchAllPosts as searchXAllPosts,
  searchRecentPosts as searchXRecentPosts,
  searchUsers as searchXUsers,
} from "./api";
import { apifyClient } from "./apify";
import { phantomBusterClient } from "./phantombuster";

const xApiClient: XDataClient = {
  provider: "x-api",

  searchUsers(query, maxResults = 25) {
    return searchXUsers(query, maxResults);
  },

  lookupUsersByUsernames(usernames) {
    return lookupXUsersByUsernames(usernames);
  },

  async getFollowersPage(input) {
    let userId = input.userId;
    if (!userId && input.username) {
      const [profile] = await lookupXUsersByUsernames([input.username]);
      userId = profile?.xUserId;
    }
    if (!userId) {
      throw new Error("X API followers lookup requires a resolvable X user ID.");
    }

    return getXFollowersPage(userId, input.paginationToken, input.maxResults);
  },

  async getFollowingPage(input) {
    let userId = input.userId;
    if (!userId && input.username) {
      const [profile] = await lookupXUsersByUsernames([input.username]);
      userId = profile?.xUserId;
    }
    if (!userId) {
      throw new Error("X API following lookup requires a resolvable X user ID.");
    }

    return getXFollowingPage(userId, input.paginationToken, input.maxResults);
  },

  async searchRecentPosts(query, maxResults = 50, nextToken) {
    const response = await searchXRecentPosts(query, maxResults, nextToken);
    return {
      tweets: response.tweets.map((tweet) => ({
        id: tweet.id,
        authorId: tweet.author_id,
        conversationId: tweet.conversation_id,
        createdAt: tweet.created_at,
        text: tweet.text ?? "",
        viewCount: tweet.public_metrics?.impression_count ?? 0,
        likeCount: tweet.public_metrics?.like_count ?? 0,
        replyCount: tweet.public_metrics?.reply_count ?? 0,
        repostCount: tweet.public_metrics?.retweet_count ?? 0,
      })),
      users: response.users,
      nextToken: response.nextToken,
    };
  },

  async searchAllPosts(query, maxResults = 50, nextToken) {
    const response = await searchXAllPosts(query, maxResults, nextToken);
    return {
      tweets: response.tweets.map((tweet) => ({
        id: tweet.id,
        authorId: tweet.author_id,
        conversationId: tweet.conversation_id,
        createdAt: tweet.created_at,
        text: tweet.text ?? "",
        viewCount: tweet.public_metrics?.impression_count ?? 0,
        likeCount: tweet.public_metrics?.like_count ?? 0,
        replyCount: tweet.public_metrics?.reply_count ?? 0,
        repostCount: tweet.public_metrics?.retweet_count ?? 0,
      })),
      users: response.users,
      nextToken: response.nextToken,
    };
  },

  async getUserTweets(input) {
    let userId = input.userId;
    if (!userId && input.username) {
      const [profile] = await lookupXUsersByUsernames([input.username]);
      userId = profile?.xUserId;
    }
    if (!userId) {
      throw new Error("X API tweet lookup requires a resolvable X user ID.");
    }

    const tweets = await getXUserTweets(userId, input.maxResults);
    return tweets.map((tweet) => ({
      id: tweet.id,
      authorId: tweet.author_id,
      conversationId: tweet.conversation_id,
      createdAt: tweet.created_at,
      text: tweet.text ?? "",
      viewCount: tweet.public_metrics?.impression_count ?? 0,
      likeCount: tweet.public_metrics?.like_count ?? 0,
      replyCount: tweet.public_metrics?.reply_count ?? 0,
      repostCount: tweet.public_metrics?.retweet_count ?? 0,
    }));
  },
};

export function getXDataClient(provider: XDataProvider): XDataClient {
  switch (provider) {
    case "apify":
      return apifyClient;
    case "phantombuster":
      return phantomBusterClient;
    case "x-api":
    default:
      return xApiClient;
  }
}

export function mapTweetsToMetrics(
  tweets: Array<{
    id: string;
    text: string;
    viewCount: number;
    likeCount: number;
    replyCount: number;
    repostCount: number;
  }>,
): XTweetMetrics[] {
  return tweets.map((tweet) => ({
    id: tweet.id,
    text: tweet.text,
    viewCount: tweet.viewCount,
    likeCount: tweet.likeCount,
    replyCount: tweet.replyCount,
    repostCount: tweet.repostCount,
  }));
}

