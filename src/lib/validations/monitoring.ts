import { z } from "zod";
import { PlatformSchema } from "./shared";

export const ResponseStatusSchema = z.enum(["reached_out", "answered", "done"]);
export type ResponseStatus = z.infer<typeof ResponseStatusSchema>;

export const MonitoredLeadSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  bio: z.string(),
  platform: PlatformSchema,
  followers: z.number(),
  avatarUrl: z.string().optional(),
  xUserId: z.string().optional(),
  sourceTable: z.enum(["leads", "contra"]),
  sourceId: z.string(),
  monitoring: z.boolean(),
  responseStatus: ResponseStatusSchema,
  lastDmCheck: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type MonitoredLead = z.infer<typeof MonitoredLeadSchema>;

export const MonitoringPatchSchema = z.object({
  monitoring: z.boolean().optional(),
  responseStatus: ResponseStatusSchema.optional(),
});
export type MonitoringPatch = z.infer<typeof MonitoringPatchSchema>;

export const MonitoringSortSchema = z.enum(["followers-desc", "followers-asc", "name-asc", "recent"]);
export type MonitoringSort = z.infer<typeof MonitoringSortSchema>;

export const ListMonitoringInputSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
  sort: MonitoringSortSchema.default("recent"),
  search: z.string().default(""),
  status: z.enum(["all", ...ResponseStatusSchema.options]).default("all"),
  monitoringOnly: z.boolean().default(false),
});
export type ListMonitoringInput = z.infer<typeof ListMonitoringInputSchema>;

export const AddToMonitoringInputSchema = z.object({
  sourceTable: z.enum(["leads", "contra"]),
  sourceIds: z.array(z.string()).min(1),
});
export type AddToMonitoringInput = z.infer<typeof AddToMonitoringInputSchema>;

export const DmEventSchema = z.object({
  id: z.string(),
  text: z.string(),
  senderId: z.string(),
  createdAt: z.string(),
  eventType: z.string(),
  dmConversationId: z.string().optional(),
  isOwn: z.boolean(),
});
export type DmEventClient = z.infer<typeof DmEventSchema>;

export const DmConversationSchema = z.object({
  handle: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  xUserId: z.string(),
  events: z.array(DmEventSchema),
  lastFetched: z.string().optional(),
});
export type DmConversation = z.infer<typeof DmConversationSchema>;
