#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import denominatorContract from "../../../../docs/development/compatibility-denominator-contract.json" with {type: "json"};

import {runCliIfMain} from "../src/cli-entry.mjs";
import {sealJsonNoReplace, sha256File} from "../src/standing-browser-parity-util.mjs";

const FINAL_ZERO_CLASSES = Object.freeze(denominatorContract.vocabularies.final_zero_nonzero_classes);
const DEFERRED_KINDS = new Set(["framerail_xmlrpc_method", "wikidot_py_amc_module_shape"]);
const DEFERRED_PREFIXES = ["framerail-xmlrpc:", "wikidot-py-"];

function fail(message) {
  throw new Error(message);
}

function readJson(value, name) {
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
}

async function loadJson(filePath, name) {
  return readJson(await fs.readFile(filePath, "utf8"), name);
}

function isDeferred(row) {
  return DEFERRED_KINDS.has(row?.kind) ||
    DEFERRED_PREFIXES.some((prefix) => typeof row?.source_local_id === "string" && row.source_local_id.startsWith(prefix));
}

function finalZeroCounts(denominator) {
  const rows = denominator?.rows;
  if (!Array.isArray(rows) || rows.length === 0) fail("final-zero denominator has no current campaign rows");
  if (!Number.isSafeInteger(denominator.untyped_edge_count) || denominator.untyped_edge_count < 0) fail("final-zero denominator has no valid untyped edge count");
  if (!Array.isArray(denominator.charter_requirements)) fail("final-zero denominator has no charter requirements");
  for (const row of rows) if (isDeferred(row)) fail("current final-zero denominator contains deferred work");
  const count = (predicate, values = rows) => values.reduce((total, value) => total + (predicate(value) ? 1 : 0), 0);
  const ids = rows.map((row) => row?.surface_id);
  const counts = {
    complete_product_rows_open_or_unreconciled: count((row) => row?.closure !== "closed" || row?.issue !== "reconciled"),
    duplicate_or_ambiguous_canonical_identities: ids.length - new Set(ids).size + count((row) => row?.identity !== "canonical"),
    missing_independent_standards_or_spec_reviews: count((row) => row?.standards_review !== "pass" || row?.spec_review !== "pass"),
    missing_or_failing_candidate_proofs: count((row) => row?.candidate !== "pass"),
    missing_or_failing_standing_proofs: count((row) => row?.standing !== "pass"),
    missing_or_stale_source_provenance: count((row) => row?.source_provenance !== "present"),
    missing_public_surfaces: count((row) => row?.public_surface !== true),
    unimplemented_source_required_rows: count((row) => row?.source !== "implemented"),
    unknown_owners_or_untyped_edges: denominator.untyped_edge_count + count((row) => row?.owner !== "known"),
    unrepresented_charter_requirements: count((requirement) => requirement?.status !== "represented", denominator.charter_requirements) + count((row) => row?.charter !== "represented"),
    unresolved_wikidot_evidence_requirements: count((row) => row?.evidence !== "resolved"),
  };
  if (JSON.stringify(Object.keys(counts).sort()) !== JSON.stringify([...FINAL_ZERO_CLASSES].sort())) fail("final-zero count classes do not match the campaign contract");
  return counts;
}

async function inputReference(filePath) {
  const absolute = path.resolve(filePath);
  return {path: absolute, sha256: await sha256File(absolute)};
}

export function parseArgs(argv) {
  const names = new Set(["ledger", "denominator", "standing-matrix", "output"]);
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    const value = argv[index + 1];
    if (!names.has(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) fail(`unknown or duplicate option: ${flag}`);
    args[name] = path.resolve(value);
  }
  for (const name of names) if (!args[name]) fail(`--${name} is required`);
  return args;
}

export function usage() {
  return "Usage: verify-final-zero.mjs --ledger FILE --denominator FILE --standing-matrix FILE --output FILE";
}

export async function verifyFinalZero({ledger, denominator, standingMatrix}) {
  const denominatorValue = await loadJson(denominator, "final-zero denominator");
  await loadJson(ledger, "canonical compatibility ledger");
  const standing = await loadJson(standingMatrix, "standing compatibility output");
  if (typeof standing?.merge_commit !== "string" || standing.merge_commit === "") fail("standing compatibility output has no merge identity");
  const counts = finalZeroCounts(denominatorValue);
  const nonzero = Object.entries(counts).filter(([, value]) => value !== 0);
  if (nonzero.length > 0) fail(`final-zero check failed: ${nonzero.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  const inputs = {
    ledger: await inputReference(ledger),
    denominator: await inputReference(denominator),
    standing_matrix: await inputReference(standingMatrix),
  };
  return {schema: "wikijump.compatibility_final_zero_receipt.v1", status: "pass", merge_commit: standing.merge_commit, counts, inputs};
}

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout(usage());
    return 0;
  }
  const receipt = await verifyFinalZero({ledger: args.ledger, denominator: args.denominator, standingMatrix: args["standing-matrix"]});
  const sealed = await sealJsonNoReplace(args.output, receipt);
  stdout(JSON.stringify({schema: receipt.schema, status: receipt.status, output: sealed.path, sha256: sealed.sha256}));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    return 1;
  },
});
