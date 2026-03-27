import { db } from "../src/db";
import { contra } from "../src/db/schema";
import { readFileSync } from "fs";
import { join } from "path";

interface ContraRow {
  id: string;
  user_id: string | null;
  handle: string;
  name: string;
  bio: string | null;
  platform: string;
  followers: number | null;
  following: number | null;
  avatar_url: string | null;
  profile_url: string | null;
  url: string | null;
  site: string | null;
  linkedin_url: string | null;
  email: string | null;
  price: number | null;
  budget: string | null;
  tags: string[];
  deliverables: string[];
  relevancy: string | null;
  notes: string | null;
  source: string | null;
  reached_out: boolean;
  stage: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

async function main() {
  const filepath = join(import.meta.dir, "..", "data", "exports", "contra.json");
  const raw: ContraRow[] = JSON.parse(readFileSync(filepath, "utf-8"));

  console.log(`\n  Seeding ${raw.length} rows into contra table...\n`);

  let inserted = 0;
  // Batch insert in chunks of 50
  const chunkSize = 50;
  for (let i = 0; i < raw.length; i += chunkSize) {
    const chunk = raw.slice(i, i + chunkSize);
    const values = chunk.map((r) => ({
      id: r.id,
      userId: r.user_id,
      handle: r.handle,
      name: r.name,
      bio: r.bio ?? "",
      platform: r.platform ?? "twitter",
      followers: r.followers ?? 0,
      following: r.following,
      avatarUrl: r.avatar_url,
      profileUrl: r.profile_url,
      url: r.url,
      site: r.site,
      linkedinUrl: r.linkedin_url,
      email: r.email,
      price: r.price,
      budget: r.budget,
      tags: r.tags ?? [],
      deliverables: r.deliverables ?? [],
      relevancy: r.relevancy ?? "low",
      notes: r.notes,
      source: r.source,
      reachedOut: r.reached_out ?? false,
      stage: r.stage ?? "found",
      priority: r.priority ?? "P1",
      dmComfort: false,
      theAsk: "",
      inOutreach: false,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }));

    const result = await db
      .insert(contra)
      .values(values)
      .onConflictDoNothing({ target: [contra.handle, contra.platform] });

    inserted += chunk.length;
    console.log(`  Inserted ${inserted}/${raw.length}`);
  }

  console.log(`\n  Done. Seeded ${raw.length} rows.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
