import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const exportDir = join(import.meta.dir, "..", "data", "exports");

function main() {
  const fedicaFiles = readdirSync(exportDir)
    .filter((f) => f.startsWith("fedica-leads-") && f.endsWith(".json"))
    .sort();

  if (fedicaFiles.length === 0) {
    console.error("\n  No fedica-leads-*.json files found.\n");
    process.exit(1);
  }

  console.log("\n  Merging fedica files:\n");

  const allLeads: unknown[] = [];
  const seenHandles = new Set<string>();

  for (const file of fedicaFiles) {
    const filepath = join(exportDir, file);
    const leads: Array<{ handle: string; [k: string]: unknown }> = JSON.parse(readFileSync(filepath, "utf-8"));

    let added = 0;
    let dupes = 0;
    for (const lead of leads) {
      const handle = lead.handle?.toLowerCase();
      if (!handle || seenHandles.has(handle)) {
        dupes++;
        continue;
      }
      seenHandles.add(handle);
      allLeads.push(lead);
      added++;
    }

    console.log(`    ${file}: ${added} added, ${dupes} duplicates skipped`);
  }

  const outFile = "internal-cold-leads.json";
  const outPath = join(exportDir, outFile);
  writeFileSync(outPath, JSON.stringify(allLeads, null, 2));

  console.log(`\n  Merged ${allLeads.length} unique leads into ${outFile}\n`);
}

main();
