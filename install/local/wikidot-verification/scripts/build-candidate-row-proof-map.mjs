#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {publishBytesNoReplace} from "../src/atomic-no-replace.mjs";
import {sha256Hex} from "../src/canonical-json.mjs";
import {buildCandidateRowProofMap} from "../src/compatibility-candidate-row-map.mjs";
import {runCliIfMain} from "../src/cli-entry.mjs";

function fail(message) { throw new Error(message); }

function parseArgs(argv) {
  const allowed = new Set(["inventory", "ledger", "denominator", "aggregate", "output"]);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    const value = argv[i + 1];
    if (!allowed.has(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) fail(`unknown or duplicate option: ${flag}`);
    args[name] = path.resolve(value);
  }
  for (const name of allowed) if (!args[name]) fail(`--${name} is required`);
  return args;
}

async function readJson(filePath) {
  const bytes = await fs.readFile(filePath);
  return {value: JSON.parse(bytes), reference: {path: filePath, sha256: sha256Hex(bytes)}};
}

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  const [inventory, ledger, denominator, aggregate] = await Promise.all([
    readJson(args.inventory), readJson(args.ledger), readJson(args.denominator), readJson(args.aggregate),
  ]);
  const value = buildCandidateRowProofMap({inventory: inventory.value, ledger: ledger.value, denominator: denominator.value, aggregate: aggregate.value, aggregateReference: aggregate.reference});
  const publication = await publishBytesNoReplace(args.output, `${JSON.stringify(value, null, 2)}\n`);
  if (publication !== "created") fail(`immutable candidate row map already exists: ${args.output}`);
  stdout(JSON.stringify({status: value.status, rows: value.rows.length, output: args.output}));
  return 0;
}

await runCliIfMain(import.meta.url, main, {onError: (error) => { console.error(error?.stack ?? String(error)); return 1; }});

