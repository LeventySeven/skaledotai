import {
  pgTable,
  text,
  boolean,
  timestamp,
  uuid,
  integer,
  numeric,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ── Better Auth ───────────────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [
  index("accounts_user_provider_idx").on(table.userId, table.providerId),
]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── App tables ────────────────────────────────────────────────────────────────

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Owner — every lead belongs to exactly one user
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

  // X/Twitter profile identity
  xUserId: text("x_user_id"),

  name: text("name").notNull(),
  handle: text("handle").notNull().default(""),
  bio: text("bio").notNull().default(""),
  platform: text("platform").notNull(),
  followers: integer("followers").notNull().default(0),
  following: integer("following"),
  avatarUrl: text("avatar_url"),
  profileUrl: text("profile_url"),
  email: text("email"),
  budget: numeric("budget", { precision: 10, scale: 2 }),

  // CRM fields
  stage: text("stage").notNull().default("found"), // found | messaged | replied | agreed
  priority: text("priority").notNull().default("P1"),
  dmComfort: boolean("dm_comfort").notNull().default(false),
  theAsk: text("the_ask").notNull().default(""),
  inOutreach: boolean("in_outreach").notNull().default(false),
  discoverySource: text("discovery_source"), // profile_search | post_search | reply_search | followers | following
  discoveryQuery: text("discovery_query"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Same person on same platform is unique per user (not globally)
  uniqueIndex("leads_user_handle_platform_idx").on(table.userId, table.handle, table.platform),
  index("leads_user_id_idx").on(table.userId),
]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Owner
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

  name: text("name").notNull(),
  query: text("query"),
  seedUsername: text("seed_username"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("projects_user_id_idx").on(table.userId),
]);

export const projectLeads = pgTable("project_leads", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.leadId] }),
]);

export const projectRuns = pgTable("project_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  requestKey: text("request_key").notNull(),
  operationType: text("operation_type").notNull(),
  requestedProvider: text("requested_provider").notNull(),
  discoveryProvider: text("discovery_provider").notNull(),
  lookupProvider: text("lookup_provider").notNull(),
  networkProvider: text("network_provider").notNull(),
  tweetsProvider: text("tweets_provider").notNull(),
  query: text("query"),
  seedUsername: text("seed_username"),
  leadCount: integer("lead_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_runs_project_id_idx").on(table.projectId),
  index("project_runs_requested_provider_idx").on(table.requestedProvider),
  uniqueIndex("project_runs_request_key_idx").on(table.requestKey),
]);

export const postStats = pgTable("post_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }).unique(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  postCount: integer("post_count").notNull().default(0),
  avgViews: numeric("avg_views", { precision: 12, scale: 2 }),
  avgLikes: numeric("avg_likes", { precision: 12, scale: 2 }),
  avgReplies: numeric("avg_replies", { precision: 12, scale: 2 }),
  avgReposts: numeric("avg_reposts", { precision: 12, scale: 2 }),
  topTopics: text("top_topics").array(),
});

export const outreachTemplates = pgTable("outreach_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

  title: text("title").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  replyRate: text("reply_rate").notNull().default("—"),
  sourceId: text("source_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("outreach_templates_user_id_idx").on(table.userId),
]);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Owner
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsed: timestamp("last_used", { withTimezone: true }),
}, (table) => [
  index("api_keys_user_id_idx").on(table.userId),
]);
