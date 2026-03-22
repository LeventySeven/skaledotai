import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";

type LeadRow = {
  relevancy: number | string;
  [key: string]: unknown;
};

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const exportDir = join(import.meta.dir, "..", "data", "exports");
  let files: string[];
  try {
    files = readdirSync(exportDir).filter((f) => f.endsWith(".json")).sort().reverse();
  } catch {
    console.error(`\n  No export directory found at ${exportDir}\n`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("\n  No JSON files found.\n");
    process.exit(1);
  }

  console.log("\n  Available JSON files:\n");
  for (let i = 0; i < files.length; i++) {
    console.log(`    [${i + 1}] ${files[i]}`);
  }
  console.log();

  const fileChoice = await prompt(`  Select file (1-${files.length}): `);
  const idx = parseInt(fileChoice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= files.length) {
    console.error("\n  Invalid selection.\n");
    process.exit(1);
  }

  const selectedFile = files[idx];
  const filepath = join(exportDir, selectedFile);
  const leads: LeadRow[] = JSON.parse(readFileSync(filepath, "utf-8"));

  console.log(`\n  Loaded ${leads.length} leads from ${selectedFile}\n`);

  const value = await prompt('  Set all leads to [h]igh or [l]ow? (h/l): ');
  const relevancy = value.toLowerCase().startsWith("h") ? "high" : "low";

  for (const lead of leads) {
    lead.relevancy = relevancy;
  }

  writeFileSync(filepath, JSON.stringify(leads, null, 2));
  console.log(`\n  Set ${leads.length} leads to "${relevancy}". Saved to ${selectedFile}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
