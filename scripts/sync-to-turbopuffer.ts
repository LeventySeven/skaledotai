import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import Turbopuffer from "@turbopuffer/turbopuffer";
import OpenAI from "openai";

// ── Config ───────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 50;

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
  relevancy: number | string;
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
  followers?: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Schema (shared between warm and cold) ────────────────────────────────────

const TURBOPUFFER_SCHEMA = {
  search_text: { type: "string" as const, full_text_search: true as const },
  bio: { type: "string" as const, full_text_search: true as const },
  tags: { type: "[]string" as const, full_text_search: true as const },
  deliverables: "[]string" as const,
  name: "string" as const,
  handle: "string" as const,
  relevancy: "string" as const,
  url: "string" as const,
  site: "string" as const,
  linkedin_url: "string" as const,
  email: "string" as const,
  price_cents: "int" as const,
  notes: "string" as const,
  platform: "string" as const,
  source_lead_id: "string" as const,
  followers: "int" as const,
  updated_at: "datetime" as const,
};

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Check env
  const tpApiKey = process.env.TURBOPUFFER_API_KEY?.trim();
  if (!tpApiKey) {
    console.error("\n  TURBOPUFFER_API_KEY is not set.\n");
    process.exit(1);
  }
  const tpRegion = process.env.TURBOPUFFER_REGION?.trim() || "gcp-us-central1";

  // 2. Pick namespace
  console.log("\n  Select target namespace:\n");
  console.log("    [1] skale-leads-warm  (curated, high-quality leads)");
  console.log("    [2] skale-leads-cold  (bulk scraped leads)");
  console.log();

  const nsChoice = await prompt("  Namespace (1 or 2): ");
  const namespace = nsChoice === "2" ? "skale-leads-cold" : "skale-leads-warm";
  console.log(`\n  Target: ${namespace}`);

  // 3. List JSON files
  const exportDir = join(import.meta.dir, "..", "data", "exports");
  let files: string[];
  try {
    files = readdirSync(exportDir)
      .filter((f) => f.endsWith(".json") && !f.startsWith("."))
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

  // 4. Pick file
  console.log("\n  Available files:\n");
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

  // 5. Load data
  const raw = readFileSync(filepath, "utf-8");
  const leads: LeadRow[] = JSON.parse(raw);
  console.log(`  Found ${leads.length} leads.`);

  if (leads.length === 0) {
    console.log("\n  Nothing to sync.\n");
    process.exit(0);
  }

  // Dedupe by handle
  const deduped = new Map<string, LeadRow>();
  for (const lead of leads) {
    const key = lead.handle.toLowerCase();
    if (!deduped.has(key)) deduped.set(key, lead);
  }
  const uniqueLeads = [...deduped.values()];
  if (uniqueLeads.length < leads.length) {
    console.log(`  Deduped: ${leads.length} → ${uniqueLeads.length} unique handles.`);
  }

  console.log(`\n  Syncing to ${namespace}...\n`);

  // 6. Init TurboPuffer
  const tpuf = new Turbopuffer({ apiKey: tpApiKey, region: tpRegion });
  const ns = tpuf.namespace(namespace);

  let totalSynced = 0;
  let totalFailed = 0;

  // 7. Process in batches
  for (let i = 0; i < uniqueLeads.length; i += BATCH_SIZE) {
    const batch = uniqueLeads.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueLeads.length / BATCH_SIZE);
    const searchTexts = batch.map(buildSearchText);

    // Generate embeddings
    process.stdout.write(`  [${batchNum}/${totalBatches}] Embedding ${batch.length} leads...`);
    let vectors: number[][];
    try {
      vectors = await generateEmbeddings(searchTexts);
    } catch (err) {
      console.log(` failed (${err instanceof Error ? err.message : String(err)})`);
      vectors = batch.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0));
    }
    process.stdout.write(" upserting...");

    // Build rows
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
      followers: (lead as Record<string, unknown>).followers as number ?? 0,
      updated_at: lead.updatedAt,
    }));

    try {
      await ns.write({
        upsert_rows: rows,
        distance_metric: "cosine_distance",
        schema: TURBOPUFFER_SCHEMA,
      });
      totalSynced += rows.length;
      console.log(` done (${totalSynced}/${uniqueLeads.length})`);
    } catch (err) {
      totalFailed += rows.length;
      console.log(` failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n  Sync complete: ${totalSynced} upserted, ${totalFailed} failed.`);
  console.log(`  Namespace: ${namespace}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
