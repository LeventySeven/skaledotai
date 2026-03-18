import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../../src/db";
import { dmBatches, dmJobs, leads } from "../../src/db/schema";
import { sendDirectMessage, type DmSendResult } from "../../src/lib/x/dm";
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
  const accessToken = await getXAccessToken(userId);
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

  await db
    .update(dmBatches)
    .set({ status: "processing" })
    .where(eq(dmBatches.id, batchId));

  const jobs = await db
    .select()
    .from(dmJobs)
    .where(and(eq(dmJobs.batchId, batchId), eq(dmJobs.status, "pending")))
    .orderBy(asc(dmJobs.createdAt));

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
    // Process without streaming (no HTTP response to write to)
    processBatch(batch.id, batch.userId, null).catch((error) => {
      console.error("[outreach-service][startup] resume failed", JSON.stringify({
        batchId: batch.id,
        message: error instanceof Error ? error.message : String(error),
      }));
    });
  }
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
});
