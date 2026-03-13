import { TRPCError } from "@trpc/server";
import { SEARCH_TARGET } from "../../src/lib/constants";
import {
  SearchLeadInputSchema,
  SearchRunStreamEventSchema,
  type SearchRunStreamSnapshot,
} from "../../src/lib/validations/search";
import { verifyMultiAgentServiceToken, isAllowedMultiAgentOrigin } from "../../src/lib/multiagent-service-auth";
import { searchAndAddLeads } from "../../src/server/services/search";
import { toXProviderTrpcError } from "../../src/lib/x/error-handling";

const encoder = new TextEncoder();
const port = Number(process.env.PORT ?? 10_000);

function buildCorsHeaders(origin: string | null | undefined): Record<string, string> {
  const allowOrigin = origin && isAllowedMultiAgentOrigin(origin) ? origin : "*";

  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function jsonError(status: number, message: string, origin: string | null | undefined): Response {
  return Response.json(
    {
      error: {
        message,
      },
    },
    {
      status,
      headers: buildCorsHeaders(origin),
    },
  );
}

async function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: unknown,
): Promise<void> {
  const payload = SearchRunStreamEventSchema.parse(event);
  controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function createBootstrapSnapshot(input: {
  targetLeadCount?: number;
  maxAttempts?: number;
}): SearchRunStreamSnapshot {
  const targetLeadCount = input.targetLeadCount ?? SEARCH_TARGET;
  const maxAttempts = input.maxAttempts ?? 1;

  return {
    queries: 0,
    urls: 0,
    scraped: 0,
    candidates: 0,
    targetLeadCount,
    goalCount: targetLeadCount,
    attempt: 1,
    maxAttempts,
    graphNodes: [],
  };
}

async function handleLiveSearch(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (!isAllowedMultiAgentOrigin(origin)) {
    return jsonError(403, "Origin not allowed.", origin);
  }

  const token = extractBearerToken(req);
  if (!token) {
    return jsonError(401, "Missing multi-agent service token.", origin);
  }

  let auth: ReturnType<typeof verifyMultiAgentServiceToken>;
  try {
    auth = verifyMultiAgentServiceToken(token);
  } catch (error) {
    return jsonError(
      401,
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Invalid multi-agent service token.",
      origin,
    );
  }

  if (auth.origin && origin && auth.origin !== origin) {
    return jsonError(403, "Origin mismatch for multi-agent service token.", origin);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body.", origin);
  }

  const parsed = SearchLeadInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "Invalid live search payload.", origin);
  }

  console.info("[multiagent-service][search-live] accepted", JSON.stringify({
    origin,
    userId: auth.sub,
    query: parsed.data.query,
    targetLeadCount: parsed.data.targetLeadCount ?? SEARCH_TARGET,
  }));
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      let latestSnapshot = createBootstrapSnapshot({
        targetLeadCount: parsed.data.targetLeadCount,
      });
      let closed = false;

      const safeWriteEvent = async (event: unknown): Promise<void> => {
        if (closed) return;
        try {
          await writeEvent(controller, event);
        } catch (error) {
          closed = true;
          console.error("[multiagent-service][stream-write] error", JSON.stringify({
            userId: auth.sub,
            query: parsed.data.query,
            message: error instanceof Error ? error.message : String(error),
          }));
          controller.error(error);
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const heartbeat = setInterval(() => {
        void safeWriteEvent({ type: "snapshot", snapshot: latestSnapshot });
      }, 10_000);

      void (async () => {
        try {
          await safeWriteEvent({ type: "snapshot", snapshot: latestSnapshot });

          const result = await searchAndAddLeads(auth.sub, parsed.data, "multiagent", {
            onStep: (step) => safeWriteEvent({ type: "step", step }),
            onSnapshot: (snapshot) => {
              latestSnapshot = snapshot;
              return safeWriteEvent({ type: "snapshot", snapshot });
            },
          });

          console.info("[multiagent-service][search-live] complete", JSON.stringify({
            userId: auth.sub,
            query: parsed.data.query,
            leads: result.leads.length,
            projectId: result.project.id,
          }));
          await safeWriteEvent({ type: "complete", result });
          closeStream();
        } catch (error) {
          const normalized = error instanceof TRPCError ? error : toXProviderTrpcError(error);
          console.error("[multiagent-service][search-live] error", JSON.stringify({
            userId: auth.sub,
            query: parsed.data.query,
            message: normalized.message,
          }));
          await safeWriteEvent({
            type: "error",
            message: normalized.message,
          });
          closeStream();
        } finally {
          clearInterval(heartbeat);
        }
      })().catch((error) => {
        clearInterval(heartbeat);
        console.error("[multiagent-service][search-live][unhandled]", JSON.stringify({
          userId: auth.sub,
          query: parsed.data.query,
          message: error instanceof Error ? error.message : String(error),
        }));
        if (!closed) {
          controller.error(error);
        }
      });
    },
    cancel(reason) {
      console.warn("[multiagent-service][search-live] cancelled", JSON.stringify({
        userId: auth.sub,
        query: parsed.data.query,
        reason: reason instanceof Error ? reason.message : String(reason),
      }));
    },
  });

  return new Response(readable, {
    headers: {
      ...buildCorsHeaders(origin),
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

export async function multiAgentServiceFetch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  console.info("[multiagent-service][request]", JSON.stringify({
    method: req.method,
    pathname: url.pathname,
    origin,
  }));

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(origin),
    });
  }

  if (req.method === "GET" && url.pathname === "/healthz") {
    return Response.json(
      {
        ok: true,
        service: "multiagent",
      },
      {
        headers: buildCorsHeaders(origin),
      },
    );
  }

  if (req.method === "POST" && url.pathname === "/search/live") {
    return handleLiveSearch(req);
  }

  return jsonError(404, "Not found.", origin);
}

export function startMultiAgentServiceServer() {
  return Bun.serve({
    port,
    fetch: multiAgentServiceFetch,
  });
}

if (import.meta.main) {
  startMultiAgentServiceServer();
  console.info(`[multiagent-service] listening on :${port}`);
}
