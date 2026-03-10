import { z } from "zod";
import { SEARCH_TARGET_MAX, SEARCH_TARGET_MIN } from "@/lib/constants";

export const SearchLeadInputSchema = z.object({
  query: z.string().min(1),
  projectId: z.string().uuid().optional(),
  projectName: z.string().optional(),
  followerUsername: z.string().optional(),
  minFollowers: z.number().int().nonnegative().optional(),
  targetLeadCount: z.number().int().min(SEARCH_TARGET_MIN).max(SEARCH_TARGET_MAX).optional(),
});
export type SearchLeadInput = z.infer<typeof SearchLeadInputSchema>;

export const ImportNetworkInputSchema = z.object({
  username: z.string().min(1),
  projectId: z.string().uuid().optional(),
  projectName: z.string().optional(),
});
export type ImportNetworkInput = z.infer<typeof ImportNetworkInputSchema>;

export const XProfileSchema = z.object({
  xUserId: z.string(),
  username: z.string(),
  displayName: z.string(),
  bio: z.string(),
  avatarUrl: z.string().optional(),
  profileUrl: z.string().optional(),
  followersCount: z.number(),
  followingCount: z.number(),
  tweetCount: z.number().optional(),
  listedCount: z.number().optional(),
  verified: z.boolean().optional(),
  verifiedType: z.string().optional(),
  location: z.string().optional(),
  url: z.string().optional(),
});
export type XProfile = z.infer<typeof XProfileSchema>;
