#!/usr/bin/env node

import process from "node:process";

import { runCliIfMain } from "../src/cli-entry.mjs";
import { runCandidateCampaign } from "../src/candidate-campaign-runner.mjs";

function usage() {
  return `Usage: node install/local/wikidot-verification/scripts/run-candidate-campaign.mjs \\
  --candidate-identity FILE \\
  --input-receipt FILE \\
  --output-dir DIR \\
  [--parallel-read-only N]\n`;
}

function parseArgs(argv) {
  const args = { parallelReadOnly: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value\n${usage()}`);
    if (flag === "--candidate-identity") args.candidateIdentityPath = value;
    else if (flag === "--input-receipt") args.inputReceiptPath = value;
    else if (flag === "--output-dir") args.outputDir = value;
    else if (flag === "--parallel-read-only") {
      if (!/^\d+$/u.test(value)) throw new Error(`--parallel-read-only must be an integer\n${usage()}`);
      args.parallelReadOnly = Number(value);
    } else throw new Error(`unknown argument: ${flag}\n${usage()}`);
  }
  for (const field of ["candidateIdentityPath", "inputReceiptPath", "outputDir"]) {
    if (!args[field]) throw new Error(`missing required argument\n${usage()}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  const result = await runCandidateCampaign(args);
  process.stdout.write(`${JSON.stringify({
    schema: result.schema,
    status: result.status,
    campaign_run_id: result.campaign_run_id,
    case_set_count: result.completed.length,
    elapsed_ms: result.elapsed_ms,
    receipt_sha256: result.receipt_sha256,
  })}\n`);
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error?.message ?? String(error));
    return 1;
  },
});
