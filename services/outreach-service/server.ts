import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../../src/db";
import { dmBatches, dmJobs, leads } from "../../src/db/schema";
import { sendDirectMessage, type DmSendResult } from "../../src/lib/x/dm";
import { lookupUsersByUsernames } from "../../src/lib/x/api";
import { getXAccessToken } from "../../src/server/services/x-auth";
import { verifyOutreachServiceToken, isAllowedOutreachOrigin } from "../../src/lib/outreach-service-auth";

const port = Number(process.env.PORT ?? 10_001);

/** Minimum delay between DMs to stay within 15/15min rate limit (~60s) */
const DM_SEND_DELAY_MS = 62_000;
/** Shorter delay when sending first few (within burst window) */
const DM_BURST_DELAY_MS = 3_000;
/** Max DMs in burst before switching to sustained rate */
const DM_BURST_LIMIT = 12;

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function buildCorsHeaders(origin: string | null | undefined): Record<string, string> {
  const allowOrigin = origin && isAllowedOutreachOrigin(origin) ? origin : "*";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function writeJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  origin: string | null | undefined,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...buildCorsHeaders(origin),
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

function jsonError(
  res: ServerResponse,
  status: number,
  message: string,
  origin: string | null | undefined,
): void {
  writeJson(res, status, { error: { message } }, origin);
}

function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body.length > 0 ? JSON.parse(body) : {};
}

function writeStreamEvent(res: ServerResponse | null, event: unknown): void {
  if (!res || res.destroyed || res.writableEnded) return;
  res.write(`${JSON.stringify(event)}\n`);
}

// ── DM processing ────────────────────────────────────────────────────────────

