#!/usr/bin/env node

import path from "node:path";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {
  readStableRegularFile,
  requireSha256,
  sealJsonNoReplace,
} from "../src/standing-browser-parity-util.mjs";

export const CANDIDATE_MAP_SCHEMA = "wikijump.compatibility_candidate_map.v1";

const DENOMINATOR_SCHEMA = "wikijump.compatibility_final_zero_denominator.v1";
const INVENTORY_SCHEMA = "wikijump.compatibility_surface_inventory.v2";
const AGGREGATE_SCHEMA = "wikijump.candidate_campaign_aggregate.v1";
const PARITY_ADMISSION_SCHEMA = "wikijump.standing_candidate_parity_admission.v1";
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

function semanticDenominatorRows(value) {
  if (value?.schema !== DENOMINATOR_SCHEMA || value.status !== "sealed" || !Array.isArray(value.rows) || value.rows.length === 0) {
    fail("candidate map denominator is not a sealed semantic denominator");
  }
  const seenSurface = new Set();
  const seenLocal = new Set();
  for (const row of value.rows) {
    exactKeys(row, ["surface_id", "source_local_id", "kind", "actor", "input", "observable_interval", "result"], "candidate map denominator row");
    if (
      !SURFACE_ID.test(row.surface_id ?? "") ||
      typeof row.source_local_id !== "string" || row.source_local_id === "" ||
      typeof row.kind !== "string" || row.kind === "" ||
      ["actor", "input", "observable_interval", "result"].some((field) => typeof row[field] !== "string" || row[field] === "") ||
      seenSurface.has(row.surface_id) || seenLocal.has(row.source_local_id)
    ) {
      fail("candidate map denominator has an invalid or duplicate row");
    }
    seenSurface.add(row.surface_id);
    seenLocal.add(row.source_local_id);
  }
  return value.rows;
}

function inventoryBySurface(value) {
  if (value?.schema !== INVENTORY_SCHEMA || value.counts?.total !== value.surfaces?.length) {
    fail("candidate map inventory is not complete");
  }
  return new Map(value.surfaces.map((row) => [row.surface_id, row]));
}

function aggregateCases(value) {
  if (
    value?.schema !== AGGREGATE_SCHEMA ||
    value.status !== "pass" ||
    typeof value.run_id !== "string" || value.run_id === "" ||
    !SHA64.test(value.candidate?.artifact_key ?? "") ||
    !SHA40.test(value.candidate?.wikijump_commit ?? "") ||
    !SHA40.test(value.candidate?.wikijump_tree ?? "") ||
    !SHA40.test(value.candidate?.ftml_sha ?? "") ||
    !Array.isArray(value.cases)
  ) {
    fail("candidate campaign aggregate is not a sealed pass");
  }
  const cases = new Map();
  for (const row of value.cases) {
    if (
      typeof row.case_id !== "string" || row.case_id === "" || cases.has(row.case_id)
    ) {
      fail("candidate campaign aggregate has duplicate or missing case ids");
    }
    cases.set(row.case_id, artifact({path: row.path, sha256: row.sha256}, `candidate case ${row.case_id}`));
  }
  return cases;
}

function parityAdmission(value, aggregate) {
  if (value === null) return null;
  if (
    value?.schema !== PARITY_ADMISSION_SCHEMA ||
    value.status !== "pass" ||
    value.candidate?.artifact_key !== aggregate.candidate.artifact_key ||
    value.candidate?.wikijump_commit !== aggregate.candidate.wikijump_commit ||
    value.candidate?.wikijump_tree !== aggregate.candidate.wikijump_tree ||
    value.candidate?.ftml_sha !== aggregate.candidate.ftml_sha ||
    value.parity?.pairs_total !== 6 ||
    !SHA64.test(value.candidate_parity_receipt_sha256 ?? "")
  ) {
    fail("candidate browser parity admission is not a passing proof for the campaign candidate");
  }
  return value;
}

