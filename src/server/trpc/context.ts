import "@/lib/server-runtime";
import { auth } from "@/lib/auth";
import {
  DEFAULT_X_DATA_PROVIDER,
  parseXDataProvider,
  type XDataProvider,
} from "@/lib/x";

export type Context = {
  userId?: string;
  session?: Awaited<ReturnType<typeof auth.api.getSession>>;
  xDataProvider: XDataProvider;
};

export async function createContext(opts: { headers: Headers }): Promise<Context> {
  const xDataProvider = parseXDataProvider(opts.headers.get("x-data-provider") ?? DEFAULT_X_DATA_PROVIDER);

  try {
    const session = await auth.api.getSession({ headers: opts.headers });
    return { userId: session?.user?.id, session, xDataProvider };
  } catch {
    return { xDataProvider };
  }
}
