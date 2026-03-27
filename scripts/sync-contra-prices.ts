import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contra } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

// Use transaction pooler (port 6543) to avoid session pool limits
const connStr = process.env.DATABASE_URL!.replace(":5432/", ":6543/");
const client = postgres(connStr, { prepare: false, max: 1 });
const db = drizzle(client);

async function main() {
  const filepath = join(import.meta.dir, "..", "data", "exports", "contra.json");
  const rows: { id: string; handle: string; price: number | null }[] = JSON.parse(
    readFileSync(filepath, "utf-8"),
  );

  console.log(`\n  Syncing ${rows.length} rows...\n`);

  // Process sequentially in small batches to stay within a single connection
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await db.update(contra).set({ price: r.price, updatedAt: new Date() }).where(eq(contra.id, r.id));
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${rows.length}`);
  }

  console.log(`\n  Done. ${rows.length} rows synced.\n`);
  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
