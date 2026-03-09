import { z } from "zod";

export const PlatformSchema = z.enum(["twitter"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const PrioritySchema = z.enum(["P0", "P1"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const LeadStageSchema = z.enum(["found", "messaged", "replied", "agreed"]);
export type LeadStage = z.infer<typeof LeadStageSchema>;

export const DiscoverySourceSchema = z.enum([
  "profile_search",
  "post_search",
  "reply_search",
  "followers",
  "following",
]);
export type DiscoverySource = z.infer<typeof DiscoverySourceSchema>;
