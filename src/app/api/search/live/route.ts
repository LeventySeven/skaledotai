import { TRPCError } from "@trpc/server";
import { SearchLeadInputSchema, SearchRunStreamEventSchema } from "@/lib/validations/search";
import { searchAndAddLeads } from "@/server/services/search";
import { createContext } from "@/server/trpc/context";
import { toXProviderTrpcError } from "@/lib/x/error-handling";

export const runtime = "nodejs";
export const maxDuration = 300;

const encoder = new TextEncoder();

function jsonError(status: number, message: string): Response {
  return Response.json(
    {
      error: {
        message,
      },
    },
    { status },
  );
}

async function writeEvent(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  event: unknown,
): Promise<void> {
  const payload = SearchRunStreamEventSchema.parse(event);
  await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await createContext({ headers: req.headers });
  if (!ctx.userId) {
    return jsonError(401, "Unauthorized.");
  }

  if (ctx.xDataProvider !== "multiagent") {
    return jsonError(400, "Live search tracing is only available for the Multi-Agent provider.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const parsed = SearchLeadInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "Invalid live search payload.");
  }

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  void (async () => {
    try {
      const result = await searchAndAddLeads(ctx.userId!, parsed.data, ctx.xDataProvider, {
        onStep: (step) => writeEvent(writer, { type: "step", step }),
        onSnapshot: (snapshot) => writeEvent(writer, { type: "snapshot", snapshot }),
      });

      await writeEvent(writer, { type: "complete", result });
    } catch (error) {
      const normalized = error instanceof TRPCError ? error : toXProviderTrpcError(error);
      await writeEvent(writer, {
        type: "error",
        message: normalized.message,
      }).catch(() => undefined);
    } finally {
      await writer.close().catch(() => undefined);
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
