import "@/lib/server-runtime";
import { and, desc, eq } from "drizzle-orm";
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
    sourceId: row.sourceId ?? undefined,
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
  data: { title: string; subject: string; body: string; replyRate: string; sourceId?: string },
): Promise<OutreachTemplate> {
  const [row] = await db
    .insert(outreachTemplates)
    .values({ userId, ...data })
    .returning();

  return rowToTemplate(row);
}

export async function updateOutreachTemplate(
  userId: string,
  data: { id: string; title: string; subject: string; body: string; replyRate: string },
): Promise<OutreachTemplate> {
  const [row] = await db
    .update(outreachTemplates)
    .set({
      title: data.title,
      subject: data.subject,
      body: data.body,
      replyRate: data.replyRate,
    })
    .where(and(eq(outreachTemplates.id, data.id), eq(outreachTemplates.userId, userId)))
    .returning();

  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return rowToTemplate(row);
}

export async function deleteOutreachTemplate(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(outreachTemplates)
    .where(and(eq(outreachTemplates.id, id), eq(outreachTemplates.userId, userId)))
    .returning({ id: outreachTemplates.id });

  if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
}
