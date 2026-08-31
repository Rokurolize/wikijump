#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {publishBytesNoReplace} from "../src/atomic-no-replace.mjs";
import {codePointCompare, sha256Hex} from "../src/canonical-json.mjs";
import {
  assertExactCompatibilityDeferredScope,
  compatibilityDeferredEntries,
} from "../src/compatibility-deferred-scope.mjs";
import {runCliIfMain} from "../src/cli-entry.mjs";

const INVENTORY_SCHEMA = "wikijump.compatibility_surface_inventory.v2";
const LEDGER_SCHEMA = "wikijump.compatibility_ledger.v1";
const CURRENT_SCHEMA = "wikijump.compatibility_final_zero_denominator.v1";
const DEFERRED_SCHEMA = "wikijump.compatibility_deferred_denominator.v1";
const DEFERRED_LEDGER_SCHEMA = "wikijump.compatibility_deferred_ledger.v1";
const SURFACE_ID = /^surface:[0-9]{8}$/u;

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

function parseArgs(argv) {
  const names = new Set([
    "inventory",
    "ledger",
    "current-output",
    "deferred-output",
    "deferred-ledger-output",
  ]);
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    const value = argv[index + 1];
    if (!names.has(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) {
      fail(`unknown or duplicate option: ${flag}`);
    }
    args[name] = path.resolve(value);
  }
  for (const name of names) if (!args[name]) fail(`--${name} is required`);
  return args;
}

function usage() {
  return "Usage: build-compatibility-final-denominators.mjs --inventory FILE --ledger FILE --current-output FILE --deferred-output FILE --deferred-ledger-output FILE";
}

