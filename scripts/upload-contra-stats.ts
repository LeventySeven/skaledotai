/**
 * Upload enriched stats from contra.json to Supabase.
 * Run AFTER enrich-contra-stats.ts and AFTER running migrations.
 *
 * Steps before running:
 *   1. bun run db:generate
 *   2. bun run db:migrate
 *   3. bun run db:push
 *   4. bun run scripts/upload-contra-stats.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contra } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

// Use transaction pooler to avoid session pool limits
const connStr = process.env.DATABASE_URL!.replace(":5432/", ":6543/");
const client = postgres(connStr, { prepare: false, max: 1 });
const db = drizzle(client);

type ContraRow = {
  id: string;
  handle: string;
  avg_views: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_reposts: number | null;
  score: number | null;
  [key: string]: unknown;
};

async function main() {
  const filepath = join(import.meta.dir, "..", "data", "exports", "contra.json");
  const rows: ContraRow[] = JSON.parse(readFileSync(filepath, "utf-8"));

  const withStats = rows.filter((r) => r.avg_views != null);
  console.log(`\n  ${withStats.length} rows with stats to upload (${rows.length} total)\n`);

  let updated = 0;
  for (let i = 0; i < withStats.length; i++) {
    const r = withStats[i];
    await db.update(contra).set({
      avgViews: r.avg_views,
      avgLikes: r.avg_likes,
      avgComments: r.avg_comments,
      avgReposts: r.avg_reposts,
      score: r.score,
      updatedAt: new Date(),
    }).where(eq(contra.id, r.id));

    updated++;
    if (updated % 50 === 0) console.log(`  ${updated}/${withStats.length}`);
  }

  console.log(`\n  Done. Updated ${updated} rows in Supabase.\n`);
  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
