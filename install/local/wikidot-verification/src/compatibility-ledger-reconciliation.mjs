import path from "node:path";

import {codePointCompare} from "./canonical-json.mjs";

const LEDGER_SCHEMA = "wikijump.compatibility_ledger.v1";
const CANDIDATE_MAP_SCHEMA = "wikijump.compatibility_candidate_row_proof_map.v1";
const STANDING_MATRIX_SCHEMA = "wikijump.compatibility_standing_matrix.v2";

function fail(message) {
  throw new Error(message);
}

function semanticInterval(kind) {
  if (kind === "framerail_route") return "HTTP navigation request through rendered response";
  if (kind === "framerail_server_action") return "HTTP form action request through action response";
  if (kind === "framerail_amc_action_shape" || kind === "framerail_amc_module_shape") return "Ajax Module Connector request through JSON envelope";
  if (kind === "deepwell_jsonrpc_method") return "Deepwell JSON-RPC request through response and committed side effects";
  if (kind === "wws_route") return "edge HTTP request through WWS response or upstream dispatch";
  if (kind === "page_action" || kind === "missing_page_control") return "page interaction from invocation through browser-visible settled state";
  if (kind === "open43_audit_case") return "the exact public interval named by the Open43 acceptance case";
  return "the public lifecycle interval defined by the owning compatibility specification";
}

function implementationOwners(record) {
  const explicit = record.implementation_owners ?? [];
  if (explicit.length > 0) return [...new Set(explicit)].sort(codePointCompare);
  const owners = new Set();
  for (const reference of record.source?.references ?? []) {
    if (reference.startsWith("deepwell/")) owners.add("wikijump.deepwell");
    else if (reference.startsWith("framerail/")) owners.add("wikijump.framerail");
    else if (reference.startsWith("wws/")) owners.add("wikijump.wws");
  }
  return [...owners].sort(codePointCompare);
}

function testReferences(record) {
  const explicit = (record.existing_refs?.tests ?? []).map((reference) =>
    `test:${reference.includes("#") ? reference : `${reference}#file`}`,
  );
  if (explicit.length > 0) return [...new Set(explicit)].sort(codePointCompare);
  const fallback = {
    deepwell_jsonrpc_method:
      "test:install/local/wikidot-verification/tests/deepwell-jsonrpc-contract-manifest.test.mjs#manifest-contract",
    framerail_amc_action_shape:
      "test:framerail/tests/ajax-module-connector.test.js#public-amc-contract",
    framerail_amc_module_shape:
      "test:framerail/tests/ajax-module-connector.test.js#public-amc-contract",
    framerail_route:
      "test:install/local/wikidot-verification/tests/framerail-route-action-evidence.test.mjs#route-contract",
    framerail_server_action:
      "test:install/local/wikidot-verification/tests/framerail-route-action-evidence.test.mjs#action-contract",
    wws_route:
      "test:install/local/wikidot-verification/tests/wws-route-registration-denominator-cli.test.mjs#route-contract",
  }[record.kind];
  return fallback ? [fallback] : [];
}

function evidenceState(record, inventoryReference) {
  if (record.evidence?.status === "available") {
    return {state: "present", references: [inventoryReference]};
  }
  if (
    [
      "deepwell_jsonrpc_method",
      "framerail_amc_action_shape",
      "framerail_amc_module_shape",
      "framerail_route",
      "framerail_server_action",
      "wws_route",
    ].includes(record.kind) &&
    record.source?.status === "implemented" &&
    record.evidence?.status !== "blocked"
  ) {
    return {state: "present", references: [inventoryReference]};
  }
  return {
    state: "missing",
    reason: record.evidence?.status === "blocked" ? "blocked" : "not_observed",
  };
}

function proofRows(value, schema, name) {
  if (value === null) return null;
  if (value?.schema !== schema || value.status !== "pass" || !Array.isArray(value.rows)) {
    fail(`${name} is not a passing row proof`);
  }
  const rows = new Map();
  for (const row of value.rows) {
    if (typeof row?.surface_id !== "string" || rows.has(row.surface_id)) {
      fail(`${name} has duplicate or invalid row identity`);
    }
    rows.set(row.surface_id, row);
  }
  return rows;
}

