import "server-only";
import { createHash, randomBytes } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function listApiKeys(userId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsed: apiKeys.lastUsed,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function createApiKey(userId: string, name: string) {
  const raw = `sk_${randomBytes(24).toString("hex")}`;
  const prefix = raw.slice(0, 10);
  const keyHash = hashKey(raw);

  await db.insert(apiKeys).values({ userId, name, keyHash, prefix });

  return { key: raw, prefix, name };
}

export async function deleteApiKey(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });

  if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
}
