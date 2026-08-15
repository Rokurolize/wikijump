#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import compatibilityContract from "../../../../docs/development/compatibility-denominator-contract.json" with {type: "json"};

import {sha256Hex} from "../src/canonical-json.mjs";
import {runCliIfMain} from "../src/cli-entry.mjs";
import {sealJsonNoReplace} from "../src/standing-browser-parity-util.mjs";

const FINAL_ZERO_CLASSES = Object.freeze(compatibilityContract.vocabularies.final_zero_nonzero_classes);
const LEDGER_SCHEMA = "wikijump.compatibility_ledger.v1";
const LEDGER_FIELDS = ["schema", "counts", "inputs", "source_manifests", "raw_source_records", "source_local_identities", "surface_assignments", "relationships", "deferred_exclusions", "rows"];
const LEDGER_COUNT_FIELDS = ["raw_records", "public_inventory_records", "canonical_surfaces", "input_alias_edges", "deduplication_relationships"];
const LEDGER_INPUT_FIELDS = ["inventory", "wikijump", "ftml"];
const ROW_FIELDS = ["surface_id", "actor", "input", "observable_interval", "result", "source", "evidence", "tests", "owners", "issues", "blockers", "candidate", "standing", "closure"];
const SERVICES = ["deepwell", "framerail", "wws"];
const HEX40 = /^[0-9a-f]{40}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
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

async function readJsonInput(filePath, name) {
  const absolute = path.resolve(filePath);
  const bytes = await fs.readFile(absolute);
  try {
    return {
      value: JSON.parse(bytes.toString("utf8")),
      reference: {path: absolute, sha256: sha256Hex(bytes)},
    };
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

function exactKeys(value, expected, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail(`${name} has missing or unknown fields`);
  }
}

function digestReference(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      typeof value.path !== "string" || !path.isAbsolute(value.path) || !HEX64.test(value.sha256 ?? "")) {
    fail(`${name} is not immutable path+digest evidence`);
  }
}

async function readArtifactReference(value, name) {
  digestReference(value, name);
  const stat = await fs.lstat(value.path).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) fail(`${name} is not a regular file`);
  const bytes = await fs.readFile(value.path);
  if (sha256Hex(bytes) !== value.sha256) fail(`${name} identity moved`);
  try {
    return {value: JSON.parse(bytes.toString("utf8")), reference: {path: value.path, sha256: value.sha256}};
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
}

function revisionIdentity(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !HEX40.test(value.commit ?? "") || !HEX40.test(value.tree ?? "")) {
    fail(`${name} is not a sealed source identity`);
  }
}

