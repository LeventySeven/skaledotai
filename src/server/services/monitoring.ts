import "@/lib/server-runtime";
import { db } from "@/db";
import { monitoredLeads, leads, contra, account } from "@/db/schema";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { redis } from "@/lib/redis";
import { lookupUsersByUsernames, lookupUsersByIds } from "@/lib/x/api";
import { getAllDmEventsWithParticipant, getDmParticipants, type DmEvent } from "@/lib/x/dm";
import { getXAccessToken } from "@/server/services/x-auth";
import { TRPCError } from "@trpc/server";
import type {
  MonitoredLead,
  MonitoringPatch,
  ListMonitoringInput,
  DmConversation,
  DmEventClient,
} from "@/lib/validations/monitoring";
import OpenAI from "openai";

// ── Redis key helpers ────────────────────────────────────────────────────

const HANDLE_TO_ID_PREFIX = "handle-to-xid:";
const DM_CACHE_PREFIX = "dm-cache:";

/** 7 days — handles can change, don't cache forever */
const HANDLE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** 90 days — DM cache preserves history beyond X API's 30-day window */
const DM_CACHE_TTL_SECONDS = 90 * 24 * 60 * 60;

// ── Row mapping ──────────────────────────────────────────────────────────

type MonitoredRow = typeof monitoredLeads.$inferSelect;

function rowToMonitoredLead(row: MonitoredRow): MonitoredLead {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    bio: row.bio,
    platform: row.platform as MonitoredLead["platform"],
    followers: row.followers,
    avatarUrl: row.avatarUrl ?? undefined,
    xUserId: row.xUserId ?? undefined,
    sourceTable: row.sourceTable as MonitoredLead["sourceTable"],
    sourceId: row.sourceId,
    monitoring: row.monitoring,
    responseStatus: row.responseStatus as MonitoredLead["responseStatus"],
    lastDmCheck: row.lastDmCheck?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── User X account helpers ───────────────────────────────────────────────

async function requireXToken(userId: string): Promise<string> {
  const token = await getXAccessToken(userId);
  if (!token) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Connect your X account to use DM monitoring. Go to Settings → Connect X Account.",
    });
  }
  return token;
}

/** Get the authenticated user's own X user ID from the account table. */
async function getOwnXUserId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "twitter")))
    .limit(1);
  return row?.accountId ?? null;
}

// ── Handle → X User ID resolution (with Redis cache) ────────────────────

export async function resolveHandleToXUserId(handle: string): Promise<string | null> {
  const cleanHandle = handle.replace(/^@/, "").trim().toLowerCase();
  if (!cleanHandle) return null;

  const cacheKey = `${HANDLE_TO_ID_PREFIX}${cleanHandle}`;

  // Check cache first
  const cached = await redis.get<string>(cacheKey);
  if (cached) return cached;

  // Lookup via X API
  try {
    const profiles = await lookupUsersByUsernames([cleanHandle]);
    if (profiles.length > 0 && profiles[0].xUserId) {
      const xUserId = profiles[0].xUserId;
      await redis.set(cacheKey, xUserId, { ex: HANDLE_TTL_SECONDS });
      return xUserId;
    }
  } catch (error) {
    console.error(`[Monitoring] Failed to resolve handle @${cleanHandle}:`, error);
  }

  return null;
}

// ── Add leads to monitoring ──────────────────────────────────────────────

