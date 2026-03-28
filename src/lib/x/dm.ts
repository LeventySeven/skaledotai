import "@/lib/server-runtime";

/**
 * X/Twitter Direct Message sending via API v2.
 *
 * Endpoint: POST /2/dm_conversations/with/:participant_id/messages
 * Docs: https://docs.x.com/x-api/direct-messages/create-dm-message-by-participant-id
 *
 * Auth: OAuth 2.0 user-context token with scopes: dm.write, tweet.read, users.read
 *
 * Rate limits (from https://docs.x.com/x-api/fundamentals/rate-limits):
 *   - 15 requests per 15-minute window (per user)
 *   - 1,440 requests per 24 hours (per user)
 *   → effectively 1 DM per minute sustained, burst up to 15 then wait
 *
 * Response (201): { data: { dm_conversation_id: string, dm_event_id: string } }
 */

const X_API_V2_BASE = "https://api.x.com/2";

/** Minimum delay between DMs to stay within 15/15min rate limit (~60s) */
const DM_SEND_DELAY_MS = 62_000;
/** Shorter delay when sending first few (within burst window) */
const DM_BURST_DELAY_MS = 3_000;
/** Max DMs in burst before switching to sustained rate */
const DM_BURST_LIMIT = 12;

export type DmSendResult = {
  success: boolean;
  dmEventId?: string;
  dmConversationId?: string;
  error?: string;
  /** X API error code if available */
  errorCode?: number;
  /** Whether this failure is retryable */
  retryable?: boolean;
};

/**
 * Send a single DM to an X user.
 *
 * @param participantId - The X user ID (numeric string, NOT the @handle)
 * @param text - Message text (min 1 char)
 * @param userAccessToken - OAuth 2.0 user-context access token with dm.write scope
 */