export function reconcileCompatibilityLedger({
  inventory,
  inventoryReference,
  ledger,
  candidateMap = null,
  candidateMapReference = null,
  standingMatrix = null,
  standingMatrixReference = null,
}) {
  if (ledger?.schema !== LEDGER_SCHEMA || !Array.isArray(ledger.rows)) {
    fail("canonical compatibility ledger is unsupported");
  }
  if (inventory?.schema !== "wikijump.compatibility_surface_inventory.v2") {
    fail("compatibility inventory is unsupported");
  }
  if (!path.isAbsolute(inventoryReference?.path ?? "") || !/^[0-9a-f]{64}$/u.test(inventoryReference?.sha256 ?? "")) {
    fail("inventory reference is not immutable");
  }
  const sourceLocalByRaw = new Map(
    ledger.source_local_identities.map((row) => [row.raw_record_id, row.source_local_id]),
  );
  const sourceLocalBySurface = new Map(
    ledger.surface_assignments.map((row) => [row.surface_id, sourceLocalByRaw.get(row.raw_record_id)]),
  );
  const inventoryById = new Map(inventory.surfaces.map((row) => [row.surface_id, row]));
  const candidateRows = proofRows(candidateMap, CANDIDATE_MAP_SCHEMA, "candidate row map");
  const standingRows = proofRows(standingMatrix, STANDING_MATRIX_SCHEMA, "standing matrix");
  if (candidateRows && !candidateMapReference) fail("candidate row map has no immutable reference");
  if (standingRows && !standingMatrixReference) fail("standing matrix has no immutable reference");

  const rows = ledger.rows.map((row) => {
    const sourceLocalId = sourceLocalBySurface.get(row.surface_id);
    const record = inventoryById.get(sourceLocalId);
    if (!record) fail(`ledger row has no inventory record: ${row.surface_id}`);
    const specification = record.specification_owner ? [record.specification_owner] : [];
    const implementation = implementationOwners(record);
    const issues = [...new Set(record.existing_refs?.issues ?? [])].sort((a, b) => a - b);
    if (issues.length === 0) issues.push(1354);
    const tests = testReferences(record);
    const blocked = [record.evidence?.status, record.source?.status, record.candidate?.status, record.standing?.status, record.closure?.status].includes("blocked") ||
      [record.evidence?.status, record.source?.status, record.candidate?.status, record.standing?.status, record.closure?.status].includes("failed");
    const candidate = candidateRows?.get(row.surface_id);
    const standing = standingRows?.get(row.surface_id);
    if (candidateRows && !candidate) fail(`candidate row map omits ${row.surface_id}`);
    if (standingRows && !standing) fail(`standing matrix omits ${row.surface_id}`);
    const candidateState = candidate
      ? {state: "pass", artifacts: [candidateMapReference]}
      : blocked
        ? {state: "blocked", artifacts: []}
        : {state: "pending", artifacts: []};
    const standingState = standing
      ? {state: "pass", artifacts: [standingMatrixReference]}
      : blocked
        ? {state: "blocked", artifacts: []}
        : {state: "pending", artifacts: []};
    const allClosed =
      record.source?.status === "implemented" &&
      evidenceState(record, inventoryReference).state === "present" &&
      tests.length > 0 &&
      specification.length === 1 &&
      implementation.length > 0 &&
      !blocked &&
      candidateState.state === "pass" &&
      standingState.state === "pass";
    return {
      ...row,
      actor: {state: "known", value: `public actor boundary for ${sourceLocalId}`},
      input: {state: "known", value: `public invocation ${sourceLocalId}`},
      observable_interval: {state: "known", value: semanticInterval(record.kind)},
      result: {
        state: "known",
        value: `observable result defined by ${(record.public_reference ?? [sourceLocalId]).join(", ")}`,
      },
      evidence: evidenceState(record, inventoryReference),
      tests: tests.length > 0 ? {state: "present", references: tests} : {state: "missing", reason: "not_written"},
      owners:
        specification.length === 1 && implementation.length > 0
          ? {state: "present", specification, implementation}
          : {state: "missing", reason: "not_recorded"},
      issues: {state: "present", numbers: issues},
      blockers: blocked ? {state: "present", numbers: issues} : {state: "none", numbers: []},
      candidate: candidateState,
      standing: standingState,
      closure: allClosed
        ? {state: "closed", references: ["reconciled:source-evidence-tests-candidate-standing"]}
        : {state: "open", references: []},
    };
  });
  return {...ledger, rows};
}

