#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {validateStandingPromotionPrecondition} from "../../../standing/scripts/verify-promotion-precondition.mjs";
import {validateStandingRefreshReceipt} from "../../../standing/scripts/verify-standing-refresh.mjs";
import {publishBytesNoReplace} from "../src/atomic-no-replace.mjs";
import {sha256Hex} from "../src/canonical-json.mjs";
import {runCliIfMain} from "../src/cli-entry.mjs";
import {buildStandingCompatibilityMatrix} from "../src/compatibility-standing-matrix.mjs";

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  const allowed = new Set(["ledger", "denominator", "promotion-precondition", "standing-refresh", "output"]);
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
  const [ledger, denominator, promotionInput, refreshInput] = await Promise.all([
    readJson(args.ledger), readJson(args.denominator), readJson(args["promotion-precondition"]), readJson(args["standing-refresh"]),
  ]);
  const promotion = validateStandingPromotionPrecondition(promotionInput.value);
  const refresh = validateStandingRefreshReceipt(refreshInput.value);
  const value = buildStandingCompatibilityMatrix({ledger: ledger.value, denominator: denominator.value, promotion, promotionReference: promotionInput.reference, refresh, refreshReference: refreshInput.reference});
  const publication = await publishBytesNoReplace(args.output, `${JSON.stringify(value, null, 2)}\n`);
  if (publication !== "created") fail(`immutable standing matrix already exists: ${args.output}`);
  stdout(JSON.stringify({status: value.status, rows: value.rows.length, output: args.output}));
  return 0;
}
await runCliIfMain(import.meta.url, main, {onError: (error) => { console.error(error?.stack ?? String(error)); return 1; }});