export function buildCompatibilityCandidateMap({denominator, denominatorReference, inventory, inventoryReference, aggregate, aggregateReference, browserParityAdmission = null, browserParityAdmissionReference = null}) {
  const denominatorRows = semanticDenominatorRows(denominator);
  const inventoryRows = inventoryBySurface(inventory);
  const cases = aggregateCases(aggregate);
  const denominatorArtifact = artifact(denominatorReference, "current denominator");
  const inventoryArtifact = artifact(inventoryReference, "compatibility inventory");
  const aggregateArtifact = artifact(aggregateReference, "candidate campaign aggregate");
  const parity = parityAdmission(browserParityAdmission, aggregate);
  const parityArtifact = browserParityAdmissionReference === null
    ? null
    : artifact(browserParityAdmissionReference, "candidate browser parity admission");
  const rows = denominatorRows.map((row) => {
    const record = inventoryRows.get(row.source_local_id);
    if (!record || record.kind !== row.kind) {
      fail(`candidate map inventory has no matching row for ${row.source_local_id}`);
    }
    if (record.candidate?.status === "blocked") {
      fail(`candidate map cannot pass blocked candidate row ${row.source_local_id}`);
    }
    const requiredCaseIds = (record.candidate?.references ?? [])
      .filter((reference) => typeof reference === "string" && reference.startsWith("candidate-case:"))
      .map((reference) => reference.slice("candidate-case:".length));
    const exactCaseArtifacts = requiredCaseIds.map((caseId) => cases.get(caseId));
    let artifacts;
    if (requiredCaseIds.length === 0) {
      artifacts = [aggregateArtifact];
    } else if (exactCaseArtifacts.every(Boolean)) {
      artifacts = exactCaseArtifacts;
    } else if ((record.candidate?.references ?? []).includes("C_BROWSER_PARITY_CANDIDATE")) {
      if (parity === null || parityArtifact === null) {
        fail(`candidate map requires browser parity admission for ${row.source_local_id}`);
      }
      artifacts = [parityArtifact];
    } else {
      const missingCaseIds = requiredCaseIds.filter((caseId) => !cases.has(caseId));
      fail(`candidate map has no exact candidate artifact for ${row.source_local_id}: ${missingCaseIds.join(", ")}`);
    }
    return {
      surface_id: row.surface_id,
      source_local_id: row.source_local_id,
      kind: row.kind,
      status: "pass",
      artifacts,
    };
  });
  return {
    schema: CANDIDATE_MAP_SCHEMA,
    status: "pass",
    run_id: aggregate.run_id,
    candidate: {
      artifact_key: aggregate.candidate.artifact_key,
      wikijump_commit: aggregate.candidate.wikijump_commit,
      wikijump_tree: aggregate.candidate.wikijump_tree,
      ftml_sha: aggregate.candidate.ftml_sha,
    },
    inputs: {
      denominator: denominatorArtifact,
      inventory: inventoryArtifact,
      aggregate: aggregateArtifact,
      ...(parityArtifact === null ? {} : {browser_parity_admission: parityArtifact}),
    },
    rows,
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
  const names = new Set(["denominator", "inventory", "aggregate", "browser-parity-admission", "output"]);
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    const value = argv[index + 1];
    if (!names.has(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) fail(`unknown or duplicate option: ${flag}`);
    args[name] = path.resolve(value);
  }
  for (const name of ["denominator", "inventory", "aggregate", "output"]) if (!args[name]) fail(`--${name} is required`);
  return args;
}

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout("Usage: build-compatibility-candidate-map.mjs --denominator FILE --inventory FILE --aggregate FILE [--browser-parity-admission FILE] --output FILE");
    return 0;
  }
  const [denominator, inventory, aggregate, browserParityAdmission] = await Promise.all([
    readJson(args.denominator, "current denominator"),
    readJson(args.inventory, "compatibility inventory"),
    readJson(args.aggregate, "candidate campaign aggregate"),
    args["browser-parity-admission"] ? readJson(args["browser-parity-admission"], "candidate browser parity admission") : null,
  ]);
  const result = buildCompatibilityCandidateMap({
    denominator: denominator.value,
    denominatorReference: denominator.reference,
    inventory: inventory.value,
    inventoryReference: inventory.reference,
    aggregate: aggregate.value,
    aggregateReference: aggregate.reference,
    browserParityAdmission: browserParityAdmission?.value ?? null,
    browserParityAdmissionReference: browserParityAdmission?.reference ?? null,
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
