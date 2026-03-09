import "server-only";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { outreachTemplates } from "@/db/schema";
import type { OutreachTemplate } from "@/lib/validations/outreach";

function rowToTemplate(row: typeof outreachTemplates.$inferSelect): OutreachTemplate {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    body: row.body,
    replyRate: row.replyRate,
    generated: true,
  };
}

export async function listOutreachTemplates(userId: string): Promise<OutreachTemplate[]> {
  const rows = await db
    .select()
    .from(outreachTemplates)
    .where(eq(outreachTemplates.userId, userId))
    .orderBy(desc(outreachTemplates.createdAt));

  return rows.map(rowToTemplate);
}

export async function saveOutreachTemplate(
  userId: string,
  data: { title: string; subject: string; body: string; replyRate: string },
): Promise<OutreachTemplate> {
  const [row] = await db
    .insert(outreachTemplates)
    .values({ userId, ...data })
    .returning();

  return rowToTemplate(row);
}

export async function deleteOutreachTemplate(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(outreachTemplates)
    .where(eq(outreachTemplates.id, id))
    .returning({ id: outreachTemplates.id });

  if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
}
