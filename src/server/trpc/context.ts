import { auth } from "@/lib/auth";

export type Context = {
  userId?: string;
  session?: Awaited<ReturnType<typeof auth.api.getSession>>;
};

export async function createContext(opts: { headers: Headers }): Promise<Context> {
  try {
    const session = await auth.api.getSession({ headers: opts.headers });
    return { userId: session?.user?.id, session };
  } catch {
    return {};
  }
}
