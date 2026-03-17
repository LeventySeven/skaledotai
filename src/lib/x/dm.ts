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
