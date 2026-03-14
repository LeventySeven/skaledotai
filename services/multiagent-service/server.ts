import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { TRPCError } from "@trpc/server";
import { SearchLeadInputSchema, SearchRunStreamEventSchema } from "../../src/lib/validations/search";
import { verifyMultiAgentServiceToken, isAllowedMultiAgentOrigin } from "../../src/lib/multiagent-service-auth";
import { searchAndAddLeads } from "../../src/server/services/search";
import { toXProviderTrpcError } from "../../src/lib/x/error-handling";

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
  writeJson(
    res,
    status,
    {
      error: {
        message,
      },
    },
    origin,
  );
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

function writeStreamEvent(res: ServerResponse, event: unknown): void {
  const payload = SearchRunStreamEventSchema.parse(event);
  res.write(`${JSON.stringify(payload)}\n`);
}

async function handleLiveSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = req.headers.origin ?? null;
  if (!isAllowedMultiAgentOrigin(origin)) {
    jsonError(res, 403, "Origin not allowed.", origin);
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    jsonError(res, 401, "Missing multi-agent service token.", origin);
    return;
  }

  let auth: ReturnType<typeof verifyMultiAgentServiceToken>;
  try {
    auth = verifyMultiAgentServiceToken(token);
  } catch (error) {
    jsonError(
      res,
      401,
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Invalid multi-agent service token.",
      origin,
    );
    return;
  }

  if (auth.origin && origin && auth.origin !== origin) {
    jsonError(res, 403, "Origin mismatch for multi-agent service token.", origin);
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    jsonError(res, 400, "Invalid JSON body.", origin);
    return;
  }

  const parsed = SearchLeadInputSchema.safeParse(body);
  if (!parsed.success) {
    jsonError(res, 400, "Invalid live search payload.", origin);
    return;
  }

  console.info("[multiagent-service][search-live] accepted", JSON.stringify({
    origin,
    userId: auth.sub,
    query: parsed.data.query,
    targetLeadCount: parsed.data.targetLeadCount ?? null,
  }));

  let cancelled = false;
  req.on("close", () => {
    cancelled = true;
    console.warn("[multiagent-service][search-live] cancelled", JSON.stringify({
      userId: auth.sub,
      query: parsed.data.query,
    }));
  });

  res.writeHead(200, {
    ...buildCorsHeaders(origin),
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  });

  const safeWriteEvent = (event: unknown): void => {
    if (cancelled || res.destroyed || res.writableEnded) return;
    writeStreamEvent(res, event);
  };

  try {
    const result = await searchAndAddLeads(auth.sub, parsed.data, "multiagent", {
      onStep: (step) => {
        safeWriteEvent({ type: "step", step });
      },
      onSnapshot: (snapshot) => {
        safeWriteEvent({ type: "snapshot", snapshot });
      },
    });

    console.info("[multiagent-service][search-live] complete", JSON.stringify({
      userId: auth.sub,
      query: parsed.data.query,
      leads: result.leads.length,
      projectId: result.project.id,
    }));
    safeWriteEvent({ type: "complete", result });
  } catch (error) {
    const normalized = error instanceof TRPCError ? error : toXProviderTrpcError(error);
    console.error("[multiagent-service][search-live] error", JSON.stringify({
      userId: auth.sub,
      query: parsed.data.query,
      message: normalized.message,
    }));
    safeWriteEvent({
      type: "error",
      message: normalized.message,
    });
  } finally {
    if (!cancelled && !res.writableEnded) {
      res.end();
    }
  }
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? null;
  const url = new URL(req.url ?? "/", "http://localhost");

  console.info("[multiagent-service][request]", JSON.stringify({
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
    writeJson(res, 200, { ok: true, service: "multiagent" }, origin);
    return;
  }

  if (req.method === "POST" && url.pathname === "/search/live") {
    await handleLiveSearch(req, res);
    return;
  }

  jsonError(res, 404, "Not found.", origin);
});

server.listen(port, () => {
  console.info(`[multiagent-service] listening on :${port}`);
});
