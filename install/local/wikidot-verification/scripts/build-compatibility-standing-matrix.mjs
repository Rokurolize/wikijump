#!/usr/bin/env node

import path from "node:path";

import {validateStandingPromotionPrecondition} from "../../../standing/scripts/verify-promotion-precondition.mjs";
import {validateStandingRefreshReceipt} from "../../../standing/scripts/verify-standing-refresh.mjs";
import {runCliIfMain} from "../src/cli-entry.mjs";
import {
  readStableRegularFile,
  sealJsonNoReplace,
} from "../src/standing-browser-parity-util.mjs";

export const STANDING_MATRIX_SCHEMA = "wikijump.compatibility_standing_matrix.v2";

const DENOMINATOR_SCHEMA = "wikijump.compatibility_final_zero_denominator.v1";
const LEDGER_SCHEMA = "wikijump.compatibility_ledger.v1";
const SURFACE_ID = /^surface:[0-9]{8}$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, expected, name) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())
  ) {
    fail(`${name} has missing or unknown fields`);
  }
}

function artifact(value, name) {
  exactKeys(value, ["path", "sha256"], name);
  if (!path.isAbsolute(value.path) || !SHA64.test(value.sha256 ?? "")) {
    fail(`${name} is not an immutable artifact reference`);
  }
  return {path: value.path, sha256: value.sha256};
}

function denominatorRows(value) {
  if (value?.schema !== DENOMINATOR_SCHEMA || value.status !== "sealed" || !Array.isArray(value.rows) || value.rows.length === 0) {
    fail("standing matrix denominator is not a sealed semantic denominator");
  }
  const surfaces = new Set();
  const locals = new Set();
  for (const row of value.rows) {
    exactKeys(row, ["surface_id", "source_local_id", "kind", "actor", "input", "observable_interval", "result"], "standing matrix denominator row");
    if (
      !SURFACE_ID.test(row.surface_id ?? "") ||
      typeof row.source_local_id !== "string" || row.source_local_id === "" ||
      typeof row.kind !== "string" || row.kind === "" ||
      surfaces.has(row.surface_id) || locals.has(row.source_local_id)
    ) {
      fail("standing matrix denominator has an invalid or duplicate row");
    }
    surfaces.add(row.surface_id);
    locals.add(row.source_local_id);
  }
  return value.rows;
}

function ledgerBinding(ledger) {
  if (ledger?.schema !== LEDGER_SCHEMA) fail("standing matrix ledger has an unsupported schema");
  if (
    !SHA40.test(ledger.inputs?.wikijump?.commit ?? "") ||
    !SHA40.test(ledger.inputs?.wikijump?.tree ?? "") ||
    !SHA40.test(ledger.inputs?.ftml?.commit ?? "") ||
    !SHA40.test(ledger.inputs?.ftml?.tree ?? "") ||
    !Array.isArray(ledger.source_local_identities) ||
    !Array.isArray(ledger.surface_assignments)
  ) {
    fail("standing matrix ledger source identity is incomplete");
  }
  const localByRaw = new Map(ledger.source_local_identities.map((row) => [row.raw_record_id, row.source_local_id]));
  const localBySurface = new Map();
  for (const assignment of ledger.surface_assignments) {
    const localId = localByRaw.get(assignment.raw_record_id);
    if (!localId || localBySurface.has(assignment.surface_id)) fail("standing matrix ledger assignments are ambiguous");
    localBySurface.set(assignment.surface_id, localId);
  }
  return {localBySurface};
}

