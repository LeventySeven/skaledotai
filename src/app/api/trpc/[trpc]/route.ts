import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/root";
import { createContext } from "@/server/trpc/context";

export const runtime = "nodejs";
export const maxDuration = 60;

function buildFatalTrpcErrorResponse(req: Request, error: unknown): Response {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/trpc\/?/, "") || url.pathname;
  const message = error instanceof Error && error.message.trim().length > 0
    ? error.message.trim()
    : "Unexpected server error.";

  console.error("[trpc-route][fatal]", JSON.stringify({
    path,
    message,
    name: error instanceof Error ? error.name : "UnknownError",
  }));

  return Response.json(
    {
      error: {
        message,
        code: -32603,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
          path,
        },
      },
    },
    { status: 500 },
  );
}

const handler = async (req: Request) => {
  try {
    return await fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router: appRouter,
      createContext: () => createContext({ headers: req.headers }),
      onError({ path, error, type }) {
        console.error("[trpc-route]", JSON.stringify({
          path,
          type,
          message: error.message,
          name: error.name,
        }));
      },
    });
  } catch (error) {
    return buildFatalTrpcErrorResponse(req, error);
  }
};

export { handler as GET, handler as POST };
