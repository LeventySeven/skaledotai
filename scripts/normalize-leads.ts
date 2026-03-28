import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const exportDir = join(import.meta.dir, "..", "data", "exports");

// Tag mapping derived from filename
const FILENAME_TAG_MAP: Record<string, string[]> = {
  "designers": ["designers", "design", "creative"],
  "ceos": ["founders", "ceos", "operators"],
  "ctos": ["ctos", "tech people", "engineers"],
  "devs": ["developers", "dev", "engineers"],
  "engineers": ["engineers", "engineering", "tech people"],
  "founders": ["founders", "solopreneurs", "operators"],
  "researchers": ["researchers", "research"],
  "swe": ["developers", "engineers", "swe"],
};

function deriveTagsFromFilename(filename: string): string[] {
  for (const [key, tags] of Object.entries(FILENAME_TAG_MAP)) {
    if (filename.includes(key)) return tags;
  }
  return [];
}

// Canonical structure
type CanonicalLead = {
  id: string;
  userId: string;
  handle: string;
  name: string;
  bio: string;
  platform: string;
  deliverables: string[];
  tags: string[];
  relevancy: string;
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
  followers: number;
};

function normalize(raw: Record<string, unknown>, filenameTags: string[]): CanonicalLead {
  const now = new Date().toISOString();
  return {
    id: (raw.id as string) ?? randomUUID(),
    userId: (raw.userId as string) ?? "fedica-import",
    handle: String(raw.handle ?? "").replace(/^@/, ""),
    name: String(raw.name ?? ""),
    bio: String(raw.bio ?? ""),
    platform: String(raw.platform ?? "twitter"),
    deliverables: Array.isArray(raw.deliverables) ? raw.deliverables : [],
    tags: Array.isArray(raw.tags) && raw.tags.length > 0 ? raw.tags : filenameTags,
    relevancy: String(raw.relevancy ?? "high"),
    url: (raw.url as string) ?? null,
    site: (raw.site as string) ?? null,
    linkedinUrl: (raw.linkedinUrl as string) ?? null,
    email: (raw.email as string) ?? null,
    price: typeof raw.price === "number" ? raw.price : null,
    notes: (raw.notes as string) ?? null,
    sourceLeadId: (raw.sourceLeadId as string) ?? null,
    lastSyncedAt: (raw.lastSyncedAt as string) ?? null,
    createdAt: (raw.createdAt as string) ?? now,
    updatedAt: (raw.updatedAt as string) ?? now,
    followers: typeof raw.followers === "number" ? raw.followers : 0,
  };
}

function main() {
  const files = readdirSync(exportDir).filter((f) => f.endsWith(".json") && f !== ".DS_Store");

  // Skip the canonical file — it's already in the right format
  const canonicalFile = "internal-leads-2026-03-21T23-33-15.json";

  let totalNormalized = 0;

  for (const file of files) {
    if (file === canonicalFile) {
      console.log(`  [skip] ${file} (already canonical)`);
      continue;
    }

    const filepath = join(exportDir, file);
    const raw: unknown[] = JSON.parse(readFileSync(filepath, "utf-8"));

    if (!Array.isArray(raw) || raw.length === 0) {
      console.log(`  [skip] ${file} (empty or not an array)`);
      continue;
    }

    // Check if already normalized (has all canonical fields)
    const first = raw[0] as Record<string, unknown>;
    const alreadyNormalized = "tags" in first && "relevancy" in first && "platform" in first && "deliverables" in first;

    if (alreadyNormalized && Array.isArray(first.tags) && first.tags.length > 0) {
      console.log(`  [skip] ${file} (already has tags + structure)`);
      continue;
    }

    const filenameTags = deriveTagsFromFilename(file);
    const normalized = raw.map((item) => normalize(item as Record<string, unknown>, filenameTags));

    writeFileSync(filepath, JSON.stringify(normalized, null, 2));
    totalNormalized += normalized.length;
    console.log(`  [done] ${file}: ${normalized.length} leads normalized, tags: [${filenameTags.join(", ")}]`);
  }

  console.log(`\n  Total: ${totalNormalized} leads normalized across all files.\n`);
}

main();
