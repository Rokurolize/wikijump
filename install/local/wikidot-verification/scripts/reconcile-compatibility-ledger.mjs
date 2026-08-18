#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {publishBytesNoReplace} from "../src/atomic-no-replace.mjs";
import {sha256Hex} from "../src/canonical-json.mjs";
import {runCliIfMain} from "../src/cli-entry.mjs";
import {reconcileCompatibilityLedger} from "../src/compatibility-ledger-reconciliation.mjs";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const allowed = new Set(["inventory", "ledger", "candidate-map", "standing-matrix", "output"]);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    const value = argv[i + 1];
    if (!allowed.has(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) fail(`unknown or duplicate option: ${flag}`);
    args[name] = path.resolve(value);
  }
  for (const name of ["inventory", "ledger", "output"]) if (!args[name]) fail(`--${name} is required`);
  return args;
}

async function readJson(filePath) {
  const bytes = await fs.readFile(filePath);
  return {value: JSON.parse(bytes), reference: {path: filePath, sha256: sha256Hex(bytes)}};
}

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  const [inventory, ledger, candidate, standing] = await Promise.all([
    readJson(args.inventory),
    readJson(args.ledger),
    args["candidate-map"] ? readJson(args["candidate-map"]) : null,
    args["standing-matrix"] ? readJson(args["standing-matrix"]) : null,
  ]);
  const reconciled = reconcileCompatibilityLedger({
    inventory: inventory.value,
    inventoryReference: inventory.reference,
    ledger: ledger.value,
    candidateMap: candidate?.value ?? null,
    candidateMapReference: candidate?.reference ?? null,
    standingMatrix: standing?.value ?? null,
    standingMatrixReference: standing?.reference ?? null,
  });
  const result = await publishBytesNoReplace(args.output, `${JSON.stringify(reconciled, null, 2)}\n`);
  if (result !== "created") fail(`immutable reconciled ledger output already exists: ${args.output}`);
  stdout(JSON.stringify({status: "sealed", rows: reconciled.rows.length, output: args.output}));
  return 0;
}

await runCliIfMain(import.meta.url, main, {onError: (error) => { console.error(error?.stack ?? String(error)); return 1; }});

