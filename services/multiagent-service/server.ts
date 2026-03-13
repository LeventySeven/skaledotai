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
  writer: WritableStreamDefaultWriter<Uint8Array>,
  event: unknown,
): Promise<void> {
  const payload = SearchRunStreamEventSchema.parse(event);
  await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
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

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  let writeQueue = Promise.resolve();
  let latestSnapshot = createBootstrapSnapshot({
    targetLeadCount: parsed.data.targetLeadCount,
  });

  console.info("[multiagent-service][search-live] accepted", JSON.stringify({
    origin,
    userId: auth.sub,
    query: parsed.data.query,
    targetLeadCount: parsed.data.targetLeadCount ?? SEARCH_TARGET,
  }));

  function enqueueEvent(event: unknown): Promise<void> {
    writeQueue = writeQueue
      .catch(() => undefined)
      .then(() => writeEvent(writer, event));
    return writeQueue;
  }

  void (async () => {
    const heartbeat = setInterval(() => {
      void enqueueEvent({ type: "snapshot", snapshot: latestSnapshot });
    }, 10_000);

    try {
      await enqueueEvent({ type: "snapshot", snapshot: latestSnapshot });

      const result = await searchAndAddLeads(auth.sub, parsed.data, "multiagent", {
        onStep: (step) => enqueueEvent({ type: "step", step }),
        onSnapshot: (snapshot) => {
          latestSnapshot = snapshot;
          return enqueueEvent({ type: "snapshot", snapshot });
        },
      });

      console.info("[multiagent-service][search-live] complete", JSON.stringify({
        userId: auth.sub,
        query: parsed.data.query,
        leads: result.leads.length,
        projectId: result.project.id,
      }));
      await enqueueEvent({ type: "complete", result });
    } catch (error) {
      const normalized = error instanceof TRPCError ? error : toXProviderTrpcError(error);
      console.error("[multiagent-service][search-live] error", JSON.stringify({
        userId: auth.sub,
        query: parsed.data.query,
        message: normalized.message,
      }));
      await enqueueEvent({
        type: "error",
        message: normalized.message,
      }).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      await writeQueue.catch(() => undefined);
      await writer.close().catch(() => undefined);
    }
  })();

  return new Response(stream.readable, {
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
