#!/usr/bin/env node

import path from "node:path";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {verifyFinalFrozenReceipt} from "../src/final-frozen-receipt-contract.mjs";
import {
  readStableRegularFile,
  sealJsonNoReplace,
} from "../src/standing-browser-parity-util.mjs";

export const RECONCILED_LEDGER_SCHEMA = "wikijump.compatibility_ledger.v1";

const DENOMINATOR_SCHEMA = "wikijump.compatibility_final_zero_denominator.v1";
const INVENTORY_SCHEMA = "wikijump.compatibility_surface_inventory.v2";
const CANDIDATE_MAP_SCHEMA = "wikijump.compatibility_candidate_map.v1";
const STANDING_MATRIX_SCHEMA = "wikijump.compatibility_standing_matrix.v2";
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

function artifactKey(value) {
  return `${value.path}\0${value.sha256}`;
}

function uniqueArtifacts(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = artifactKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function testArtifactReference(reference) {
  const value = artifact(reference, "runtime test artifact");
  if (value.path.includes("#")) fail("runtime test artifact path contains an unsupported # character");
  return `test:artifact:${value.path}#sha256=${value.sha256}`;
}

function denominatorMap(value) {
  if (value?.schema !== DENOMINATOR_SCHEMA || value.status !== "sealed" || !Array.isArray(value.rows) || value.rows.length === 0) {
    fail("final reconciliation denominator is not sealed");
  }
  const result = new Map();
  const locals = new Set();
  for (const row of value.rows) {
    exactKeys(row, ["surface_id", "source_local_id", "kind", "actor", "input", "observable_interval", "result"], "final reconciliation denominator row");
    if (
      !SURFACE_ID.test(row.surface_id ?? "") ||
      typeof row.source_local_id !== "string" || row.source_local_id === "" ||
      typeof row.kind !== "string" || row.kind === "" ||
      ["actor", "input", "observable_interval", "result"].some((field) => typeof row[field] !== "string" || row[field] === "") ||
      result.has(row.surface_id) || locals.has(row.source_local_id)
    ) {
      fail("final reconciliation denominator has an invalid or duplicate row");
    }
    result.set(row.surface_id, row);
    locals.add(row.source_local_id);
  }
  return result;
}

function inventoryMap(value) {
  if (value?.schema !== INVENTORY_SCHEMA || value.counts?.total !== value.surfaces?.length) {
    fail("final reconciliation inventory is incomplete");
  }
  const result = new Map();
  for (const row of value.surfaces) {
    if (typeof row.surface_id !== "string" || row.surface_id === "" || result.has(row.surface_id)) {
      fail("final reconciliation inventory has duplicate or missing surface ids");
    }
    result.set(row.surface_id, row);
  }
  return result;
}

function proofRows(value, schema, name) {
  if (value?.schema !== schema || value.status !== "pass" || !Array.isArray(value.rows) || value.rows.length === 0) {
    fail(`${name} is not a passing proof map`);
  }
  const result = new Map();
  for (const row of value.rows) {
    exactKeys(row, ["surface_id", "source_local_id", "kind", "status", "artifacts"], `${name} row`);
    if (
      !SURFACE_ID.test(row.surface_id ?? "") ||
      row.status !== "pass" ||
      !Array.isArray(row.artifacts) || row.artifacts.length === 0 ||
      result.has(row.surface_id)
    ) {
      fail(`${name} has an incomplete or duplicate row`);
    }
    result.set(row.surface_id, {
      ...row,
      artifacts: row.artifacts.map((reference, index) => artifact(reference, `${name} row artifact ${index}`)),
    });
  }
  return result;
}

function sourceLocalBySurface(ledger) {
  if (!Array.isArray(ledger.source_local_identities) || !Array.isArray(ledger.surface_assignments)) {
    fail("final reconciliation ledger identity tables are missing");
  }
  const localByRaw = new Map();
  for (const row of ledger.source_local_identities) {
    if (!row.raw_record_id || !row.source_local_id || localByRaw.has(row.raw_record_id)) {
      fail("final reconciliation ledger source-local identities are ambiguous");
    }
    localByRaw.set(row.raw_record_id, row.source_local_id);
  }
  const result = new Map();
  for (const row of ledger.surface_assignments) {
    const localId = localByRaw.get(row.raw_record_id);
    if (!SURFACE_ID.test(row.surface_id ?? "") || !localId || result.has(row.surface_id)) {
      fail("final reconciliation ledger surface assignments are ambiguous");
    }
    result.set(row.surface_id, localId);
  }
  return result;
}

function sourceTestReferences(record) {
  return [...new Set(record.existing_refs?.tests ?? [])]
    .map((reference) => {
      const anchored = reference.includes("#") ? reference : reference.replace("::", "#");
      return `test:${anchored.includes("#") ? anchored : `${anchored}#file`}`;
    })
    .sort();
}

export function reconcileCompatibilityLedger({
  ledger,
  inventory,
  denominator,
  candidateMap,
  standingMatrix,
  finalFrozenReference,
}) {
  if (ledger?.schema !== RECONCILED_LEDGER_SCHEMA || !Array.isArray(ledger.rows) || ledger.rows.length === 0) {
    fail("final reconciliation input ledger is incomplete");
  }
  if (
    !SHA40.test(ledger.inputs?.wikijump?.commit ?? "") ||
    !SHA40.test(ledger.inputs?.wikijump?.tree ?? "") ||
    !SHA40.test(ledger.inputs?.ftml?.commit ?? "") ||
    !SHA40.test(ledger.inputs?.ftml?.tree ?? "")
  ) {
    fail("final reconciliation input ledger source identity is incomplete");
  }
  const frozen = artifact(finalFrozenReference, "final frozen receipt");
  const denominatorRows = denominatorMap(denominator);
  const inventoryRows = inventoryMap(inventory);
  const candidateRows = proofRows(candidateMap, CANDIDATE_MAP_SCHEMA, "candidate map");
  const standingRows = proofRows(standingMatrix, STANDING_MATRIX_SCHEMA, "standing matrix");
  const sourceLocals = sourceLocalBySurface(ledger);

  if (
    candidateMap.run_id !== standingMatrix.run_id ||
    candidateMap.candidate?.wikijump_tree !== ledger.inputs.wikijump.tree ||
    candidateMap.candidate?.ftml_sha !== ledger.inputs.ftml.commit ||
    standingMatrix.merge_commit !== ledger.inputs.wikijump.commit ||
    standingMatrix.merge_tree !== ledger.inputs.wikijump.tree ||
    standingMatrix.ftml_sha !== ledger.inputs.ftml.commit ||
    standingMatrix.ftml_tree !== ledger.inputs.ftml.tree ||
    standingMatrix.candidate_commit !== candidateMap.candidate?.wikijump_commit ||
    standingMatrix.candidate_artifact_key !== candidateMap.candidate?.artifact_key
  ) {
    fail("final reconciliation proof source identities do not agree");
  }
  if (
    candidateMap.inputs?.inventory?.path !== ledger.inputs.inventory?.path ||
    candidateMap.inputs?.inventory?.sha256 !== ledger.inputs.inventory?.sha256
  ) {
    fail("final reconciliation candidate map is not bound to the canonical inventory");
  }
  if (
    denominatorRows.size !== ledger.rows.length ||
    candidateRows.size !== denominatorRows.size ||
    standingRows.size !== denominatorRows.size
  ) {
    fail("final reconciliation proof maps do not exactly cover the ledger denominator");
  }

  const buildingBySurface = new Map(ledger.rows.map((row) => [row.surface_id, row]));
  if (buildingBySurface.size !== ledger.rows.length) fail("final reconciliation input ledger has duplicate rows");
  const rows = [...denominatorRows.values()].map((semantic) => {
    const building = buildingBySurface.get(semantic.surface_id);
    const candidate = candidateRows.get(semantic.surface_id);
    const standing = standingRows.get(semantic.surface_id);
    const record = inventoryRows.get(semantic.source_local_id);
    if (
      !building || !candidate || !standing || !record ||
      record.kind !== semantic.kind ||
      sourceLocals.get(semantic.surface_id) !== semantic.source_local_id ||
      candidate.source_local_id !== semantic.source_local_id || candidate.kind !== semantic.kind ||
      standing.source_local_id !== semantic.source_local_id || standing.kind !== semantic.kind
    ) {
      fail(`final reconciliation identity mismatch for ${semantic.surface_id}`);
    }
    if (building.source?.state !== "present") {
      fail(`final reconciliation source is not implemented for ${semantic.source_local_id}`);
    }
    const specification = typeof record.specification_owner === "string" && record.specification_owner !== ""
      ? [record.specification_owner]
      : [];
    const implementation = [...new Set(record.implementation_owners ?? [])].sort();
    if (specification.length !== 1) fail(`final reconciliation has no specification owner for ${semantic.source_local_id}`);
    if (implementation.length === 0) fail(`final reconciliation has no implementation owner for ${semantic.source_local_id}`);
    const issues = [...new Set(record.existing_refs?.issues ?? [])].sort((left, right) => left - right);
    if (issues.length === 0) fail(`final reconciliation has no owning issue for ${semantic.source_local_id}`);

    const candidateArtifacts = uniqueArtifacts(candidate.artifacts);
    const standingArtifacts = uniqueArtifacts(standing.artifacts);
    const evidence = building.evidence?.state === "present"
      ? building.evidence
      : {state: "present", references: uniqueArtifacts([...candidateArtifacts, ...standingArtifacts])};
    const sourceTests = sourceTestReferences(record);
    const tests = sourceTests.length > 0
      ? {state: "present", references: sourceTests}
      : {state: "present", references: candidateArtifacts.map(testArtifactReference)};
    if (tests.references.length === 0) fail(`final reconciliation has no public regression for ${semantic.source_local_id}`);

    return {
      ...building,
      actor: {state: "known", value: semantic.actor},
      input: {state: "known", value: semantic.input},
      observable_interval: {state: "known", value: semantic.observable_interval},
      result: {state: "known", value: semantic.result},
      evidence,
      tests,
      owners: {state: "present", specification, implementation},
      issues: {state: "present", numbers: issues},
      blockers: {state: "none", numbers: []},
      candidate: {state: "pass", artifacts: candidateArtifacts},
      standing: {state: "pass", artifacts: standingArtifacts},
      closure: {
        state: "closed",
        references: [
          `candidate:${candidateArtifacts[0].sha256}`,
          `standing:${standingArtifacts[0].sha256}`,
          `final-frozen:${frozen.sha256}`,
        ],
      },
    };
  });

  return {...ledger, rows};
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

async function verifyArtifacts(rows, name) {
  for (const row of rows) {
    for (const [index, reference] of row.artifacts.entries()) {
      const file = await readStableRegularFile(reference.path, `${name} ${row.surface_id} artifact ${index}`);
      if (file.sha256 !== reference.sha256) fail(`${name} ${row.surface_id} artifact identity moved`);
    }
  }
}

function parseArgs(argv) {
  const names = new Set(["ledger", "inventory", "denominator", "candidate-map", "standing-matrix", "final-frozen", "output"]);
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
    stdout("Usage: reconcile-compatibility-ledger.mjs --ledger FILE --inventory FILE --denominator FILE --candidate-map FILE --standing-matrix FILE --final-frozen FILE --output FILE");
    return 0;
  }
  const [ledger, inventory, denominator, candidateMap, standingMatrix] = await Promise.all([
    readJson(args.ledger, "building compatibility ledger"),
    readJson(args.inventory, "compatibility inventory"),
    readJson(args.denominator, "current denominator"),
    readJson(args["candidate-map"], "candidate map"),
    readJson(args["standing-matrix"], "standing matrix"),
  ]);
  if (
    ledger.value.inputs?.inventory?.path !== inventory.reference.path ||
    ledger.value.inputs?.inventory?.sha256 !== inventory.reference.sha256
  ) {
    fail("selected inventory is not the canonical ledger inventory");
  }
  if (
    candidateMap.value.inputs?.denominator?.path !== denominator.reference.path ||
    candidateMap.value.inputs?.denominator?.sha256 !== denominator.reference.sha256
  ) {
    fail("candidate map is not bound to the selected denominator");
  }
  await Promise.all([
    verifyArtifacts(candidateMap.value.rows ?? [], "candidate map"),
    verifyArtifacts(standingMatrix.value.rows ?? [], "standing matrix"),
  ]);
  const finalFrozen = await verifyFinalFrozenReceipt({
    receiptPath: args["final-frozen"],
    source: {
      wikijump_commit: candidateMap.value.candidate?.wikijump_commit,
      wikijump_tree: candidateMap.value.candidate?.wikijump_tree,
      ftml_sha: candidateMap.value.candidate?.ftml_sha,
    },
  });
  const result = reconcileCompatibilityLedger({
    ledger: ledger.value,
    inventory: inventory.value,
    denominator: denominator.value,
    candidateMap: candidateMap.value,
    standingMatrix: standingMatrix.value,
    finalFrozenReference: {path: finalFrozen.path, sha256: finalFrozen.sha256},
  });
  const sealed = await sealJsonNoReplace(args.output, result);
  stdout(JSON.stringify({schema: result.schema, status: "reconciled", rows: result.rows.length, output: sealed.path, sha256: sealed.sha256}));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    return 1;
  },
});
