import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/root";
import { createContext } from "@/server/trpc/context";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = async (req: Request) =>
  fetchRequestHandler({
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

export { handler as GET, handler as POST };
