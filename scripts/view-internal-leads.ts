import { db } from "../src/db";
import { internalLeads } from "../src/db/schema";
import { desc } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

async function main() {
  const rows = await db
    .select()
    .from(internalLeads)
    .orderBy(desc(internalLeads.updatedAt))
    .limit(500);

  if (rows.length === 0) {
    console.log("\n  No internal leads found.\n");
    process.exit(0);
  }

  console.log(`\n  Internal Leads (${rows.length} rows)\n`);

  // Column definitions: [header, width, accessor]
  const cols: Array<[string, number, (r: typeof rows[0]) => string]> = [
    ["Handle", 18, (r) => r.handle],
    ["Name", 22, (r) => r.name],
    ["Bio", 40, (r) => r.bio.replace(/\n/g, " ")],
    ["Tags", 24, (r) => (r.tags ?? []).join(", ")],
    ["Rel", 4, (r) => String(r.relevancy)],
    ["Deliverables", 20, (r) => (r.deliverables ?? []).join(", ")],
    ["Email", 24, (r) => r.email ?? ""],
    ["Site", 24, (r) => r.site ?? ""],
    ["URL", 28, (r) => r.url ?? ""],
    ["Price", 7, (r) => r.price != null ? `$${(r.price / 100).toFixed(0)}` : ""],
    ["Platform", 8, (r) => r.platform],
    ["Synced", 20, (r) => r.lastSyncedAt ? r.lastSyncedAt.toISOString().slice(0, 19) : "—"],
    ["Updated", 20, (r) => r.updatedAt.toISOString().slice(0, 19)],
  ];

  function pad(str: string, width: number): string {
    if (str.length > width) return str.slice(0, width - 1) + "…";
    return str.padEnd(width);
  }

  const header = cols.map(([name, w]) => pad(name, w)).join(" │ ");
  const separator = cols.map(([, w]) => "─".repeat(w)).join("─┼─");
  console.log(`  ${header}`);
  console.log(`  ${separator}`);

  for (const row of rows) {
    const line = cols.map(([, w, fn]) => pad(fn(row), w)).join(" │ ");
    console.log(`  ${line}`);
  }

  console.log(`\n  ${rows.length} rows total`);

  // ── Save to JSON ──────────────────────────────────────────────────────────
  const exportDir = join(import.meta.dir, "..", "data", "exports");
  mkdirSync(exportDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `internal-leads-${timestamp}.json`;
  const filepath = join(exportDir, filename);

  const jsonData = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    handle: r.handle,
    name: r.name,
    bio: r.bio,
    platform: r.platform,
    deliverables: r.deliverables ?? [],
    tags: r.tags ?? [],
    relevancy: r.relevancy,
    url: r.url ?? null,
    site: r.site ?? null,
    linkedinUrl: r.linkedinUrl ?? null,
    email: r.email ?? null,
    price: r.price ?? null,
    notes: r.notes ?? null,
    sourceLeadId: r.sourceLeadId ?? null,
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  writeFileSync(filepath, JSON.stringify(jsonData, null, 2));
  console.log(`\n  Saved to ${filepath}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