export function buildCompatibilityStandingMatrix({
  denominator,
  ledger,
  promotion,
  promotionReference,
  refresh,
  refreshReference,
}) {
  const rows = denominatorRows(denominator);
  const {localBySurface} = ledgerBinding(ledger);
  const promotionArtifact = artifact(promotionReference, "standing promotion precondition");
  const refreshArtifact = artifact(refreshReference, "standing refresh receipt");
  if (
    promotion?.schema !== "wikijump.standing_promotion_precondition.v1" ||
    promotion.status !== "pass" ||
    refresh?.schema_version !== 1 ||
    refresh.kind !== "standing-promotion" ||
    refresh.status !== "pass"
  ) {
    fail("standing proof inputs are not passing canonical receipts");
  }
  if (promotion.run_id !== refresh.run_id) fail("standing proof run ids differ");
  if (JSON.stringify(refresh.promotion_precondition) !== JSON.stringify(promotionArtifact)) {
    fail("standing refresh is not bound to the selected promotion precondition");
  }
  if (
    promotion.candidate?.ftml_sha !== refresh.ftml_sha ||
    promotion.build?.wikijump_commit !== promotion.candidate?.wikijump_commit ||
    promotion.build?.wikijump_tree !== promotion.candidate?.wikijump_tree ||
    promotion.build?.ftml_sha !== promotion.candidate?.ftml_sha
  ) {
    fail("standing promotion candidate/build source identity is inconsistent");
  }
  if (
    ledger.inputs.wikijump.commit !== refresh.wikijump_sha ||
    ledger.inputs.wikijump.tree !== refresh.wikijump_tree ||
    ledger.inputs.ftml.commit !== refresh.ftml_sha
  ) {
    fail("standing refresh does not match the post-merge canonical ledger source");
  }
  if (!SHA64.test(promotion.candidate?.artifact_key ?? "") || !SHA40.test(promotion.candidate?.wikijump_commit ?? "")) {
    fail("standing promotion candidate identity is incomplete");
  }

  const matrixRows = rows.map((row) => {
    if (localBySurface.get(row.surface_id) !== row.source_local_id) {
      fail(`standing denominator identity is not bound in the ledger for ${row.surface_id}`);
    }
    return {
      surface_id: row.surface_id,
      source_local_id: row.source_local_id,
      kind: row.kind,
      status: "pass",
      artifacts: [refreshArtifact],
    };
  });
  return {
    schema: STANDING_MATRIX_SCHEMA,
    status: "pass",
    run_id: refresh.run_id,
    merge_commit: refresh.wikijump_sha,
    merge_tree: refresh.wikijump_tree,
    ftml_sha: refresh.ftml_sha,
    ftml_tree: ledger.inputs.ftml.tree,
    candidate_commit: promotion.candidate.wikijump_commit,
    candidate_artifact_key: promotion.candidate.artifact_key,
    promotion_precondition: promotionArtifact,
    standing_refresh: refreshArtifact,
    rows: matrixRows,
  };
}

async function readJson(filePath, name) {
  const absolute = path.resolve(filePath);
  const file = await readStableRegularFile(absolute, name);
  try {
    return {value: JSON.parse(file.bytes.toString("utf8")), reference: {path: absolute, sha256: file.sha256}};
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
}

function parseArgs(argv) {
  const names = new Set(["denominator", "ledger", "promotion-precondition", "standing-refresh", "output"]);
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

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout("Usage: build-compatibility-standing-matrix.mjs --denominator FILE --ledger FILE --promotion-precondition FILE --standing-refresh FILE --output FILE");
    return 0;
  }
  const [denominator, ledger, promotion, refresh] = await Promise.all([
    readJson(args.denominator, "current denominator"),
    readJson(args.ledger, "post-merge compatibility ledger"),
    readJson(args["promotion-precondition"], "standing promotion precondition"),
    readJson(args["standing-refresh"], "standing refresh receipt"),
  ]);
  validateStandingPromotionPrecondition(promotion.value);
  validateStandingRefreshReceipt(refresh.value);
  const result = buildCompatibilityStandingMatrix({
    denominator: denominator.value,
    ledger: ledger.value,
    promotion: promotion.value,
    promotionReference: promotion.reference,
    refresh: refresh.value,
    refreshReference: refresh.reference,
  });
  const sealed = await sealJsonNoReplace(args.output, result);
  stdout(JSON.stringify({schema: result.schema, status: result.status, rows: result.rows.length, output: sealed.path, sha256: sealed.sha256}));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    return 1;
  },
});
