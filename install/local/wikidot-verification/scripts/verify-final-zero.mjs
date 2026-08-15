#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import compatibilityContract from "../../../../docs/development/compatibility-denominator-contract.json" with {type: "json"};

import {runCliIfMain} from "../src/cli-entry.mjs";
import {sealJsonNoReplace, sha256File} from "../src/standing-browser-parity-util.mjs";

const FINAL_ZERO_CLASSES = Object.freeze(compatibilityContract.vocabularies.final_zero_nonzero_classes);
const LEDGER_SCHEMA = "wikijump.compatibility_ledger.v1";
const LEDGER_ARRAYS = ["source_manifests", "raw_source_records", "source_local_identities", "surface_assignments", "relationships", "rows"];
const DEFERRED_EXCLUSION_RULES = Object.freeze({
  catalog_feature: {count: 15, owner: "wikijump.xmlrpc-api", prefix: "catalog-feature:api-"},
  framerail_xmlrpc_method: {count: 17, owner: "wikijump.xmlrpc-api", prefix: "framerail-xmlrpc:"},
  wikidot_py_amc_module_shape: {count: 22, owner: "external.wikidot-py", prefix: "wikidot-py-amc-module:"},
});
const DEFERRED_EXCLUSION_BY_OWNER = Object.freeze({
  "external.wikidot-py": 22,
  "wikijump.xmlrpc-api": 32,
});

function fail(message) {
  throw new Error(message);
}

async function loadJson(filePath, name) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
}

function exactCounts(actual, expected, name) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual) ||
      JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort()) ||
      Object.keys(expected).some((key) => actual[key] !== expected[key])) {
    fail(`deferred exclusions audit has invalid ${name}`);
  }
}

function validateDeferredExclusions(ledger) {
  const audit = ledger.deferred_exclusions;
  if (!audit || typeof audit !== "object" || Array.isArray(audit) || !Array.isArray(audit.records) ||
      audit.count !== 54 || audit.records.length !== 54) {
    fail("canonical compatibility ledger has no exact deferred exclusions audit");
  }
  exactCounts(
    audit.by_kind,
    Object.fromEntries(Object.entries(DEFERRED_EXCLUSION_RULES).map(([kind, rule]) => [kind, rule.count])),
    "kind counts",
  );
  exactCounts(audit.by_owner, DEFERRED_EXCLUSION_BY_OWNER, "owner counts");
  const identities = new Set();
  const actualByKind = {};
  const actualByOwner = {};
  for (const record of audit.records) {
    const rule = DEFERRED_EXCLUSION_RULES[record?.kind];
    if (!rule || record.deferred_owner !== rule.owner ||
        typeof record.source_local_id !== "string" || record.source_local_id === "" ||
        !record.source_local_id.startsWith(rule.prefix) || identities.has(record.source_local_id)) {
      fail("deferred exclusions audit has invalid or duplicate identity");
    }
    identities.add(record.source_local_id);
    actualByKind[record.kind] = (actualByKind[record.kind] ?? 0) + 1;
    actualByOwner[record.deferred_owner] = (actualByOwner[record.deferred_owner] ?? 0) + 1;
  }
  exactCounts(actualByKind, Object.fromEntries(Object.entries(DEFERRED_EXCLUSION_RULES).map(([kind, rule]) => [kind, rule.count])), "record kind counts");
  exactCounts(actualByOwner, DEFERRED_EXCLUSION_BY_OWNER, "record owner counts");
  const currentIds = new Set(ledger.source_local_identities.map(({source_local_id: sourceLocalId}) => sourceLocalId));
  const leaked = [...identities].find((sourceLocalId) => currentIds.has(sourceLocalId));
  if (leaked) fail(`canonical compatibility ledger contains deferred work in current source_local_identities: ${leaked}`);
}

function currentLedger(ledger) {
  if (ledger?.schema !== LEDGER_SCHEMA || !ledger.counts || !ledger.inputs ||
      LEDGER_ARRAYS.some((name) => !Array.isArray(ledger[name])) || ledger.rows.length === 0) {
    fail("canonical compatibility ledger is not a sealed current-scope ledger");
  }
  validateDeferredExclusions(ledger);
  return ledger;
}

function finalZeroCounts(ledger) {
  const rows = ledger.rows;
  const count = (predicate) => rows.reduce((total, row) => total + (predicate(row) ? 1 : 0), 0);
  const ids = rows.map((row) => row?.surface_id);
  const counts = {
    complete_product_rows_open_or_unreconciled: count((row) => row?.closure?.state !== "closed" || row?.issues?.state !== "present" || row?.blockers?.state !== "none"),
    duplicate_or_ambiguous_canonical_identities: ids.length - new Set(ids).size,
    missing_independent_standards_or_spec_reviews: count((row) => row?.tests?.state !== "present"),
    missing_or_failing_candidate_proofs: count((row) => row?.candidate?.state !== "pass"),
    missing_or_failing_standing_proofs: count((row) => row?.standing?.state !== "pass"),
    missing_or_stale_source_provenance: count((row) => row?.source?.state !== "present"),
    missing_public_surfaces: count((row) => typeof row?.surface_id !== "string" || row.surface_id === ""),
    unimplemented_source_required_rows: count((row) => row?.source?.state !== "present"),
    unknown_owners_or_untyped_edges: count((row) => row?.owners?.state !== "present"),
    unrepresented_charter_requirements: count((row) => row?.issues?.state !== "present"),
    unresolved_wikidot_evidence_requirements: count((row) => row?.evidence?.state !== "present"),
  };
  if (JSON.stringify(Object.keys(counts).sort()) !== JSON.stringify([...FINAL_ZERO_CLASSES].sort())) fail("final-zero count classes do not match the campaign contract");
  return counts;
}

async function inputReference(filePath) {
  const absolute = path.resolve(filePath);
  return {path: absolute, sha256: await sha256File(absolute)};
}

export function parseArgs(argv) {
  const names = new Set(["ledger", "standing-matrix", "output"]);
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
  return "Usage: verify-final-zero.mjs --ledger FILE --standing-matrix FILE --output FILE";
}

export async function verifyFinalZero({ledger, standingMatrix}) {
  const ledgerValue = currentLedger(await loadJson(ledger, "canonical compatibility ledger"));
  const standing = await loadJson(standingMatrix, "standing compatibility output");
  if (typeof standing?.merge_commit !== "string" || standing.merge_commit === "") fail("standing compatibility output has no merge identity");
  const counts = finalZeroCounts(ledgerValue);
  const nonzero = Object.entries(counts).filter(([, value]) => value !== 0);
  if (nonzero.length > 0) fail(`final-zero check failed: ${nonzero.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  const inputs = {
    ledger: await inputReference(ledger),
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
  const receipt = await verifyFinalZero({ledger: args.ledger, standingMatrix: args["standing-matrix"]});
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
