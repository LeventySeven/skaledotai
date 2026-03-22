import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { queryAgentQlBestEffort, normalizeProfilesFromPayload } from "../src/lib/x/agentql";

// ── Types ────────────────────────────────────────────────────────────────────

type LeadRow = {
  handle: string;
  name: string;
  followers?: number;
  [key: string]: unknown;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. List JSON files
  const exportDir = join(import.meta.dir, "..", "data", "exports");
  let files: string[];
  try {
    files = readdirSync(exportDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
  } catch {
    console.error(`\n  No export directory found at ${exportDir}\n`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("\n  No JSON files found.\n");
    process.exit(1);
  }

  // 2. Pick file
  console.log("\n  Available JSON files:\n");
  for (let i = 0; i < files.length; i++) {
    console.log(`    [${i + 1}] ${files[i]}`);
  }
  console.log();

  const choice = await prompt(`  Select file (1-${files.length}): `);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= files.length) {
    console.error("\n  Invalid selection.\n");
    process.exit(1);
  }

  const selectedFile = files[idx];
  const filepath = join(exportDir, selectedFile);

  // 3. Load data
  const raw = readFileSync(filepath, "utf-8");
  const leads: LeadRow[] = JSON.parse(raw);
  console.log(`\n  Loaded ${leads.length} leads from ${selectedFile}\n`);

  // 4. Go through each lead
  let enriched = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const handle = lead.handle.replace(/^@/, "");
    const url = `https://x.com/${handle}`;

    process.stdout.write(`  [${i + 1}/${leads.length}] @${handle}...`);

    try {
      const payload = await queryAgentQlBestEffort(url, "lookup");

      if (!payload) {
        console.log(" no data returned");
        failed++;
        continue;
      }

      const profiles = normalizeProfilesFromPayload(payload);
      const profile = profiles.find(
        (p) => p.username.toLowerCase() === handle.toLowerCase(),
      ) ?? profiles[0];

      if (profile && typeof profile.followersCount === "number") {
        lead.followers = profile.followersCount;
        enriched++;
        console.log(` ${formatCount(profile.followersCount)} followers`);
      } else {
        console.log(" profile found but no follower count");
        failed++;
      }
    } catch (err) {
      console.log(` error: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    // Rate limit between requests
    if (i < leads.length - 1) {
      await sleep(2000);
    }
  }

  console.log(`\n  Done: ${enriched} enriched, ${failed} failed, ${skipped} skipped.`);

  // 5. Save back
  if (enriched > 0) {
    writeFileSync(filepath, JSON.stringify(leads, null, 2));
    console.log(`  Updated ${filepath}\n`);
  } else {
    console.log("  No changes to save.\n");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
