#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {sealJsonNoReplace, sha256File} from "../src/standing-browser-parity-util.mjs";

export const FINAL_ZERO_CLASSES = Object.freeze([
  "complete_product_rows_open_or_unreconciled",
  "duplicate_or_ambiguous_canonical_identities",
  "missing_independent_standards_or_spec_reviews",
  "missing_or_failing_candidate_proofs",
  "missing_or_failing_standing_proofs",
  "missing_or_stale_source_provenance",
  "missing_public_surfaces",
  "unimplemented_source_required_rows",
  "unknown_owners_or_untyped_edges",
  "unrepresented_charter_requirements",
  "unresolved_wikidot_evidence_requirements",
]);

const GIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SURFACE = /^surface:[0-9]{8}$/u;

function fail(message) {
  throw new Error(message);
}

function object(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value;
}

function exactKeys(value, keys, name) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${name} has missing or unknown fields`);
  }
}

function enumValue(value, values, name) {
  if (!values.includes(value)) fail(`${name} has an unsupported value`);
}

function digest(value, name) {
  if (!SHA256.test(value ?? "")) fail(`${name} must be a SHA-256 digest`);
  if (/^(.)\1+$/u.test(value)) fail(`${name} must not be a placeholder identity`);
  return value;
}

function gitObject(value, name) {
  if (!GIT.test(value ?? "")) fail(`${name} must be a full lowercase Git object id`);
  if (/^(.)\1+$/u.test(value)) fail(`${name} must not be a placeholder identity`);
  return value;
}

function count(predicate, values) {
  return values.reduce((total, value) => total + (predicate(value) ? 1 : 0), 0);
}

function validateDenominator(value) {
  const denominator = object(value, "final-zero denominator");
  exactKeys(
    denominator,
    ["schema", "rows", "charter_requirements", "untyped_edge_count"],
    "final-zero denominator",
  );
  if (denominator.schema !== "wikijump.compatibility_final_zero_denominator.v1") {
    fail("final-zero denominator has an unsupported schema");
  }
  if (!Array.isArray(denominator.rows) || denominator.rows.length === 0) {
    fail("final-zero denominator rows must be non-empty");
  }
  if (!Number.isSafeInteger(denominator.untyped_edge_count) || denominator.untyped_edge_count < 0) {
    fail("final-zero denominator untyped_edge_count is invalid");
  }
  if (!Array.isArray(denominator.charter_requirements) || denominator.charter_requirements.length === 0) {
    fail("final-zero denominator charter_requirements must be non-empty");
  }
  const charterRequirements = denominator.charter_requirements.map((value, index) => {
    const requirement = object(value, `charter requirement ${index}`);
    exactKeys(requirement, ["id", "status"], `charter requirement ${index}`);
    if (typeof requirement.id !== "string" || requirement.id === "") fail(`charter requirement ${index}.id is invalid`);
    enumValue(requirement.status, ["represented", "missing"], `charter requirement ${index}.status`);
    return requirement;
  });
  if (new Set(charterRequirements.map(({id}) => id)).size !== charterRequirements.length) fail("final-zero denominator has duplicate charter requirements");
  const rows = denominator.rows.map((value, index) => {
    const row = object(value, `final-zero denominator row ${index}`);
    exactKeys(
      row,
      [
        "surface_id",
        "identity",
        "public_surface",
        "owner",
        "source_provenance",
        "evidence",
        "source",
        "standards_review",
        "spec_review",
        "candidate",
        "standing",
        "closure",
        "issue",
        "charter",
      ],
      `final-zero denominator row ${index}`,
    );
    if (!SURFACE.test(row.surface_id ?? "")) fail(`row ${index} has an invalid surface_id`);
    enumValue(row.identity, ["canonical", "ambiguous"], `row ${index}.identity`);
    for (const field of ["public_surface"]) {
      if (typeof row[field] !== "boolean") fail(`row ${index}.${field} must be boolean`);
    }
    for (const field of ["owner", "source_provenance", "evidence", "source", "standards_review", "spec_review", "candidate", "standing", "closure", "issue", "charter"]) {
      if (typeof row[field] !== "string" || row[field] === "") fail(`row ${index}.${field} must be a non-empty string`);
    }
    enumValue(row.owner, ["known", "unknown"], `row ${index}.owner`);
    enumValue(row.source_provenance, ["present", "missing", "stale"], `row ${index}.source_provenance`);
    enumValue(row.evidence, ["resolved", "unresolved"], `row ${index}.evidence`);
    enumValue(row.source, ["implemented", "unimplemented"], `row ${index}.source`);
    enumValue(row.standards_review, ["pass", "missing", "fail"], `row ${index}.standards_review`);
    enumValue(row.spec_review, ["pass", "missing", "fail"], `row ${index}.spec_review`);
    enumValue(row.candidate, ["pass", "missing", "fail"], `row ${index}.candidate`);
    enumValue(row.standing, ["pass", "missing", "fail"], `row ${index}.standing`);
    enumValue(row.closure, ["closed", "open"], `row ${index}.closure`);
    enumValue(row.issue, ["reconciled", "unreconciled"], `row ${index}.issue`);
    enumValue(row.charter, ["represented", "missing"], `row ${index}.charter`);
    return row;
  });
  const ids = rows.map((row) => row.surface_id);
  return {
    rows,
    ids,
    duplicateIds: ids.length - new Set(ids).size,
    charterRequirements,
    untypedEdgeCount: denominator.untyped_edge_count,
  };
}

async function validateLedger(filePath, denominatorIds) {
  const ledger = object(JSON.parse(await fs.readFile(filePath, "utf8")), "compatibility ledger");
  exactKeys(ledger, ["schema", "counts", "rows"], "compatibility ledger");
  if (ledger.schema !== "wikijump.compatibility_ledger.v1") fail("compatibility ledger has an unsupported schema");
  if (!Array.isArray(ledger.rows)) fail("compatibility ledger rows must be an array");
  object(ledger.counts, "compatibility ledger counts");
  exactKeys(ledger.counts, ["canonical_surfaces"], "compatibility ledger counts");
  const ids = ledger.rows.map((row, index) => {
    object(row, `compatibility ledger row ${index}`);
    if (!SURFACE.test(row.surface_id ?? "")) fail(`compatibility ledger row ${index} has an invalid surface_id`);
    return row.surface_id;
  });
  if (new Set(ids).size !== ids.length) fail("compatibility ledger has duplicate surface ids");
  if (JSON.stringify([...ids].sort()) !== JSON.stringify([...denominatorIds].sort())) fail("ledger surface ids differ from the final-zero denominator");
  if (ledger.counts?.canonical_surfaces !== ids.length) fail("ledger canonical surface count is not exact");
  return ledger;
}

async function validateStandingMatrix(filePath, denominatorIds) {
  const matrix = object(JSON.parse(await fs.readFile(filePath, "utf8")), "standing matrix");
  exactKeys(matrix, ["schema", "merge_commit", "rows"], "standing matrix");
  if (matrix.schema !== "wikijump.compatibility_standing_matrix.v1") fail("standing matrix has an unsupported schema");
  gitObject(matrix.merge_commit, "standing matrix merge_commit");
  if (!Array.isArray(matrix.rows)) fail("standing matrix rows must be an array");
  const rows = matrix.rows;
  const ids = rows.map((value, index) => {
    const row = object(value, `standing matrix row ${index}`);
    exactKeys(row, ["surface_id", "status", "artifacts"], `standing matrix row ${index}`);
    if (!SURFACE.test(row.surface_id ?? "")) fail(`standing matrix row ${index} has an invalid surface_id`);
    if (row.status !== "pass") fail(`standing matrix row ${index} is not a pass`);
    if (!Array.isArray(row.artifacts) || row.artifacts.length === 0) fail(`standing matrix row ${index} has no artifacts`);
    return row.surface_id;
  });
  if (new Set(ids).size !== ids.length) fail("standing matrix has duplicate surface ids");
  if (JSON.stringify([...ids].sort()) !== JSON.stringify([...denominatorIds].sort())) fail("standing matrix surface ids differ from the final-zero denominator");
  await Promise.all(rows.flatMap((row, index) => row.artifacts.map(async (artifact, artifactIndex) => {
    const record = object(artifact, `standing matrix row ${index} artifact ${artifactIndex}`);
    exactKeys(record, ["path", "sha256"], `standing matrix row ${index} artifact ${artifactIndex}`);
    if (typeof record.path !== "string" || !path.isAbsolute(record.path)) fail("standing matrix artifacts must use absolute paths");
    const expected = digest(record.sha256, `standing matrix row ${index} artifact ${artifactIndex}.sha256`);
    const actual = await sha256File(record.path);
    if (actual !== expected) fail(`standing matrix row ${index} artifact ${artifactIndex} has a mismatched SHA-256`);
  })));
  return matrix;
}

function finalZeroCounts(denominator) {
  const rows = denominator.rows;
  return {
    complete_product_rows_open_or_unreconciled: count((row) => row.closure !== "closed" || row.issue !== "reconciled", rows),
    duplicate_or_ambiguous_canonical_identities: denominator.duplicateIds + count((row) => row.identity !== "canonical", rows),
    missing_independent_standards_or_spec_reviews: count((row) => row.standards_review !== "pass" || row.spec_review !== "pass", rows),
    missing_or_failing_candidate_proofs: count((row) => row.candidate !== "pass", rows),
    missing_or_failing_standing_proofs: count((row) => row.standing !== "pass", rows),
    missing_or_stale_source_provenance: count((row) => row.source_provenance !== "present", rows),
    missing_public_surfaces: count((row) => row.public_surface !== true, rows),
    unimplemented_source_required_rows: count((row) => row.source !== "implemented", rows),
    unknown_owners_or_untyped_edges: denominator.untypedEdgeCount + count((row) => row.owner !== "known", rows),
    unrepresented_charter_requirements: count((row) => row.charter !== "represented", rows) + count((requirement) => requirement.status !== "represented", denominator.charterRequirements),
    unresolved_wikidot_evidence_requirements: count((row) => row.evidence !== "resolved", rows),
  };
}

export function parseArgs(argv) {
  const args = {};
  const names = new Set(["ledger", "denominator", "standing-matrix", "output"]);
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
  const denominatorValue = validateDenominator(JSON.parse(await fs.readFile(denominator, "utf8")));
  await validateLedger(ledger, denominatorValue.ids);
  const matrix = await validateStandingMatrix(standingMatrix, denominatorValue.ids);
  const counts = finalZeroCounts(denominatorValue);
  const nonzero = Object.entries(counts).filter(([, value]) => value !== 0);
  if (nonzero.length > 0) fail(`final-zero check failed: ${nonzero.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  return {
    schema: "wikijump.compatibility_final_zero_receipt.v1",
    status: "pass",
    merge_commit: matrix.merge_commit,
    counts,
    inputs: {
      ledger: {path: path.resolve(ledger), sha256: await sha256File(ledger)},
      denominator: {path: path.resolve(denominator), sha256: await sha256File(denominator)},
      standing_matrix: {path: path.resolve(standingMatrix), sha256: await sha256File(standingMatrix)},
    },
  };
}

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout(usage());
    return 0;
  }
  const receipt = await verifyFinalZero({
    ledger: args.ledger,
    denominator: args.denominator,
    standingMatrix: args["standing-matrix"],
  });
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
