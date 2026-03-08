import "server-only";
import { createCallerFactory } from "@/server/trpc/trpc";
import { headers } from "next/headers";
import { appRouter } from "@/server/trpc/root";
import { createContext } from "@/server/trpc/context";

const createCaller = createCallerFactory(appRouter);

export async function serverTrpc() {
  return createCaller(await createContext({ headers: await headers() }));
}
