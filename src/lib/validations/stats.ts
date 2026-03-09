import { z } from "zod";

export const PostStatsSchema = z.object({
  id: z.string(),
  leadId: z.string(),
  fetchedAt: z.string(),
  postCount: z.number(),
  avgViews: z.number().optional(),
  avgLikes: z.number().optional(),
  avgReplies: z.number().optional(),
  avgReposts: z.number().optional(),
  topTopics: z.array(z.string()).optional(),
});
export type PostStats = z.infer<typeof PostStatsSchema>;

export const GetPostStatsInputSchema = z.object({
  profileId: z.string().uuid(),
});
export type GetPostStatsInput = z.infer<typeof GetPostStatsInputSchema>;

export const RefreshStatsInputSchema = z.object({
  profileId: z.string().uuid(),
  crmId: z.string().uuid().optional(),
  niche: z.string().optional(),
});
export type RefreshStatsInput = z.infer<typeof RefreshStatsInputSchema>;