function completeLedger(ledger) {
  exactKeys(ledger, LEDGER_FIELDS, "canonical compatibility ledger");
  exactKeys(ledger.counts, LEDGER_COUNT_FIELDS, "ledger counts");
  if (Object.values(ledger.counts).some((value) => !Number.isSafeInteger(value) || value < 0) ||
      ledger.counts.raw_records !== ledger.raw_source_records.length ||
      ledger.counts.canonical_surfaces !== ledger.surface_assignments.length ||
      ledger.counts.canonical_surfaces !== ledger.rows.length ||
      ledger.counts.input_alias_edges < ledger.counts.deduplication_relationships) {
    fail("canonical compatibility ledger counts are incomplete");
  }
  exactKeys(ledger.inputs, LEDGER_INPUT_FIELDS, "ledger inputs");
  digestReference(ledger.inputs.inventory, "ledger inventory");
  revisionIdentity(ledger.inputs.wikijump, "ledger Wikijump input");
  revisionIdentity(ledger.inputs.ftml, "ledger FTML input");
  for (const name of ["source_manifests", "raw_source_records", "source_local_identities", "surface_assignments", "rows"]) {
    if (!Array.isArray(ledger[name]) || ledger[name].length === 0) fail(`canonical compatibility ledger has no ${name}`);
  }
  if (!Array.isArray(ledger.relationships)) fail("canonical compatibility ledger has no relationships");
  for (const row of ledger.rows) {
    exactKeys(row, ROW_FIELDS, "compatibility ledger row");
    if (typeof row.surface_id !== "string" || row.surface_id === "") fail("compatibility ledger row has no canonical identity");
    for (const field of ["actor", "input", "observable_interval", "result", "source", "evidence", "tests", "owners", "issues", "blockers", "candidate", "standing", "closure"]) {
      if (row[field] === null || typeof row[field] !== "object" || Array.isArray(row[field])) fail(`compatibility ledger row has no ${field}`);
    }
    for (const field of ["candidate", "standing"]) {
      if (!Array.isArray(row[field].artifacts) || typeof row[field].state !== "string") fail(`compatibility ledger row has incomplete ${field} proof`);
    }
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
  if (ledger?.schema !== LEDGER_SCHEMA) {
    fail("canonical compatibility ledger is not a sealed current-scope ledger");
  }
  completeLedger(ledger);
  validateDeferredExclusions(ledger);
  return ledger;
}

function requireImmutableImages(value, name, services = SERVICES, idsOnly = false) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...services].sort())) {
    fail(`${name} has an incomplete image set`);
  }
  for (const service of services) {
    const image = value[service];
    if (idsOnly ? !/^sha256:[0-9a-f]{64}$/u.test(image ?? "") : image?.reference !== image?.id || !/^sha256:[0-9a-f]{64}$/u.test(image?.id ?? "")) {
      fail(`${name}.${service} is not bound to an immutable image ID`);
    }
  }
}

function requireHashFields(value, fields, name) {
  for (const field of fields) {
    if (!HEX64.test(field.split(".").reduce((current, key) => current?.[key], value) ?? "")) {
      fail(`${name} is missing ${field}`);
    }
  }
}