async function processBatch(
  batchId: string,
  userId: string,
  res: ServerResponse | null,
): Promise<void> {
  // Atomic claim: only transition pending → processing. If another instance
  // already claimed this batch, the update returns 0 rows and we bail out.
  const claimed = await db
    .update(dmBatches)
    .set({ status: "processing" })
    .where(and(eq(dmBatches.id, batchId), eq(dmBatches.status, "pending")))
    .returning({ id: dmBatches.id });

  if (claimed.length === 0) {
    writeStreamEvent(res, {
      type: "error",
      batchId,
      message: "Batch is already being processed or has completed.",
    });
    return;
  }

  const accessToken = await getXAccessToken(userId);
  console.info("[outreach-service][auth]", JSON.stringify({
    batchId,
    userId,
    hasToken: !!accessToken,
  }));
  if (!accessToken) {
    await db
      .update(dmBatches)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(dmBatches.id, batchId));

    await db
      .update(dmJobs)
      .set({ status: "failed", error: "X account not connected or token expired." })
      .where(and(eq(dmJobs.batchId, batchId), eq(dmJobs.status, "pending")));

    writeStreamEvent(res, {
      type: "error",
      batchId,
      message: "X account not connected or token expired.",
    });
    return;
  }

  const jobs = await db
    .select()
    .from(dmJobs)
    .where(and(eq(dmJobs.batchId, batchId), eq(dmJobs.status, "pending")))
    .orderBy(asc(dmJobs.createdAt));

  // Resolve non-numeric xUserIds (handles) to numeric IDs
  const needsResolution = jobs.filter((j) => !/^\d{1,19}$/.test(j.xUserId));
  if (needsResolution.length > 0) {
    const usernames = needsResolution.map((j) => j.xUserId.replace(/^@/, ""));
    try {
      const profiles = await lookupUsersByUsernames(usernames);
      const handleToId = new Map(profiles.map((p) => [p.username.toLowerCase(), p.xUserId]));

      for (const job of needsResolution) {
        const cleanHandle = job.xUserId.replace(/^@/, "").toLowerCase();
        const numericId = handleToId.get(cleanHandle);
        if (numericId) {
          job.xUserId = numericId;
          // Also fix the lead's xUserId in the DB for future sends
          await db
            .update(leads)
            .set({ xUserId: numericId })
            .where(eq(leads.id, job.leadId))
            .catch(() => undefined);
          await db
            .update(dmJobs)
            .set({ xUserId: numericId })
            .where(eq(dmJobs.id, job.id));
        }
      }

      console.info("[outreach-service][resolve]", JSON.stringify({
        batchId,
        needed: needsResolution.length,
        resolved: handleToId.size,
      }));
    } catch (error) {
      console.warn("[outreach-service][resolve] lookup failed, continuing with raw values", JSON.stringify({
        batchId,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  let sentCount = 0;
  let failedCount = 0;
  let consecutiveSent = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];

    // Mark as sending
    await db
      .update(dmJobs)
      .set({ status: "sending", attemptCount: job.attemptCount + 1 })
      .where(eq(dmJobs.id, job.id));

    const result: DmSendResult = await sendDirectMessage(
      job.xUserId,
      job.message,
      accessToken,
    );

    console.info("[outreach-service][dm/result]", JSON.stringify({
      batchId,
      jobId: job.id,
      leadId: job.leadId,
      xUserId: job.xUserId,
      success: result.success,
      error: result.error ?? null,
      errorCode: result.errorCode ?? null,
    }));

    if (result.success) {
      sentCount++;
      consecutiveSent++;

      await db
        .update(dmJobs)
        .set({
          status: "sent",
          dmEventId: result.dmEventId ?? null,
          dmConversationId: result.dmConversationId ?? null,
          sentAt: new Date(),
        })
        .where(eq(dmJobs.id, job.id));

      // Update lead stage to "messaged" and store the sent message
      await db
        .update(leads)
        .set({
          stage: "messaged",
          theAsk: job.message,
          inOutreach: true,
          updatedAt: new Date(),
        })
        .where(and(eq(leads.id, job.leadId), eq(leads.userId, userId)))
        .catch((err) => {
          console.warn("[outreach-service] failed to update lead stage", JSON.stringify({
            leadId: job.leadId,
            error: err instanceof Error ? err.message : String(err),
          }));
        });

      writeStreamEvent(res, {
        type: "progress",
        batchId,
        jobId: job.id,
        leadId: job.leadId,
        status: "sent",
        index: i,
        total: jobs.length,
        sent: sentCount,
        failed: failedCount,
      });
    } else {
      failedCount++;

      // 429 — rate limited: queue remaining jobs for retry
      if (result.errorCode === 429) {
        await db
          .update(dmJobs)
          .set({
            status: "queued",
            error: result.error ?? "Rate limited",
            retryable: true,
          })
          .where(eq(dmJobs.id, job.id));

        // Queue all remaining jobs
        for (let j = i + 1; j < jobs.length; j++) {
          await db
            .update(dmJobs)
            .set({
              status: "queued",
              error: "Rate limit reached — queued for retry.",
              retryable: true,
            })
            .where(eq(dmJobs.id, jobs[j].id));
        }

        writeStreamEvent(res, {
          type: "rate_limited",
          batchId,
          jobId: job.id,
          leadId: job.leadId,
          index: i,
          total: jobs.length,
          sent: sentCount,
          failed: failedCount,
          queued: jobs.length - i,
          message: result.error,
        });
        break;
      }

      // 401 — auth expired: fail all remaining
      if (result.errorCode === 401) {
        await db
          .update(dmJobs)
          .set({
            status: "failed",
            error: result.error ?? "Auth expired",
            retryable: false,
          })
          .where(eq(dmJobs.id, job.id));

        for (let j = i + 1; j < jobs.length; j++) {
          await db
            .update(dmJobs)
            .set({
              status: "failed",
              error: "Skipped — X authentication expired.",
              retryable: false,
            })
            .where(eq(dmJobs.id, jobs[j].id));
          failedCount++;
        }

        writeStreamEvent(res, {
          type: "auth_expired",
          batchId,
          jobId: job.id,
          leadId: job.leadId,
          index: i,
          total: jobs.length,
          sent: sentCount,
          failed: failedCount,
          message: result.error,
        });
        break;
      }

      // 403 or other non-retryable — mark this job failed, continue
      await db
        .update(dmJobs)
        .set({
          status: "failed",
          error: result.error ?? "Send failed",
          retryable: result.retryable ?? false,
        })
        .where(eq(dmJobs.id, job.id));

      writeStreamEvent(res, {
        type: "progress",
        batchId,
        jobId: job.id,
        leadId: job.leadId,
        status: "failed",
        error: result.error,
        retryable: result.retryable,
        index: i,
        total: jobs.length,
        sent: sentCount,
        failed: failedCount,
      });

      // 403 doesn't consume rate limit — don't delay
      continue;
    }

    // Rate-limit-aware delay between successful sends
    if (i < jobs.length - 1) {
      const delay = consecutiveSent <= DM_BURST_LIMIT ? DM_BURST_DELAY_MS : DM_SEND_DELAY_MS;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Update batch summary
  await db
    .update(dmBatches)
    .set({
      status: failedCount === jobs.length ? "failed" : "completed",
      sentCount,
      failedCount,
      completedAt: new Date(),
    })
    .where(eq(dmBatches.id, batchId));

  writeStreamEvent(res, {
    type: "complete",
    batchId,
    sent: sentCount,
    failed: failedCount,
    total: jobs.length,
  });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleSendDms(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = req.headers.origin ?? null;

  const token = extractBearerToken(req);
  if (!token) {
    jsonError(res, 401, "Missing outreach service token.", origin);
    return;
  }

  let auth: ReturnType<typeof verifyOutreachServiceToken>;
  try {
    auth = verifyOutreachServiceToken(token);
  } catch (error) {
    jsonError(
      res,
      401,
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Invalid outreach service token.",
      origin,
    );
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    jsonError(res, 400, "Invalid JSON body.", origin);
    return;
  }

  const parsed = parseSendDmsBody(body);
  if (!parsed.success) {
    jsonError(res, 400, parsed.error, origin);
    return;
  }

  const { batchId } = parsed;

  console.info("[outreach-service][dm/send] accepted", JSON.stringify({
    origin,
    userId: auth.sub,
    batchId,
  }));

  // Stream NDJSON progress
  res.writeHead(200, {
    ...buildCorsHeaders(origin),
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  });

  // Keep sending even if client disconnects — DMs are irreversible
  req.on("close", () => {
    console.info("[outreach-service][dm/send] client disconnected, continuing batch", JSON.stringify({
      userId: auth.sub,
      batchId,
    }));
  });

  try {
    await processBatch(batchId, auth.sub, res);
  } catch (error) {
    console.error("[outreach-service][dm/send] error", JSON.stringify({
      userId: auth.sub,
      batchId,
      message: error instanceof Error ? error.message : String(error),
    }));
    writeStreamEvent(res, {
      type: "error",
      batchId,
      message: error instanceof Error ? error.message : "Internal error processing DM batch.",
    });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

function parseSendDmsBody(body: unknown): { success: true; batchId: string } | { success: false; error: string } {
  if (!body || typeof body !== "object") {
    return { success: false, error: "Request body must be a JSON object." };
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj.batchId !== "string" || obj.batchId.length === 0) {
    return { success: false, error: "Missing required field: batchId" };
  }
  return { success: true, batchId: obj.batchId };
}

async function handleBatchStatus(req: IncomingMessage, res: ServerResponse, batchId: string): Promise<void> {
  const origin = req.headers.origin ?? null;

  const token = extractBearerToken(req);
  if (!token) {
    jsonError(res, 401, "Missing outreach service token.", origin);
    return;
  }

  try {
    verifyOutreachServiceToken(token);
  } catch (error) {
    jsonError(
      res,
      401,
      error instanceof Error ? error.message : "Invalid outreach service token.",
      origin,
    );
    return;
  }

  const [batch] = await db
    .select()
    .from(dmBatches)
    .where(eq(dmBatches.id, batchId))
    .limit(1);

  if (!batch) {
    jsonError(res, 404, "Batch not found.", origin);
    return;
  }

  const jobs = await db
    .select({
      id: dmJobs.id,
      leadId: dmJobs.leadId,
      xUserId: dmJobs.xUserId,
      status: dmJobs.status,
      error: dmJobs.error,
      retryable: dmJobs.retryable,
      sentAt: dmJobs.sentAt,
    })
    .from(dmJobs)
    .where(eq(dmJobs.batchId, batchId))
    .orderBy(asc(dmJobs.createdAt));

  writeJson(res, 200, { batch, jobs }, origin);
}

// ── Resume incomplete batches on startup ─────────────────────────────────────

async function resumeIncompleteBatches(): Promise<void> {
  const incomplete = await db
    .select()
    .from(dmBatches)
    .where(eq(dmBatches.status, "processing"));

  if (incomplete.length === 0) return;

  console.info(`[outreach-service][startup] resuming ${incomplete.length} incomplete batch(es)`);

  for (const batch of incomplete) {
    console.info("[outreach-service][startup] resuming batch", JSON.stringify({
      batchId: batch.id,
      userId: batch.userId,
    }));
    processBatch(batch.id, batch.userId, null).catch((error) => {
      console.error("[outreach-service][startup] resume failed", JSON.stringify({
        batchId: batch.id,
        message: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

// ── Retry queued jobs (rate-limited) ─────────────────────────────────────────

/** Check interval: 16 minutes (just over one rate limit window) */
const RETRY_INTERVAL_MS = 16 * 60 * 1000;
/** Max retry attempts per job before giving up */
const MAX_RETRY_ATTEMPTS = 3;

async function retryQueuedJobs(): Promise<void> {
  // Find all queued jobs, grouped by batch
  const queuedJobs = await db
    .select({ batchId: dmJobs.batchId, userId: dmJobs.userId, attemptCount: dmJobs.attemptCount })
    .from(dmJobs)
    .where(eq(dmJobs.status, "queued"));

  if (queuedJobs.length === 0) return;

  // Deduplicate by batch
  const batches = new Map<string, { userId: string; maxAttempts: number }>();
  for (const job of queuedJobs) {
    const existing = batches.get(job.batchId);
    if (!existing || job.attemptCount > existing.maxAttempts) {
      batches.set(job.batchId, { userId: job.userId, maxAttempts: job.attemptCount });
    }
  }

  for (const [batchId, { userId, maxAttempts }] of batches) {
    // Max retry cap — mark as permanently failed
    if (maxAttempts >= MAX_RETRY_ATTEMPTS) {
      console.warn("[outreach-service][retry] max attempts reached, marking failed", JSON.stringify({
        batchId,
        attempts: maxAttempts,
      }));
      await db
        .update(dmJobs)
        .set({ status: "failed", error: `Gave up after ${maxAttempts} attempts (rate limited).`, retryable: false })
        .where(and(eq(dmJobs.batchId, batchId), eq(dmJobs.status, "queued")));
      await db
        .update(dmBatches)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(dmBatches.id, batchId));
      continue;
    }

    console.info("[outreach-service][retry] resuming queued jobs", JSON.stringify({
      batchId,
      userId,
      attempt: maxAttempts + 1,
    }));

    // Reset queued jobs back to pending so processBatch picks them up
    await db
      .update(dmJobs)
      .set({ status: "pending", error: null })
      .where(and(eq(dmJobs.batchId, batchId), eq(dmJobs.status, "queued")));

    // Reset batch status to pending (processBatch will claim it atomically)
    await db
      .update(dmBatches)
      .set({ status: "pending", completedAt: null })
      .where(eq(dmBatches.id, batchId));

    processBatch(batchId, userId, null).catch((error) => {
      console.error("[outreach-service][retry] failed", JSON.stringify({
        batchId,
        message: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

function startRetryLoop(): void {
  setInterval(() => {
    retryQueuedJobs().catch((error) => {
      console.error("[outreach-service][retry-loop] error", JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
      }));
    });
  }, RETRY_INTERVAL_MS);
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? null;
  const url = new URL(req.url ?? "/", "http://localhost");

  console.info("[outreach-service][request]", JSON.stringify({
    method: req.method,
    pathname: url.pathname,
    origin,
  }));

  if (req.method === "OPTIONS") {
    res.writeHead(204, buildCorsHeaders(origin));
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/healthz") {
    writeJson(res, 200, { ok: true, service: "outreach" }, origin);
    return;
  }

  if (req.method === "POST" && url.pathname === "/dm/send") {
    await handleSendDms(req, res);
    return;
  }

  // GET /dm/status/:batchId
  const statusMatch = url.pathname.match(/^\/dm\/status\/([a-f0-9-]{36})$/);
  if (req.method === "GET" && statusMatch) {
    await handleBatchStatus(req, res, statusMatch[1]);
    return;
  }

  jsonError(res, 404, "Not found.", origin);
});

server.listen(port, async () => {
  console.info(`[outreach-service] listening on :${port}`);
  await resumeIncompleteBatches();
  startRetryLoop();
});