export async function addToMonitoring(
  userId: string,
  sourceTable: "leads" | "contra",
  sourceIds: string[],
): Promise<number> {
  if (sourceIds.length === 0) return 0;

  let sourceRows: Array<{
    id: string;
    handle: string;
    name: string;
    bio: string;
    platform: string;
    followers: number;
    avatarUrl: string | null;
    xUserId: string | null;
  }>;

  if (sourceTable === "leads") {
    sourceRows = await db
      .select({
        id: leads.id,
        handle: leads.handle,
        name: leads.name,
        bio: leads.bio,
        platform: leads.platform,
        followers: leads.followers,
        avatarUrl: leads.avatarUrl,
        xUserId: leads.xUserId,
      })
      .from(leads)
      .where(and(eq(leads.userId, userId), inArray(leads.id, sourceIds)));
  } else {
    const contraRows = await db
      .select({
        id: contra.id,
        handle: contra.handle,
        name: contra.name,
        bio: contra.bio,
        platform: contra.platform,
        followers: contra.followers,
        avatarUrl: contra.avatarUrl,
      })
      .from(contra)
      .where(inArray(contra.id, sourceIds));
    sourceRows = contraRows.map((r) => ({
      ...r,
      followers: r.followers ?? 0,
      xUserId: null,
    }));
  }

  if (sourceRows.length === 0) return 0;

  const values = sourceRows.map((row) => ({
    userId,
    handle: row.handle,
    name: row.name,
    bio: row.bio,
    platform: row.platform,
    followers: row.followers ?? 0,
    avatarUrl: row.avatarUrl,
    xUserId: row.xUserId,
    sourceTable,
    sourceId: row.id,
    monitoring: true,
    responseStatus: "reached_out" as const,
  }));

  const result = await db
    .insert(monitoredLeads)
    .values(values)
    .onConflictDoUpdate({
      target: [monitoredLeads.userId, monitoredLeads.handle, monitoredLeads.platform],
      set: {
        name: sql`excluded.name`,
        bio: sql`excluded.bio`,
        followers: sql`excluded.followers`,
        avatarUrl: sql`excluded.avatar_url`,
        monitoring: sql`true`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: monitoredLeads.id });

  return result.length;
}

// ── List monitored leads ─────────────────────────────────────────────────

export async function listMonitored(
  userId: string,
  input: ListMonitoringInput,
): Promise<{ leads: MonitoredLead[]; total: number }> {
  const conditions = [eq(monitoredLeads.userId, userId)];

  if (input.search) {
    conditions.push(
      or(
        ilike(monitoredLeads.name, `%${input.search}%`),
        ilike(monitoredLeads.handle, `%${input.search}%`),
      )!,
    );
  }

  if (input.status !== "all") {
    conditions.push(eq(monitoredLeads.responseStatus, input.status));
  }

  if (input.monitoringOnly) {
    conditions.push(eq(monitoredLeads.monitoring, true));
  }

  const where = and(...conditions);

  const orderMap = {
    "followers-desc": desc(monitoredLeads.followers),
    "followers-asc": asc(monitoredLeads.followers),
    "name-asc": asc(monitoredLeads.name),
    "recent": desc(monitoredLeads.updatedAt),
  };

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(monitoredLeads)
      .where(where)
      .orderBy(orderMap[input.sort])
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ count: count() }).from(monitoredLeads).where(where),
  ]);

  return {
    leads: rows.map(rowToMonitoredLead),
    total: totalRow?.count ?? 0,
  };
}

// ── Update monitoring status ─────────────────────────────────────────────

export async function updateMonitored(
  userId: string,
  id: string,
  patch: MonitoringPatch,
): Promise<MonitoredLead> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if ("monitoring" in patch) updates.monitoring = patch.monitoring;
  if ("responseStatus" in patch) updates.responseStatus = patch.responseStatus;

  const [row] = await db
    .update(monitoredLeads)
    .set(updates)
    .where(and(eq(monitoredLeads.id, id), eq(monitoredLeads.userId, userId)))
    .returning();

  if (!row) throw new Error("Monitored lead not found");
  return rowToMonitoredLead(row);
}

export async function bulkUpdateMonitored(
  userId: string,
  ids: string[],
  patch: MonitoringPatch,
): Promise<number> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if ("monitoring" in patch) updates.monitoring = patch.monitoring;
  if ("responseStatus" in patch) updates.responseStatus = patch.responseStatus;

  const result = await db
    .update(monitoredLeads)
    .set(updates)
    .where(and(eq(monitoredLeads.userId, userId), inArray(monitoredLeads.id, ids)))
    .returning({ id: monitoredLeads.id });
  return result.length;
}

export async function removeMonitored(userId: string, id: string): Promise<void> {
  await db
    .delete(monitoredLeads)
    .where(and(eq(monitoredLeads.id, id), eq(monitoredLeads.userId, userId)));
}

// ── DM cache helpers ─────────────────────────────────────────────────────

/** Build per-user DM cache key to prevent cross-user cache collisions. */
function dmCacheKey(userId: string, xUserId: string): string {
  return `${DM_CACHE_PREFIX}${userId}:${xUserId}`;
}