async function standingPromotion(value, ledger) {
  if (value?.schema_version !== 1 || value.kind !== "standing-promotion" || value.status !== "pass" ||
      typeof value.run_id !== "string" || value.run_id === "" ||
      !HEX40.test(value.wikijump_sha ?? "") || !HEX40.test(value.wikijump_tree ?? "") ||
      !HEX40.test(value.ftml_sha ?? "") || !HEX64.test(value.dependency_lock_sha256 ?? "") ||
      value.canary?.status !== "pass" ||
      !value.health || SERVICES.some((service) => value.health[service] !== "healthy")) {
    fail("standing output is not the sealed successful standing promotion receipt");
  }
  if (ledger.inputs.wikijump.commit !== value.wikijump_sha || ledger.inputs.wikijump.tree !== value.wikijump_tree || ledger.inputs.ftml.commit !== value.ftml_sha) {
    fail("standing promotion source identity does not match the canonical ledger");
  }
  const preparedInput = await readArtifactReference(value.prepared_receipt, "prepared receipt");
  const prepared = preparedInput.value;
  if (prepared?.schema_version !== 1 || prepared.kind !== "standing-image-preparation" || prepared.status !== "pass" ||
      prepared.run_id !== value.run_id || prepared.wikijump_sha !== value.wikijump_sha ||
      prepared.wikijump_tree !== value.wikijump_tree || prepared.ftml_sha !== value.ftml_sha ||
      prepared.dependency_lock_sha256 !== value.dependency_lock_sha256) {
    fail("prepared receipt is not bound to the standing source and run");
  }
  requireImmutableImages(prepared.images, "prepared receipt images");
  const proofReference = value.promotion_precondition;
  const preparedProof = prepared.promotion_precondition;
  if (proofReference?.path !== preparedProof?.path || proofReference?.sha256 !== preparedProof?.sha256) {
    fail("standing promotion proof is not bound to the prepared receipt");
  }
  const proofInput = await readArtifactReference(proofReference, "promotion precondition");
  const proof = proofInput.value;
  if (proof?.schema !== "wikijump.standing_promotion_precondition.v1" || proof.status !== "pass" || proof.run_id !== value.run_id ||
      proof.candidate?.wikijump_commit !== value.wikijump_sha || proof.candidate?.wikijump_tree !== value.wikijump_tree || proof.candidate?.ftml_sha !== value.ftml_sha ||
      proof.build?.wikijump_commit !== value.wikijump_sha || proof.build?.wikijump_tree !== value.wikijump_tree || proof.build?.ftml_sha !== value.ftml_sha) {
    fail("candidate proof is not a passing canonical promotion receipt for the standing source");
  }
  requireHashFields(proof.admission, ["candidate_parity_receipt_sha256", "candidate_identity_sha256", "live_reference_sha256", "live_completion_policy_sha256", "source_runner_sha256", "source_observation_sha256", "source_execution_identity_sha256"], "candidate proof");
  requireImmutableImages(proof.build.images, "candidate proof images", ["cache", "caddy", "database", "deepwell", "files", "framerail", "wws"], true);
  requireImmutableImages(value.images, "standing images");
  for (const service of SERVICES) {
    if (prepared.images[service].id !== value.images[service].id || proof.build.images[service] !== value.images[service].id) {
      fail(`standing image ${service} is not bound to the canonical promotion proof`);
    }
  }
  const runtimeInput = await readArtifactReference(value.runtime_differential_identity, "runtime identity");
  const runtime = runtimeInput.value;
  const runtimeIdentity = runtime?.identity;
  if (runtime?.schema !== "wikijump_syntax_differential.wikijump_runtime_identity.v1" || runtimeIdentity?.wikijump_sha !== value.wikijump_sha || runtimeIdentity?.ftml_sha !== value.ftml_sha || runtimeIdentity?.dependency_lock_sha256 !== value.dependency_lock_sha256 || !HEX64.test(runtimeIdentity?.executable_sha256 ?? "") || !HEX64.test(runtimeIdentity?.runtime_config_sha256 ?? "") || runtimeIdentity.executable_sha256 !== value.images.deepwell.id.slice(7)) {
    fail("runtime identity is not bound to the immutable standing images and source");
  }
  if (value.runtime_differential_identity.sha256 !== runtimeInput.reference.sha256) fail("standing runtime identity digest is stale");
  if (value.cleanup?.status !== "pass" || value.cleanup.candidate_receipt?.path !== value.prepared_receipt?.path || value.cleanup.candidate_receipt?.sha256 !== value.prepared_receipt?.sha256) {
    fail("standing cleanup is not cryptographically bound to the prepared receipt");
  }
  return Object.freeze({value, promotion_precondition: proof, prepared, runtime});
}

function finalZeroCounts(ledger, standing) {
  const rows = ledger.rows;
  const count = (predicate) => rows.reduce((total, row) => total + (predicate(row) ? 1 : 0), 0);
  const ids = rows.map((row) => row?.surface_id);
  const counts = {
    complete_product_rows_open_or_unreconciled: count((row) => row?.closure?.state !== "closed" || row?.issues?.state !== "present" || row?.blockers?.state !== "none"),
    duplicate_or_ambiguous_canonical_identities: ids.length - new Set(ids).size,
    missing_independent_standards_or_spec_reviews: count((row) => row?.tests?.state !== "present"),
    missing_or_failing_candidate_proofs: standing.promotion_precondition.status === "pass" ? 0 : rows.length,
    missing_or_failing_standing_proofs: standing.value.status === "pass" ? 0 : rows.length,
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
  const ledgerInput = await readJsonInput(ledger, "canonical compatibility ledger");
  const standingInput = await readJsonInput(standingMatrix, "standing compatibility output");
  const ledgerValue = currentLedger(ledgerInput.value);
  const standing = await standingPromotion(standingInput.value, ledgerValue);
  const counts = finalZeroCounts(ledgerValue, standing);
  const nonzero = Object.entries(counts).filter(([, value]) => value !== 0);
  if (nonzero.length > 0) fail(`final-zero check failed: ${nonzero.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  const inputs = {
    ledger: ledgerInput.reference,
    standing_matrix: standingInput.reference,
  };
  return {schema: "wikijump.compatibility_final_zero_receipt.v1", status: "pass", merge_commit: standing.value.wikijump_sha, counts, inputs};
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
