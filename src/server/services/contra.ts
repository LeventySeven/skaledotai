import { db } from "@/db";
import { contra } from "@/db/schema";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { ContraLead, ContraPatch, ListContraInput } from "@/lib/validations/contra";

type ContraRow = typeof contra.$inferSelect;

function rowToContraLead(row: ContraRow): ContraLead {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    bio: row.bio,
    platform: row.platform as ContraLead["platform"],
    followers: row.followers ?? 0,
    following: row.following ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
    profileUrl: row.profileUrl ?? undefined,
    url: row.url ?? undefined,
    site: row.site ?? undefined,
    linkedinUrl: row.linkedinUrl ?? undefined,
    email: row.email ?? undefined,
    price: row.price ?? undefined,
    budget: row.budget ? Number(row.budget) : undefined,
    tags: row.tags ?? [],
    deliverables: row.deliverables ?? [],
    relevancy: row.relevancy ?? undefined,
    notes: row.notes ?? undefined,
    source: row.source ?? undefined,
    reachedOut: row.reachedOut,
    stage: row.stage as ContraLead["stage"],
    priority: row.priority as ContraLead["priority"],
    dmComfort: row.dmComfort,
    theAsk: row.theAsk,
    inOutreach: row.inOutreach,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listContra(input: ListContraInput): Promise<{ leads: ContraLead[]; total: number }> {
  const conditions = [];

  if (input.search) {
    conditions.push(
      or(
        ilike(contra.name, `%${input.search}%`),
        ilike(contra.handle, `%${input.search}%`),
        ilike(contra.bio, `%${input.search}%`),
      ),
    );
  }

  if (input.stage !== "all") {
    conditions.push(eq(contra.stage, input.stage));
  }

  if (input.relevancy !== "all") {
    conditions.push(eq(contra.relevancy, input.relevancy));
  }

  if (input.source !== "all") {
    conditions.push(eq(contra.source, input.source));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderMap = {
    "followers-desc": desc(contra.followers),
    "followers-asc": asc(contra.followers),
    "name-asc": asc(contra.name),
    "price-desc": desc(contra.price),
  };

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(contra)
      .where(where)
      .orderBy(orderMap[input.sort])
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ count: count() }).from(contra).where(where),
  ]);

  return {
    leads: rows.map(rowToContraLead),
    total: totalRow?.count ?? 0,
  };
}

export async function updateContra(id: string, patch: ContraPatch): Promise<ContraLead> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if ("stage" in patch) updates.stage = patch.stage;
  if ("priority" in patch) updates.priority = patch.priority;
  if ("dmComfort" in patch) updates.dmComfort = patch.dmComfort;
  if ("theAsk" in patch) updates.theAsk = patch.theAsk;
  if ("inOutreach" in patch) updates.inOutreach = patch.inOutreach;
  if ("email" in patch) updates.email = patch.email;
  if ("reachedOut" in patch) updates.reachedOut = patch.reachedOut;
  if ("notes" in patch) updates.notes = patch.notes;
  if ("price" in patch) updates.price = patch.price;

  const [row] = await db.update(contra).set(updates).where(eq(contra.id, id)).returning();
  if (!row) throw new Error("Contra lead not found");
  return rowToContraLead(row);
}

export async function updateContraBulk(ids: string[], patch: ContraPatch): Promise<number> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if ("stage" in patch) updates.stage = patch.stage;
  if ("priority" in patch) updates.priority = patch.priority;
  if ("inOutreach" in patch) updates.inOutreach = patch.inOutreach;
  if ("reachedOut" in patch) updates.reachedOut = patch.reachedOut;

  const result = await db
    .update(contra)
    .set(updates)
    .where(sql`${contra.id} = ANY(${ids})`);
  return ids.length;
}

export async function exportContraForDocs(): Promise<ContraLead[]> {
  const rows = await db
    .select()
    .from(contra)
    .orderBy(desc(contra.followers));
  return rows.map(rowToContraLead);
}