/** Load cached DM events from Redis for a given user + lead pair. */
async function loadCachedDms(userId: string, xUserId: string): Promise<DmEvent[]> {
  const cached = await redis.get<DmEvent[]>(dmCacheKey(userId, xUserId));
  if (!cached || !Array.isArray(cached)) return [];
  return cached;
}

/** Save DM events to Redis cache with TTL. Upstash auto-serializes. */
async function saveDmsToCache(userId: string, xUserId: string, events: DmEvent[]): Promise<void> {
  if (events.length === 0) return;
  await redis.set(dmCacheKey(userId, xUserId), events, { ex: DM_CACHE_TTL_SECONDS });
}

/**
 * Merge cached dialogue with freshly fetched events.
 * Deduplicates by event ID, sorts by createdAt ascending (oldest first).
 */
function mergeDmEvents(cached: DmEvent[], fresh: DmEvent[]): DmEvent[] {
  const seen = new Map<string, DmEvent>();
  // Cached first, then fresh overwrites (fresh data is more up-to-date)
  for (const e of cached) seen.set(e.id, e);
  for (const e of fresh) seen.set(e.id, e);
  return Array.from(seen.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

// ── Map DM events to client format ───────────────────────────────────────

function toClientEvents(events: DmEvent[], leadXUserId: string): DmEventClient[] {
  return events.map((e) => ({
    id: e.id,
    text: e.text,
    senderId: e.senderId,
    createdAt: e.createdAt,
    eventType: e.eventType,
    dmConversationId: e.dmConversationId,
    isOwn: e.senderId !== leadXUserId,
  }));
}

// ── Resolve xUserId for a lead (resolve + persist if missing) ────────────

async function ensureXUserId(lead: MonitoredRow): Promise<string | null> {
  if (lead.xUserId) return lead.xUserId;
  const xUserId = await resolveHandleToXUserId(lead.handle);
  if (xUserId) {
    await db
      .update(monitoredLeads)
      .set({ xUserId, updatedAt: new Date() })
      .where(eq(monitoredLeads.id, lead.id));
  }
  return xUserId;
}

// ── Get DMs for a lead (cache-first, transparent refresh if empty) ───────

export async function fetchDmsForLead(
  userId: string,
  monitoredLeadId: string,
): Promise<DmConversation | null> {
  const [lead] = await db
    .select()
    .from(monitoredLeads)
    .where(and(eq(monitoredLeads.id, monitoredLeadId), eq(monitoredLeads.userId, userId)))
    .limit(1);

  if (!lead) return null;

  const xUserId = await ensureXUserId(lead);
  if (!xUserId) {
    return { handle: lead.handle, name: lead.name, avatarUrl: lead.avatarUrl ?? undefined, xUserId: "", events: [] };
  }

  // Try cache first
  let events = await loadCachedDms(userId, xUserId);

  // If cache is empty, do a transparent one-time refresh
  if (events.length === 0) {
    try {
      const token = await getXAccessToken(userId);
      if (token) {
        const freshEvents = await getAllDmEventsWithParticipant(xUserId, token);
        if (freshEvents.length > 0) {
          events = freshEvents;
          await saveDmsToCache(userId, xUserId, events);
        }
      }
    } catch {
      // X API unavailable — return empty, user can manually refresh
    }
  }

  return {
    handle: lead.handle,
    name: lead.name,
    avatarUrl: lead.avatarUrl ?? undefined,
    xUserId,
    events: toClientEvents(events, xUserId),
    lastFetched: lead.lastDmCheck?.toISOString(),
  };
}

// ── Refresh single lead DMs (X API call + cache merge + AI status) ───────

export async function refreshDmsForLead(
  userId: string,
  monitoredLeadId: string,
): Promise<DmConversation | null> {
  const [lead] = await db
    .select()
    .from(monitoredLeads)
    .where(and(eq(monitoredLeads.id, monitoredLeadId), eq(monitoredLeads.userId, userId)))
    .limit(1);

  if (!lead) return null;

  const token = await requireXToken(userId);
  const xUserId = await ensureXUserId(lead);

  if (!xUserId) {
    return { handle: lead.handle, name: lead.name, avatarUrl: lead.avatarUrl ?? undefined, xUserId: "", events: [] };
  }

  // Fetch fresh from X API, merge with existing cache, save back
  const cachedEvents = await loadCachedDms(userId, xUserId);
  const freshEvents = await getAllDmEventsWithParticipant(xUserId, token);
  const events = mergeDmEvents(cachedEvents, freshEvents);
  await saveDmsToCache(userId, xUserId, events);

  // AI-analyze status from full conversation
  const newStatus = await analyzeResponseStatus(events, xUserId, lead.name);
  await db
    .update(monitoredLeads)
    .set({
      ...(newStatus && newStatus !== lead.responseStatus ? { responseStatus: newStatus } : {}),
      lastDmCheck: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(monitoredLeads.id, monitoredLeadId));

  return {
    handle: lead.handle,
    name: lead.name,
    avatarUrl: lead.avatarUrl ?? undefined,
    xUserId,
    events: toClientEvents(events, xUserId),
    lastFetched: new Date().toISOString(),
  };
}

// ── Refresh all ticked leads (triggered on page open) ────────────────────

export async function refreshAllMonitoredDms(userId: string): Promise<{
  checked: number;
  updated: number;
}> {
  const token = await getXAccessToken(userId);
  if (!token) return { checked: 0, updated: 0 };

  const monitoredRows = await db
    .select()
    .from(monitoredLeads)
    .where(and(eq(monitoredLeads.userId, userId), eq(monitoredLeads.monitoring, true)));

  let checked = 0;
  let updated = 0;

  for (const lead of monitoredRows) {
    const xUserId = await ensureXUserId(lead);
    if (!xUserId) continue;

    try {
      const cachedEvents = await loadCachedDms(userId, xUserId);
      const freshEvents = await getAllDmEventsWithParticipant(xUserId, token);
      const allEvents = mergeDmEvents(cachedEvents, freshEvents);
      checked++;

      await saveDmsToCache(userId, xUserId, allEvents);

      const newStatus = await analyzeResponseStatus(allEvents, xUserId, lead.name);
      if (newStatus && newStatus !== lead.responseStatus) {
        await db
          .update(monitoredLeads)
          .set({ responseStatus: newStatus, lastDmCheck: new Date(), updatedAt: new Date() })
          .where(eq(monitoredLeads.id, lead.id));
        updated++;
      } else {
        await db
          .update(monitoredLeads)
          .set({ lastDmCheck: new Date(), updatedAt: new Date() })
          .where(eq(monitoredLeads.id, lead.id));
      }
    } catch (error) {
      console.error(`[Monitoring] Failed to refresh DMs for @${lead.handle}:`, error);
    }
  }

  return { checked, updated };
}

// ── Suggest from DMs ─────────────────────────────────────────────────────

export type DmSuggestion = {
  xUserId: string;
  username: string;
  name: string;
  avatarUrl?: string;
  bio?: string;
  followers?: number;
  alreadyMonitored: boolean;
};

/**
 * Fetch all recent DM conversations and return unique participants as suggestions.
 * Uses the user's OAuth token to call GET /2/dm_events and extracts
 * the people the user has DM'd with.
 */
export async function suggestFromDms(userId: string): Promise<DmSuggestion[]> {
  const token = await requireXToken(userId);
  const ownXUserId = await getOwnXUserId(userId);
  if (!ownXUserId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Cannot determine your X user ID. Reconnect your X account in Settings.",
    });
  }

  // Fetch DM participants
  const participants = await getDmParticipants(token, ownXUserId);

  // Resolve any participants that are missing profile data (username empty)
  const unresolvedIds = participants.filter((p) => !p.username).map((p) => p.xUserId);
  if (unresolvedIds.length > 0) {
    try {
      const profiles = await lookupUsersByIds(unresolvedIds);
      const profileMap = new Map(profiles.map((p) => [p.xUserId, p]));
      for (const participant of participants) {
        if (!participant.username && profileMap.has(participant.xUserId)) {
          const profile = profileMap.get(participant.xUserId)!;
          participant.username = profile.username;
          participant.name = profile.displayName;
          participant.avatarUrl = profile.avatarUrl;
          participant.bio = profile.bio;
          participant.followers = profile.followersCount;
        }
      }
    } catch (error) {
      console.error("[Monitoring] Failed to resolve DM participant profiles:", error);
    }
  }

  // Filter out participants with no username (unresolvable)
  const resolved = participants.filter((p) => p.username);

  // Check which ones are already monitored
  const existingHandles = new Set<string>();
  if (resolved.length > 0) {
    const existing = await db
      .select({ handle: monitoredLeads.handle })
      .from(monitoredLeads)
      .where(eq(monitoredLeads.userId, userId));
    for (const row of existing) {
      existingHandles.add(row.handle.toLowerCase());
    }
  }

  // Cache all resolved handle→ID mappings
  for (const p of resolved) {
    const cacheKey = `${HANDLE_TO_ID_PREFIX}${p.username.toLowerCase()}`;
    await redis.set(cacheKey, p.xUserId, { ex: HANDLE_TTL_SECONDS });
  }

  return resolved.map((p) => ({
    xUserId: p.xUserId,
    username: p.username,
    name: p.name,
    avatarUrl: p.avatarUrl,
    bio: p.bio,
    followers: p.followers,
    alreadyMonitored: existingHandles.has(p.username.toLowerCase()),
  }));
}

/**
 * Add DM suggestions directly to monitoring (from the suggest flow).
 */
export async function addSuggestionsToMonitoring(
  userId: string,
  suggestions: Array<{ xUserId: string; username: string; name: string; avatarUrl?: string; bio?: string; followers?: number }>,
): Promise<number> {
  if (suggestions.length === 0) return 0;

  const values = suggestions.map((s) => ({
    userId,
    handle: s.username,
    name: s.name || s.username,
    bio: s.bio ?? "",
    platform: "twitter",
    followers: s.followers ?? 0,
    avatarUrl: s.avatarUrl ?? null,
    xUserId: s.xUserId,
    sourceTable: "leads" as const,
    sourceId: s.xUserId, // use xUserId as sourceId since these come from DMs
    monitoring: true,
    responseStatus: "reached_out" as const,
  }));

  const result = await db
    .insert(monitoredLeads)
    .values(values)
    .onConflictDoUpdate({
      target: [monitoredLeads.userId, monitoredLeads.handle, monitoredLeads.platform],
      set: {
        name: sql`excluded.name`,
        bio: sql`excluded.bio`,
        followers: sql`excluded.followers`,
        avatarUrl: sql`excluded.avatar_url`,
        xUserId: sql`excluded.x_user_id`,
        monitoring: sql`true`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: monitoredLeads.id });

  return result.length;
}

// ── AI status analysis ───────────────────────────────────────────────────

async function analyzeResponseStatus(
  events: DmEvent[],
  participantXUserId: string,
  leadName: string,
): Promise<"reached_out" | "answered" | "done" | null> {
  if (events.length === 0) return "reached_out";

  // Check if participant has sent any messages
  const participantMessages = events.filter((e) => e.senderId === participantXUserId);
  if (participantMessages.length === 0) return "reached_out";

  // Use AI to analyze the full conversation (cached + fresh merged)
  try {
    const openai = new OpenAI();
    const conversationText = events
      .map((e) => {
        const who = e.senderId === participantXUserId ? leadName : "Us";
        return `[${who}]: ${e.text}`;
      })
      .join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You analyze DM conversations to determine outreach status. The goal is to recruit leads to interact with posts for a fee (likes, reposts, comments).

You are given the FULL conversation history (including older cached messages and newer messages).

Respond with EXACTLY one word:
- "reached_out" — we messaged but they haven't meaningfully replied yet
- "answered" — they replied and there's ongoing conversation, but no deal yet
- "done" — they agreed to become a lead and interact with posts for a fee`,
        },
        {
          role: "user",
          content: `Full conversation with ${leadName} (${events.length} messages):\n\n${conversationText}\n\nStatus:`,
        },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const result = response.choices[0]?.message?.content?.trim().toLowerCase();
    if (result === "reached_out" || result === "answered" || result === "done") {
      return result;
    }
  } catch (error) {
    console.error(`[Monitoring] AI status analysis failed for ${leadName}:`, error);
  }

  // Fallback: if they replied, mark as answered
  return "answered";
}
