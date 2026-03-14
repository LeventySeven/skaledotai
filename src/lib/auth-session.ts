import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/utils";

export type AppSession = Awaited<ReturnType<typeof auth.api.getSession>>;

function logSessionFailure(error: unknown): void {
  console.error("[auth] failed to resolve session", getErrorMessage(error));
}

export async function getSessionFromHeaders(requestHeaders: Headers): Promise<AppSession | null> {
  try {
    return await auth.api.getSession({ headers: requestHeaders });
  } catch (error) {
    logSessionFailure(error);
    return null;
  }
}

export async function getRequestSession(): Promise<AppSession | null> {
  return getSessionFromHeaders(await headers());
}
