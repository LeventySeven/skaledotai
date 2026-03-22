import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import OpenAI from "openai";

// ── Types ────────────────────────────────────────────────────────────────────

type LeadRow = {
  handle: string;
  name: string;
  bio: string;
  tags: string[];
  [key: string]: unknown;
};

// ── Config ───────────────────────────────────────────────────────────────────

const MODEL = "gpt-5";
const BATCH_SIZE = 20;

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

// ── Tag extraction via OpenAI ────────────────────────────────────────────────

async function extractTagsBatch(
  openai: OpenAI,
  leads: Array<{ handle: string; name: string; bio: string }>,
): Promise<Map<string, string[]>> {
  const profiles = leads.map((l) => ({
    handle: l.handle,
    name: l.name,
    bio: l.bio,
  }));

  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a lead categorization assistant. For each profile, read their bio and assign niche tags.

Tags should be broad niche categories like: designers, founders, developers, tech people, engineers, researchers, investors, web3, fintech, marketers, creators, writers, product people, data scientists, ai/ml, devrel, gaming, ecommerce, saas, crypto, defi, nft, music, film, photography, illustrators, animators, consultants, coaches, educators, health, biotech, climate, hardware, robotics, cybersecurity, open source, mobile, frontend, backend, fullstack, devops, cloud, no-code, growth, sales, recruiters, hr, legal, real estate, media, journalists, podcasters, youtubers, streamers, athletes, fashion, food, travel, art, agency owners, freelancers, solopreneurs, operators.

Rules:
- Read the bio carefully. Assign 1-5 tags that best describe the person's niche/role/industry.
- Tags should be lowercase, plural where natural (designers not designer).
- Only use tags that genuinely match the bio. Don't guess if the bio is too vague.
- If bio is empty or meaningless, return an empty array.
- Return JSON: { "results": { "handle1": ["tag1", "tag2"], "handle2": ["tag1"] } }`,
      },
      {
        role: "user",
        content: JSON.stringify(profiles),
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { results?: Record<string, string[]> };
  const results = new Map<string, string[]>();

  if (parsed.results) {
    for (const [handle, tags] of Object.entries(parsed.results)) {
      if (Array.isArray(tags)) {
        results.set(handle.toLowerCase(), tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean));
      }
    }
  }

  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Check OpenAI key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("\n  OPENAI_API_KEY is not set.\n");
    process.exit(1);
  }
  const openai = new OpenAI({ apiKey });

  // 2. List JSON files
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

  // 3. Pick file
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

  // 4. Load data
  const raw = readFileSync(filepath, "utf-8");
  const leads: LeadRow[] = JSON.parse(raw);
  console.log(`\n  Loaded ${leads.length} leads from ${selectedFile}`);

  // 5. Filter leads that have a bio to tag
  const taggable = leads.filter((l) => l.bio && l.bio.trim().length > 0);
  const noBio = leads.length - taggable.length;

  console.log(`  ${taggable.length} leads have bios to tag, ${noBio} skipped (no bio).\n`);

  if (taggable.length === 0) {
    console.log("  Nothing to tag.\n");
    process.exit(0);
  }

  // 6. Process in batches
  let totalTagged = 0;
  let totalBatches = Math.ceil(taggable.length / BATCH_SIZE);

  // Build a lookup map: handle -> lead (for updating in place)
  const leadByHandle = new Map<string, LeadRow>();
  for (const lead of leads) {
    leadByHandle.set(lead.handle.toLowerCase(), lead);
  }

  for (let i = 0; i < taggable.length; i += BATCH_SIZE) {
    const batch = taggable.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} leads)...`);

    try {
      const tagResults = await extractTagsBatch(openai, batch);

      let batchTagged = 0;
      for (const [handle, tags] of tagResults) {
        const lead = leadByHandle.get(handle.toLowerCase());
        if (lead && tags.length > 0) {
          // Merge new tags with existing, dedupe
          const existing = new Set((lead.tags ?? []).map((t) => t.toLowerCase()));
          for (const tag of tags) {
            existing.add(tag);
          }
          lead.tags = [...existing];
          batchTagged++;
        }
      }

      totalTagged += batchTagged;
      console.log(` ${batchTagged} tagged`);

      // Show a sample
      const sample = [...tagResults.entries()].slice(0, 3);
      for (const [handle, tags] of sample) {
        console.log(`    @${handle}: [${tags.join("] [")}]`);
      }
    } catch (err) {
      console.log(` error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n  Tagging complete: ${totalTagged} leads tagged.`);

  // 7. Save back
  if (totalTagged > 0) {
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