export async function sendDirectMessage(
  participantId: string,
  text: string,
  userAccessToken: string,
): Promise<DmSendResult> {
  if (!participantId || !/^\d{1,19}$/.test(participantId)) {
    return { success: false, error: "Invalid participant ID — must be a numeric X user ID.", retryable: false };
  }
  if (!text.trim()) {
    return { success: false, error: "Message text cannot be empty.", retryable: false };
  }

  try {
    const response = await fetch(
      `${X_API_V2_BASE}/dm_conversations/with/${participantId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${userAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: text.trim() }),
      },
    );

    if (response.status === 201) {
      const body = await response.json() as {
        data?: { dm_conversation_id?: string; dm_event_id?: string };
      };
      return {
        success: true,
        dmEventId: body.data?.dm_event_id,
        dmConversationId: body.data?.dm_conversation_id,
      };
    }

    // Error handling per X API error codes
    const errorText = await response.text().catch(() => "");
    let parsedError: { detail?: string; title?: string; type?: string; errors?: Array<{ message?: string }> } = {};
    try { parsedError = JSON.parse(errorText); } catch { /* raw text */ }
    const errorMessage = parsedError.detail || parsedError.errors?.[0]?.message || parsedError.title || errorText;

    if (response.status === 401) {
      return { success: false, error: "X authentication expired. Reconnect your X account in Settings.", retryable: false, errorCode: 401 };
    }
    if (response.status === 403) {
      return {
        success: false,
        error: `Cannot DM this user: ${errorMessage || "DMs may be disabled, or they don't follow you."}`,
        retryable: false,
        errorCode: 403,
      };
    }
    if (response.status === 429) {
      return { success: false, error: "X rate limit reached (15 DMs per 15 min). Remaining leads will be queued.", retryable: true, errorCode: 429 };
    }

    return { success: false, error: `X API error (${response.status}): ${errorMessage}`, retryable: response.status >= 500, errorCode: response.status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error sending DM.",
      retryable: true,
    };
  }
}

// ── DM Lookup (read conversations) ────────────────────────────────────────
//
// All lookup functions require the user's OAuth 2.0 access token with dm.read
// scope. Obtain via getXAccessToken(userId) from src/server/services/x-auth.ts.
//
// Docs: https://docs.x.com/x-api/direct-messages/get-dm-events-for-a-dm-conversation
// Docs: https://docs.x.com/x-api/direct-messages/get-dm-events

export type DmEvent = {
  id: string;
  text: string;
  senderId: string;
  createdAt: string;
  eventType: string;
  dmConversationId?: string;
  participantIds?: string[];
};

export type DmLookupResult = {
  events: DmEvent[];
  nextToken?: string;
};

type RawDmEvent = {
  id: string;
  text?: string;
  sender_id?: string;
  created_at?: string;
  event_type?: string;
  dm_conversation_id?: string;
  participant_ids?: string[];
};

type XDmResponse = {
  data?: RawDmEvent[];
  includes?: {
    users?: Array<{
      id: string;
      name: string;
      username: string;
      profile_image_url?: string;
      description?: string;
      public_metrics?: { followers_count?: number; following_count?: number };
    }>;
  };
  meta?: { next_token?: string; previous_token?: string; result_count?: number };
  errors?: Array<{ detail?: string; title?: string; type?: string }>;
};

function mapRawEvents(data: RawDmEvent[]): DmEvent[] {
  return data.map((e) => ({
    id: e.id,
    text: e.text ?? "",
    senderId: e.sender_id ?? "",
    createdAt: e.created_at ?? "",
    eventType: e.event_type ?? "MessageCreate",
    dmConversationId: e.dm_conversation_id,
    participantIds: e.participant_ids,
  }));
}

async function xDmRequest(path: string, token: string, params: Record<string, string> = {}): Promise<XDmResponse> {
  const url = new URL(`${X_API_V2_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    const status = response.status;
    if (status === 401) throw new Error("X authentication expired. Reconnect your X account in Settings.");
    if (status === 403) throw new Error(`X API forbidden (403): ${errText}. Your app may lack dm.read scope.`);
    if (status === 429) throw new Error("X API rate limit reached. Try again in a few minutes.");
    throw new Error(`X DM API error (${status}): ${errText}`);
  }

  return response.json() as Promise<XDmResponse>;
}

const DM_EVENT_FIELDS = "id,text,sender_id,created_at,event_type,dm_conversation_id,participant_ids";

/**
 * GET /2/dm_conversations/with/:participant_id/dm_events
 * Fetch DM events for a 1:1 conversation with a specific user.
 */
export async function getDmEventsWithParticipant(
  participantId: string,
  userAccessToken: string,
  maxResults = 100,
  paginationToken?: string,
): Promise<DmLookupResult> {
  if (!participantId || !/^\d{1,19}$/.test(participantId)) {
    throw new Error(`Invalid participant ID: "${participantId}". Must be a numeric X user ID.`);
  }

  const body = await xDmRequest(
    `/dm_conversations/with/${participantId}/dm_events`,
    userAccessToken,
    {
      max_results: String(Math.min(100, Math.max(1, maxResults))),
      "dm_event.fields": DM_EVENT_FIELDS,
      event_types: "MessageCreate",
      ...(paginationToken ? { pagination_token: paginationToken } : {}),
    },
  );

  return {
    events: mapRawEvents(body.data ?? []),
    nextToken: body.meta?.next_token,
  };
}

/**
 * Fetch all DM events with a participant (paginated).
 */
export async function getAllDmEventsWithParticipant(
  participantId: string,
  userAccessToken: string,
  maxPages = 5,
): Promise<DmEvent[]> {
  const allEvents: DmEvent[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await getDmEventsWithParticipant(participantId, userAccessToken, 100, nextToken);
    allEvents.push(...result.events);
    nextToken = result.nextToken;
    if (!nextToken) break;
  }

  return allEvents.reverse();
}

export type DmParticipant = {
  xUserId: string;
  username: string;
  name: string;
  avatarUrl?: string;
  bio?: string;
  followers?: number;
};

/**
 * GET /2/dm_events — list all recent DM events across all conversations.
 * Extracts unique participants (people the user has DM'd with).
 */
export async function getDmParticipants(
  userAccessToken: string,
  ownXUserId: string,
): Promise<DmParticipant[]> {
  const includedUsers = new Map<string, DmParticipant>();
  let nextToken: string | undefined;

  for (let page = 0; page < 3; page++) {
    const body = await xDmRequest("/dm_events", userAccessToken, {
      max_results: "100",
      "dm_event.fields": "id,sender_id,dm_conversation_id,participant_ids",
      expansions: "participant_ids",
      "user.fields": "id,name,username,profile_image_url,public_metrics,description",
      event_types: "MessageCreate",
      ...(nextToken ? { pagination_token: nextToken } : {}),
    });

    // Collect expanded user profiles
    for (const user of body.includes?.users ?? []) {
      if (user.id !== ownXUserId && !includedUsers.has(user.id)) {
        includedUsers.set(user.id, {
          xUserId: user.id,
          username: user.username,
          name: user.name,
          avatarUrl: user.profile_image_url,
          bio: user.description,
          followers: user.public_metrics?.followers_count,
        });
      }
    }

    // Extract from participant_ids for users not in includes
    for (const event of body.data ?? []) {
      for (const pid of event.participant_ids ?? []) {
        if (pid !== ownXUserId && !includedUsers.has(pid)) {
          includedUsers.set(pid, { xUserId: pid, username: "", name: "" });
        }
      }
      if (event.sender_id && event.sender_id !== ownXUserId && !includedUsers.has(event.sender_id)) {
        includedUsers.set(event.sender_id, { xUserId: event.sender_id, username: "", name: "" });
      }
    }

    nextToken = body.meta?.next_token;
    if (!nextToken || (body.data?.length ?? 0) === 0) break;
  }

  return Array.from(includedUsers.values());
}

// ── Batch types ───────────────────────────────────────────────────────────

export type DmBatchProgress = DmSendResult & {
  leadId: string;
  index: number;
  total: number;
};

export type DmBatchResult = {
  sent: number;
  failed: number;
  rateLimited: number;
  results: Array<DmSendResult & { leadId: string }>;
};

/**
 * Send DMs to multiple leads in sequence, respecting X API rate limits.
 *
 * Strategy aligned with X rate limits (15/15min per user):
 * - First 12 DMs: 3s delay (burst)
 * - After 12: 62s delay (sustained ~1/min to stay under 15/15min)
 * - On 429: stop immediately, mark remaining as "queued" (retryable)
 * - On 401: stop immediately, all remaining fail (auth expired)
 * - On 403: skip this lead, continue to next (recipient-specific issue)
 */
export async function sendDirectMessageBatch(
  leads: Array<{ xUserId: string; message: string; leadId: string }>,
  userAccessToken: string,
  onProgress?: (progress: DmBatchProgress) => void,
): Promise<DmBatchResult> {
  const results: Array<DmSendResult & { leadId: string }> = [];
  let sent = 0;
  let failed = 0;
  let rateLimited = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const result = await sendDirectMessage(lead.xUserId, lead.message, userAccessToken);

    results.push({ ...result, leadId: lead.leadId });
    onProgress?.({ ...result, leadId: lead.leadId, index: i, total: leads.length });

    if (result.success) {
      sent++;
    } else {
      failed++;

      // 429 — rate limited: stop sending, queue the rest
      if (result.errorCode === 429) {
        rateLimited = leads.length - i - 1;
        for (let j = i + 1; j < leads.length; j++) {
          results.push({
            success: false,
            error: "Queued — rate limit reached. Will retry later.",
            retryable: true,
            leadId: leads[j].leadId,
          });
        }
        break;
      }

      // 401 — auth expired: stop entirely
      if (result.errorCode === 401) {
        for (let j = i + 1; j < leads.length; j++) {
          results.push({
            success: false,
            error: "Skipped — X authentication expired.",
            retryable: false,
            leadId: leads[j].leadId,
          });
          failed++;
        }
        break;
      }

      // 403 — this specific user can't receive DMs, continue to next
      // Don't delay after a 403 — no request was consumed
      continue;
    }

    // Rate-limit-aware delay between successful sends
    if (i < leads.length - 1) {
      const delay = i < DM_BURST_LIMIT ? DM_BURST_DELAY_MS : DM_SEND_DELAY_MS;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { sent, failed, rateLimited, results };
}