async function readJson(filePath, name) {
  const bytes = await fs.readFile(filePath);
  try {
    return {bytes, value: JSON.parse(bytes.toString("utf8"))};
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
}

function sameRevision(left, right) {
  return left?.commit === right?.commit && left?.tree === right?.tree;
}

function deriveCanonicalRecords(inventory, deferredIds) {
  const current = inventory.surfaces.filter(({surface_id: surfaceId}) => !deferredIds.has(surfaceId));
  const currentIds = new Set(current.map(({surface_id: surfaceId}) => surfaceId));
  const relationshipSources = new Set();
  for (const edge of inventory.relationship_edges ?? []) {
    if (!["alias", "equivalence"].includes(edge.type) || !currentIds.has(edge.source)) continue;
    if (!currentIds.has(edge.target)) fail(`current denominator relationship target is missing: ${edge.target}`);
    if (relationshipSources.has(edge.source)) fail(`current denominator source has multiple canonical targets: ${edge.source}`);
    relationshipSources.add(edge.source);
  }
  for (const edge of inventory.relationship_edges ?? []) {
    if (
      ["alias", "equivalence"].includes(edge.type) &&
      relationshipSources.has(edge.source) &&
      relationshipSources.has(edge.target)
    ) {
      fail(`current denominator canonical target is itself noncanonical: ${edge.target}`);
    }
  }
  return current
    .filter(({surface_id: surfaceId}) => !relationshipSources.has(surfaceId))
    .sort((left, right) => codePointCompare(left.surface_id, right.surface_id));
}

function ledgerSurfaceMap(ledger) {
  if (!Array.isArray(ledger.source_local_identities) || !Array.isArray(ledger.surface_assignments)) {
    fail("canonical ledger identity tables are missing");
  }
  const localByRaw = new Map();
  for (const row of ledger.source_local_identities) {
    if (
      typeof row.raw_record_id !== "string" ||
      typeof row.source_local_id !== "string" ||
      localByRaw.has(row.raw_record_id)
    ) {
      fail("canonical ledger source-local identities are ambiguous");
    }
    localByRaw.set(row.raw_record_id, row.source_local_id);
  }
  const result = new Map();
  for (const assignment of ledger.surface_assignments) {
    const localId = localByRaw.get(assignment.raw_record_id);
    if (!localId || !SURFACE_ID.test(assignment.surface_id ?? "") || result.has(localId)) {
      fail("canonical ledger surface assignments are ambiguous");
    }
    result.set(localId, assignment.surface_id);
  }
  return result;
}

function semanticTuple(record) {
  const specification = record.specification_owner ?? `compatibility surface ${record.surface_id}`;
  const publicReference = Array.isArray(record.public_reference) && record.public_reference.length > 0
    ? record.public_reference[0]
    : record.surface_id;
  const requestKinds = new Set([
    "framerail_amc_action_shape",
    "framerail_amc_module_shape",
    "framerail_route",
    "framerail_server_action",
    "missing_page_control",
    "page_action",
    "wws_route",
  ]);
  const actor = record.kind === "deepwell_jsonrpc_method"
    ? "trusted Wikijump service caller"
    : requestKinds.has(record.kind)
      ? "HTTP client at the declared public boundary"
      : `actor defined by ${specification}`;
  const observableInterval = requestKinds.has(record.kind) || record.kind === "deepwell_jsonrpc_method"
    ? "one public request including its browser-visible response interval"
    : `observable lifecycle defined by ${specification}`;
  return {
    actor,
    input: `input admitted by ${publicReference}`,
    observable_interval: observableInterval,
    result: `Wikidot-compatible observable result required by ${specification}`,
  };
}

export function buildCompatibilityFinalDenominators({inventory, inventoryPath, inventoryBytes, ledger}) {
  if (inventory?.schema !== INVENTORY_SCHEMA || inventory.counts?.total !== inventory.surfaces?.length) {
    fail("unsupported or incomplete compatibility inventory");
  }
  if (ledger?.schema !== LEDGER_SCHEMA) fail("unsupported canonical compatibility ledger");
  exactKeys(ledger.inputs, ["inventory", "wikijump", "ftml"], "canonical ledger inputs");
  const inventorySha256 = sha256Hex(inventoryBytes);
  if (
    path.resolve(ledger.inputs.inventory?.path ?? "") !== path.resolve(inventoryPath) ||
    ledger.inputs.inventory?.sha256 !== inventorySha256
  ) {
    fail("canonical ledger is not bound to the selected inventory bytes");
  }
  if (
    !sameRevision(ledger.inputs.wikijump, inventory.provenance?.wikijump) ||
    !sameRevision(ledger.inputs.ftml, inventory.provenance?.ftml)
  ) {
    fail("canonical ledger source revisions do not match the selected inventory");
  }

  const deferred = compatibilityDeferredEntries(inventory.surfaces);
  assertExactCompatibilityDeferredScope(deferred);
  const deferredIds = new Set(deferred.map(({source_local_id: sourceLocalId}) => sourceLocalId));
  if (deferredIds.size !== deferred.length) fail("deferred compatibility identities are duplicated");
  const canonicalRecords = deriveCanonicalRecords(inventory, deferredIds);
  const surfaceByLocal = ledgerSurfaceMap(ledger);
  const canonicalIds = new Set(canonicalRecords.map(({surface_id: surfaceId}) => surfaceId));
  if (
    canonicalRecords.length !== ledger.counts?.canonical_surfaces ||
    surfaceByLocal.size !== canonicalRecords.length
  ) {
    fail("canonical ledger and independently derived current denominator counts differ");
  }
  for (const localId of surfaceByLocal.keys()) {
    if (!canonicalIds.has(localId)) fail(`canonical ledger contains a non-denominator assignment: ${localId}`);
  }

  const currentRows = canonicalRecords
    .map((record) => {
      const surfaceId = surfaceByLocal.get(record.surface_id);
      if (!surfaceId) fail(`current denominator has no opaque surface identity for ${record.surface_id}`);
      return {
        surface_id: surfaceId,
        source_local_id: record.surface_id,
        kind: record.kind,
        ...semanticTuple(record),
      };
    })
    .sort((left, right) => codePointCompare(left.surface_id, right.surface_id));

  const deferredRows = deferred
    .map(({source_local_id: sourceLocalId, kind}) => ({
      surface_id: sourceLocalId,
      source_local_id: sourceLocalId,
      kind,
    }))
    .sort((left, right) => codePointCompare(left.source_local_id, right.source_local_id));
  const deferredLedgerRows = deferred
    .map(({source_local_id: sourceLocalId, kind, deferred_owner: deferredOwner}) => ({
      surface_id: sourceLocalId,
      source_local_id: sourceLocalId,
      kind,
      deferred_owner: deferredOwner,
    }))
    .sort((left, right) => codePointCompare(left.source_local_id, right.source_local_id));

  return {
    current: {schema: CURRENT_SCHEMA, status: "sealed", rows: currentRows},
    deferred: {schema: DEFERRED_SCHEMA, status: "sealed", rows: deferredRows},
    deferredLedger: {schema: DEFERRED_LEDGER_SCHEMA, status: "sealed", rows: deferredLedgerRows},
  };
}

async function assertOutputsAbsent(paths) {
  for (const output of paths) {
    try {
      await fs.lstat(output);
      fail(`immutable denominator output already exists: ${output}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function publishJson(destination, value) {
  await fs.mkdir(path.dirname(destination), {recursive: true});
  const publication = await publishBytesNoReplace(
    destination,
    `${JSON.stringify(value, null, 2)}\n`,
  );
  if (publication !== "created") fail(`immutable denominator output already exists: ${destination}`);
}

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout(usage());
    return 0;
  }
  const [inventoryInput, ledgerInput] = await Promise.all([
    readJson(args.inventory, "compatibility inventory"),
    readJson(args.ledger, "canonical compatibility ledger"),
  ]);
  const outputs = buildCompatibilityFinalDenominators({
    inventory: inventoryInput.value,
    inventoryPath: args.inventory,
    inventoryBytes: inventoryInput.bytes,
    ledger: ledgerInput.value,
  });
  const destinations = [
    args["current-output"],
    args["deferred-output"],
    args["deferred-ledger-output"],
  ];
  await assertOutputsAbsent(destinations);
  await publishJson(destinations[0], outputs.current);
  await publishJson(destinations[1], outputs.deferred);
  await publishJson(destinations[2], outputs.deferredLedger);
  stdout(JSON.stringify({
    status: "sealed",
    current_rows: outputs.current.rows.length,
    deferred_rows: outputs.deferred.rows.length,
    outputs: {
      current: destinations[0],
      deferred: destinations[1],
      deferred_ledger: destinations[2],
    },
  }));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    return 1;
  },
});
