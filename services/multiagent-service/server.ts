import { TRPCError } from "@trpc/server";
import { SearchLeadInputSchema, SearchRunStreamEventSchema } from "../../src/lib/validations/search";
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

  function enqueueEvent(event: unknown): Promise<void> {
    writeQueue = writeQueue
      .catch(() => undefined)
      .then(() => writeEvent(writer, event));
    return writeQueue;
  }

  void (async () => {
    try {
      const result = await searchAndAddLeads(auth.sub, parsed.data, "multiagent", {
        onStep: (step) => enqueueEvent({ type: "step", step }),
        onSnapshot: (snapshot) => enqueueEvent({ type: "snapshot", snapshot }),
      });

      await enqueueEvent({ type: "complete", result });
    } catch (error) {
      const normalized = error instanceof TRPCError ? error : toXProviderTrpcError(error);
      await enqueueEvent({
        type: "error",
        message: normalized.message,
      }).catch(() => undefined);
    } finally {
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
