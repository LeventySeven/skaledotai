import "@/lib/server-runtime";
import type { XDataClient, XResolvedTweet } from "./types";
import {
  getFollowersPage as getXFollowersPage,
  getFollowingPage as getXFollowingPage,
  getUserTweets as getXUserTweets,
  lookupUsersByUsernames as lookupXUsersByUsernames,
  searchAllPosts as searchXAllPosts,
  searchRecentPosts as searchXRecentPosts,
  searchUsers as searchXUsers,
} from "./api";

function normalizeTweet(tweet: {
  id: string;
  author_id?: string;
  conversation_id?: string;
  created_at?: string;
  text?: string;
  public_metrics?: {
    impression_count?: number;
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
  };
}): XResolvedTweet {
  return {
    id: tweet.id,
    authorId: tweet.author_id,
    conversationId: tweet.conversation_id,
    createdAt: tweet.created_at,
    text: tweet.text ?? "",
    viewCount: tweet.public_metrics?.impression_count ?? 0,
    likeCount: tweet.public_metrics?.like_count ?? 0,
    replyCount: tweet.public_metrics?.reply_count ?? 0,
    repostCount: tweet.public_metrics?.retweet_count ?? 0,
  };
}

async function resolveUserId(input: { userId?: string; username?: string }, context: string): Promise<string> {
  if (input.userId) return input.userId;
  if (input.username) {
    const [profile] = await lookupXUsersByUsernames([input.username]);
    if (profile?.xUserId) return profile.xUserId;
  }
  throw new Error(`X API ${context} requires a resolvable X user ID.`);
}

export const xApiClient: XDataClient = {
  provider: "x-api",

  searchUsers(query, maxResults = 25) {
    return searchXUsers(query, maxResults);
  },

  lookupUsersByUsernames(usernames) {
    return lookupXUsersByUsernames(usernames);
  },

  async getFollowersPage(input) {
    const userId = await resolveUserId(input, "followers lookup");
    return getXFollowersPage(userId, input.paginationToken, input.maxResults);
  },

  async getFollowingPage(input) {
    const userId = await resolveUserId(input, "following lookup");
    return getXFollowingPage(userId, input.paginationToken, input.maxResults);
  },

  async searchRecentPosts(query, maxResults = 50, nextToken) {
    const response = await searchXRecentPosts(query, maxResults, nextToken);
    return {
      tweets: response.tweets.map(normalizeTweet),
      users: response.users,
      nextToken: response.nextToken,
    };
  },

  async searchAllPosts(query, maxResults = 50, nextToken) {
    const response = await searchXAllPosts(query, maxResults, nextToken);
    return {
      tweets: response.tweets.map(normalizeTweet),
      users: response.users,
      nextToken: response.nextToken,
    };
  },

  async getUserTweets(input) {
    const userId = await resolveUserId(input, "tweet lookup");
    const tweets = await getXUserTweets(userId, input.maxResults);
    return tweets.map(normalizeTweet);
  },
};
