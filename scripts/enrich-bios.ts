import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";

// AgentQL imports — uses the same scraping infra as the main app
import { queryAgentQlBestEffort, normalizeProfilesFromPayload } from "../src/lib/x/agentql";

// ── Types ────────────────────────────────────────────────────────────────────

type LeadRow = {
  id: string;
  handle: string;
  name: string;
  bio: string;
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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. List JSON files from data/exports
  const exportDir = join(import.meta.dir, "..", "data", "exports");
  let files: string[];
  try {
    files = readdirSync(exportDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
  } catch {
    console.error(`\n  No export directory found at ${exportDir}`);
    console.error("  Run 'bun run scripts/view-internal-leads.ts' first.\n");
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("\n  No JSON files found in data/exports.\n");
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
  console.log(`\n  Loaded ${leads.length} leads from ${selectedFile}`);

  // 4. Find leads with empty bios
  const needsBio = leads.filter((l) => !l.bio || l.bio.trim().length === 0);
  const alreadyHasBio = leads.length - needsBio.length;

  console.log(`  ${alreadyHasBio} already have bios, ${needsBio.length} need enrichment.\n`);

  if (needsBio.length === 0) {
    console.log("  Nothing to enrich. All leads have bios.\n");
    process.exit(0);
  }

  // 5. Enrich bios via AgentQL
  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < needsBio.length; i++) {
    const lead = needsBio[i];
    const handle = lead.handle.replace(/^@/, "");
    const url = `https://x.com/${handle}`;

    process.stdout.write(`  [${i + 1}/${needsBio.length}] @${handle}...`);

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

      if (profile && profile.bio && profile.bio.trim().length > 0) {
        // Update the lead in the array (mutate in place)
        lead.bio = profile.bio;
        // Also update name if we got a better one
        if (profile.displayName && profile.displayName.trim().length > 0) {
          lead.name = profile.displayName;
        }
        enriched++;
        console.log(` "${profile.bio.slice(0, 60)}${profile.bio.length > 60 ? "..." : ""}"`);
      } else {
        console.log(" profile found but no bio");
        failed++;
      }
    } catch (err) {
      console.log(` error: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    // Rate limit: wait between requests to avoid getting blocked
    if (i < needsBio.length - 1) {
      await sleep(2000);
    }
  }

  console.log(`\n  Enrichment complete: ${enriched} bios found, ${failed} failed.`);

  // 6. Save updated JSON back to the same file
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
