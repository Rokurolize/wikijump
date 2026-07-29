#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildListPagesRuntimeBudgetEnvelope,
} from "../src/listpages-runtime-budget-envelope.mjs";

const VERIFIER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_INVENTORY = path.join(
  VERIFIER_ROOT,
  "artifacts/listpages-campaign-inventory/corpus-listpages-invocations.jsonl",
);
const DEFAULT_OUTPUT = path.join(
  VERIFIER_ROOT,
  "artifacts/listpages-runtime-budget-envelope.json",
);

function parseArgs(argv) {
  const options = {
    inventory: DEFAULT_INVENTORY,
    output: DEFAULT_OUTPUT,
    check: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--inventory" || option === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`missing value for ${option}`);
      }
      options[option.slice(2)] = path.resolve(value);
      index += 1;
    } else if (option === "--check") {
      options.check = true;
    } else if (option === "--help" || option === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${option}`);
    }
  }
  return options;
}

async function inventoryGeneratedAt(inventoryPath) {
  const manifestPath = path.join(path.dirname(inventoryPath), "campaign-inventory.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (!manifest.generated_at) {
    throw new Error(`${manifestPath} does not contain generated_at`);
  }
  return manifest.generated_at;
}

export async function main(argv = process.argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: node scripts/build-listpages-runtime-budget-envelope.mjs [--inventory FILE] [--output FILE] [--check]",
    );
    return;
  }

  const inventoryText = await fs.readFile(options.inventory, "utf8");
  const records = inventoryText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const envelope = buildListPagesRuntimeBudgetEnvelope(records, {
    inventoryPath: path.relative(VERIFIER_ROOT, options.inventory),
    inventorySha256: createHash("sha256").update(inventoryText).digest("hex"),
    inventoryGeneratedAt: await inventoryGeneratedAt(options.inventory),
  });
  if (!envelope.implementation_bounds.all_measurements_fit) {
    throw new Error(
      `the refreshed corpus exceeds a ListPages runtime bound: ${JSON.stringify(envelope.implementation_bounds.checks)}`,
    );
  }
  const output = `${JSON.stringify(envelope, null, 2)}\n`;

  if (options.check) {
    const existing = await fs.readFile(options.output, "utf8");
    if (existing !== output) {
      throw new Error(
        `${path.relative(VERIFIER_ROOT, options.output)} is stale; regenerate it without --check`,
      );
    }
  } else {
    await fs.writeFile(options.output, output);
  }
  console.log(
    JSON.stringify({
      output: path.relative(VERIFIER_ROOT, options.output),
      invocation_count: records.length,
      all_measurements_fit: true,
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
