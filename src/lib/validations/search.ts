import { z } from "zod";
import { SEARCH_TARGET_MAX, SEARCH_TARGET_MIN } from "@/lib/constants";
import { LeadSchema } from "./leads";
import { ProjectRunTraceSchema, ProjectRunTraceStepSchema } from "./project-runs";
import { ProjectSchema } from "./projects";

export const SearchLeadInputSchema = z.object({
  query: z.string().min(1),
  projectId: z.string().uuid().optional(),
  projectName: z.string().optional(),
  followerUsername: z.string().optional(),
  minFollowers: z.number().int().nonnegative().optional(),
  targetLeadCount: z.number().int().min(SEARCH_TARGET_MIN).max(SEARCH_TARGET_MAX).optional(),
  enableWebSearch: z.boolean().optional(),
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

export const SearchRunResultSchema = z.object({
  leads: z.array(LeadSchema),
  project: ProjectSchema,
  trace: ProjectRunTraceSchema,
}).strict();
export type SearchRunResult = z.infer<typeof SearchRunResultSchema>;

export const SearchRunGraphNodeStatusSchema = z.enum(["idle", "active", "complete"]);
export type SearchRunGraphNodeStatus = z.infer<typeof SearchRunGraphNodeStatusSchema>;

export const SearchRunGraphNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: SearchRunGraphNodeStatusSchema,
}).strict();
export type SearchRunGraphNode = z.infer<typeof SearchRunGraphNodeSchema>;

export const SearchRunRecoveryStateSchema = z.enum(["low_yield", "rate_limited", "json_repair", "precision_filtered"]);
export type SearchRunRecoveryState = z.infer<typeof SearchRunRecoveryStateSchema>;

export const SearchRunStopReasonSchema = z.enum(["goal_reached", "max_attempts", "query_exhausted"]);
export type SearchRunStopReason = z.infer<typeof SearchRunStopReasonSchema>;

export const SearchRunStreamSnapshotSchema = z.object({
  queries: z.number().int().nonnegative(),
  urls: z.number().int().nonnegative(),
  scraped: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  targetLeadCount: z.number().int().positive(),
  goalCount: z.number().int().positive(),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  activeNode: z.string().optional(),
  activeSubagent: z.string().optional(),
  recoveryState: SearchRunRecoveryStateSchema.optional(),
  stopReason: SearchRunStopReasonSchema.optional(),
  firstPassCount: z.number().int().nonnegative().optional(),
  graphNodes: z.array(SearchRunGraphNodeSchema).default([]),
}).strict();
export type SearchRunStreamSnapshot = z.infer<typeof SearchRunStreamSnapshotSchema>;

export const SearchRunStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("step"),
    step: ProjectRunTraceStepSchema,
  }).strict(),
  z.object({
    type: z.literal("snapshot"),
    snapshot: SearchRunStreamSnapshotSchema,
  }).strict(),
  z.object({
    type: z.literal("complete"),
    result: SearchRunResultSchema,
  }).strict(),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }).strict(),
]);
export type SearchRunStreamEvent = z.infer<typeof SearchRunStreamEventSchema>;
