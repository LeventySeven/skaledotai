import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import Turbopuffer from "@turbopuffer/turbopuffer";
import OpenAI from "openai";

// ── Config ───────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 50;

const NS_PREFIX = process.env.TURBOPUFFER_NAMESPACE_PREFIX ?? "skale";

// ── Types ────────────────────────────────────────────────────────────────────

type LeadRow = {
  id: string;
  userId: string;
  handle: string;
  name: string;
  bio: string;
  platform: string;
  deliverables: string[];
  tags: string[];
  relevancy: number;
  url: string | null;
  site: string | null;
  linkedinUrl: string | null;
  email: string | null;
  price: number | null;
  notes: string | null;
  sourceLeadId: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildNamespace(userId: string): string {
  const sanitized = userId.replace(/[^A-Za-z0-9\-_.]/g, "-").slice(0, 50);
  return `${NS_PREFIX}-${sanitized}`;
}

function buildSearchText(lead: LeadRow): string {
  return [
    lead.name,
    `@${lead.handle}`,
    lead.bio,
    lead.deliverables.join(", "),
    lead.tags.join(", "),
    lead.notes ?? "",
  ].filter(Boolean).join(" | ");
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Embedding ────────────────────────────────────────────────────────────────

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (openai) return openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  openai = new OpenAI({ apiKey });
  return openai;
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getOpenAI();
  const response = await ai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map((t) => t.slice(0, 8000)),
  });
  return response.data.map((d) => d.embedding);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Check env
  const tpApiKey = process.env.TURBOPUFFER_API_KEY?.trim();
  if (!tpApiKey) {
    console.error("\n  TURBOPUFFER_API_KEY is not set.\n");
    process.exit(1);
  }
  const tpRegion = process.env.TURBOPUFFER_REGION?.trim() || "gcp-us-central1";

  // 2. List JSON files
  const exportDir = join(import.meta.dir, "..", "data", "exports");
  let files: string[];
  try {
    files = readdirSync(exportDir)
      .filter((f) => f.endsWith(".json") && f.startsWith("internal-leads-"))
      .sort()
      .reverse();
  } catch {
    console.error(`\n  No export directory found at ${exportDir}`);
    console.error("  Run 'bun run scripts/view-internal-leads.ts' first to export data.\n");
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("\n  No JSON export files found.");
    console.error("  Run 'bun run scripts/view-internal-leads.ts' first to export data.\n");
    process.exit(1);
  }

  // 3. Pick file
  console.log("\n  Available export files:\n");
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
  console.log(`\n  Loading ${selectedFile}...`);

  // 4. Load data
  const raw = readFileSync(filepath, "utf-8");
  const leads: LeadRow[] = JSON.parse(raw);
  console.log(`  Found ${leads.length} leads.`);

  if (leads.length === 0) {
    console.log("\n  Nothing to sync.\n");
    process.exit(0);
  }

  // 5. Group by userId (one namespace per user)
  const byUser = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const existing = byUser.get(lead.userId) ?? [];
    existing.push(lead);
    byUser.set(lead.userId, existing);
  }

  console.log(`  ${byUser.size} user namespace(s) to sync.\n`);

  // 6. Init TurboPuffer
  const tpuf = new Turbopuffer({ apiKey: tpApiKey, region: tpRegion });

  let totalSynced = 0;
  let totalSkipped = 0;

  for (const [userId, userLeads] of byUser) {
    const namespace = buildNamespace(userId);
    const ns = tpuf.namespace(namespace);
    console.log(`  Namespace: ${namespace} (${userLeads.length} leads)`);

    // Process in batches
    for (let i = 0; i < userLeads.length; i += BATCH_SIZE) {
      const batch = userLeads.slice(i, i + BATCH_SIZE);
      const searchTexts = batch.map(buildSearchText);

      // Generate embeddings for the batch
      process.stdout.write(`    Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(userLeads.length / BATCH_SIZE)}...`);
      let vectors: number[][];
      try {
        vectors = await generateEmbeddings(searchTexts);
      } catch (err) {
        console.log(` failed (${err instanceof Error ? err.message : String(err)})`);
        console.log("    Using zero vectors as fallback.");
        vectors = batch.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0));
      }
      console.log(" done");

      // Build upsert rows — ID is the handle (unique per namespace)
      // upsert_rows with the same ID will overwrite the existing row
      const rows = batch.map((lead, j) => ({
        id: lead.handle.toLowerCase(),
        vector: vectors[j],
        name: lead.name,
        handle: lead.handle.toLowerCase(),
        bio: lead.bio.slice(0, 1000),
        search_text: searchTexts[j].slice(0, 2000),
        tags: lead.tags,
        deliverables: lead.deliverables,
        relevancy: String(lead.relevancy ?? ""),
        url: lead.url ?? "",
        site: lead.site ?? "",
        linkedin_url: lead.linkedinUrl ?? "",
        email: lead.email ?? "",
        price_cents: lead.price ?? 0,
        notes: lead.notes ?? "",
        platform: lead.platform,
        source_lead_id: lead.sourceLeadId ?? "",
        updated_at: lead.updatedAt,
      }));

      // Upsert to TurboPuffer — existing IDs are fully overwritten (not duplicated)
      process.stdout.write(`    Upserting ${rows.length} rows...`);
      try {
        await ns.write({
          upsert_rows: rows,
          distance_metric: "cosine_distance",
          schema: {
            search_text: { type: "string", full_text_search: true },
            bio: { type: "string", full_text_search: true },
            tags: { type: "[]string", full_text_search: true },
            deliverables: "[]string",
            name: "string",
            handle: "string",
            relevancy: "string",
            url: "string",
            site: "string",
            linkedin_url: "string",
            email: "string",
            price_cents: "int",
            notes: "string",
            platform: "string",
            source_lead_id: "string",
            updated_at: "datetime",
          },
        });
        totalSynced += rows.length;
        console.log(" done");
      } catch (err) {
        totalSkipped += rows.length;
        console.log(` failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log();
  }

  console.log(`  Sync complete: ${totalSynced} upserted, ${totalSkipped} failed.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
