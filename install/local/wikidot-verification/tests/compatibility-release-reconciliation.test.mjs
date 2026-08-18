import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {buildCompatibilityCandidateMap} from "../scripts/build-compatibility-candidate-map.mjs";
import {buildCompatibilityStandingMatrix} from "../scripts/build-compatibility-standing-matrix.mjs";
import {reconcileCompatibilityLedger} from "../scripts/reconcile-compatibility-ledger.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(root, name, value) {
  const filePath = path.join(root, name);
  const bytes = `${JSON.stringify(value)}\n`;
  await fs.writeFile(filePath, bytes, {mode: 0o600});
  return {path: filePath, sha256: sha256(bytes), value};
}

test("candidate proof map covers every current semantic row and uses exact case artifacts when available", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compat-candidate-map-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const denominator = {
    schema: "wikijump.compatibility_final_zero_denominator.v1",
    status: "sealed",
    rows: [
      {surface_id: "surface:00000001", source_local_id: "open43-audit-case:CASE_ONE", kind: "open43_audit_case", actor: "actor one", input: "input one", observable_interval: "interval one", result: "result one"},
      {surface_id: "surface:00000002", source_local_id: "catalog-feature:feature-two", kind: "catalog_feature", actor: "actor two", input: "input two", observable_interval: "interval two", result: "result two"},
    ],
  };
  const inventory = {
    schema: "wikijump.compatibility_surface_inventory.v2",
    counts: {total: 2},
    surfaces: [
      {surface_id: "open43-audit-case:CASE_ONE", kind: "open43_audit_case", existing_refs: {issues: [1], cases: ["CASE_ONE"], tests: []}},
      {surface_id: "catalog-feature:feature-two", kind: "catalog_feature", existing_refs: {issues: [2], cases: [], tests: ["tests/two.test.js#feature two"]}},
    ],
  };
  const caseArtifact = await writeJson(root, "case-one.json", {schema: "case", status: "pass"});
  const aggregate = {
    schema: "wikijump.candidate_campaign_aggregate.v1",
    status: "pass",
    run_id: "candidate-run-abcdef123456",
    candidate_identity: {path: path.join(root, "identity.json"), sha256: "a".repeat(64)},
    candidate: {artifact_key: "b".repeat(64), wikijump_commit: "1".repeat(40), wikijump_tree: "2".repeat(40), ftml_sha: "3".repeat(40)},
    case_set_manifest: {path: path.join(root, "manifest.json"), sha256: "c".repeat(64)},
    execution_case_set_count: 1,
    case_count: 1,
    case_sets: [],
    cases: [{case_set: "example", case_id: "CASE_ONE", path: caseArtifact.path, sha256: caseArtifact.sha256}],
  };
  const aggregateInput = await writeJson(root, "aggregate.json", aggregate);
  const denominatorInput = await writeJson(root, "denominator.json", denominator);
  const inventoryInput = await writeJson(root, "inventory.json", inventory);

  const mapped = buildCompatibilityCandidateMap({
    denominator,
    denominatorReference: {path: denominatorInput.path, sha256: denominatorInput.sha256},
    inventory,
    inventoryReference: {path: inventoryInput.path, sha256: inventoryInput.sha256},
    aggregate,
    aggregateReference: {path: aggregateInput.path, sha256: aggregateInput.sha256},
  });
  assert.equal(mapped.status, "pass");
  assert.equal(mapped.rows.length, 2);
  assert.deepEqual(mapped.rows[0].artifacts, [{path: caseArtifact.path, sha256: caseArtifact.sha256}]);
  assert.deepEqual(mapped.rows[1].artifacts, [{path: aggregateInput.path, sha256: aggregateInput.sha256}]);
  assert.deepEqual(mapped.rows.map(({surface_id}) => surface_id), ["surface:00000001", "surface:00000002"]);
  assert.deepEqual(mapped.inputs, {
    denominator: {path: denominatorInput.path, sha256: denominatorInput.sha256},
    inventory: {path: inventoryInput.path, sha256: inventoryInput.sha256},
    aggregate: {path: aggregateInput.path, sha256: aggregateInput.sha256},
  });

  const missingCase = structuredClone(inventory);
  missingCase.surfaces[0].existing_refs.cases = ["CASE_MISSING"];
  assert.throws(
    () => buildCompatibilityCandidateMap({denominator, denominatorReference: {path: denominatorInput.path, sha256: denominatorInput.sha256}, inventory: missingCase, inventoryReference: {path: inventoryInput.path, sha256: inventoryInput.sha256}, aggregate, aggregateReference: {path: aggregateInput.path, sha256: aggregateInput.sha256}}),
    /candidate aggregate is missing required case CASE_MISSING/u,
  );
});

test("standing matrix binds the post-merge runtime to the exact candidate tree and every current row", () => {
  const denominator = {
    schema: "wikijump.compatibility_final_zero_denominator.v1",
    status: "sealed",
    rows: [
      {surface_id: "surface:00000001", source_local_id: "catalog-feature:one", kind: "catalog_feature", actor: "actor", input: "input", observable_interval: "interval", result: "result"},
    ],
  };
  const ledger = {
    schema: "wikijump.compatibility_ledger.v1",
    inputs: {
      inventory: {path: "/tmp/inventory.json", sha256: "f".repeat(64)},
      wikijump: {commit: "4".repeat(40), tree: "2".repeat(40)},
      ftml: {commit: "3".repeat(40), tree: "5".repeat(40)},
    },
    source_local_identities: [{raw_record_id: "raw:00000001", source_local_id: "catalog-feature:one"}],
    surface_assignments: [{surface_id: "surface:00000001", raw_record_id: "raw:00000001"}],
  };
  const promotion = {
    schema: "wikijump.standing_promotion_precondition.v1",
    status: "pass",
    run_id: "candidate-run-abcdef123456",
    candidate: {artifact_key: "a".repeat(64), wikijump_commit: "1".repeat(40), wikijump_tree: "2".repeat(40), ftml_sha: "3".repeat(40)},
    build: {run_id: "candidate-run-abcdef123456", wikijump_commit: "1".repeat(40), wikijump_tree: "2".repeat(40), ftml_sha: "3".repeat(40)},
  };
  const refresh = {
    schema_version: 1,
    kind: "standing-promotion",
    status: "pass",
    run_id: "candidate-run-abcdef123456",
    wikijump_sha: "4".repeat(40),
    wikijump_tree: "2".repeat(40),
    ftml_sha: "3".repeat(40),
    promotion_precondition: {path: "/tmp/promotion.json", sha256: "b".repeat(64)},
  };
  const matrix = buildCompatibilityStandingMatrix({
    denominator,
    ledger,
    promotion,
    promotionReference: refresh.promotion_precondition,
    refresh,
    refreshReference: {path: "/tmp/refresh.json", sha256: "c".repeat(64)},
  });
  assert.equal(matrix.schema, "wikijump.compatibility_standing_matrix.v2");
  assert.equal(matrix.merge_commit, ledger.inputs.wikijump.commit);
  assert.equal(matrix.candidate_commit, promotion.candidate.wikijump_commit);
  assert.deepEqual(matrix.rows, [{surface_id: "surface:00000001", source_local_id: "catalog-feature:one", kind: "catalog_feature", status: "pass", artifacts: [{path: "/tmp/refresh.json", sha256: "c".repeat(64)}]}]);

  const wrongTree = structuredClone(refresh);
  wrongTree.wikijump_tree = "6".repeat(40);
  assert.throws(
    () => buildCompatibilityStandingMatrix({denominator, ledger, promotion, promotionReference: refresh.promotion_precondition, refresh: wrongTree, refreshReference: {path: "/tmp/refresh.json", sha256: "c".repeat(64)}}),
    /standing merge tree does not match the candidate tree/u,
  );
});

test("final ledger reconciliation consumes semantic, candidate, standing, owner, issue, evidence, and review proof without hand-editing rows", () => {
  const denominator = {
    schema: "wikijump.compatibility_final_zero_denominator.v1",
    status: "sealed",
    rows: [{surface_id: "surface:00000001", source_local_id: "open43-audit-case:CASE_ONE", kind: "open43_audit_case", actor: "anonymous actor", input: "public input", observable_interval: "request interval", result: "public result"}],
  };
  const inventory = {
    schema: "wikijump.compatibility_surface_inventory.v2",
    counts: {total: 1},
    surfaces: [{
      surface_id: "open43-audit-case:CASE_ONE",
      kind: "open43_audit_case",
      specification_owner: "open43.case:CASE_ONE",
      implementation_owners: ["wikijump.deepwell"],
      existing_refs: {issues: [1001], cases: ["CASE_ONE"], tests: []},
      evidence: {status: "blocked", references: []},
      source: {status: "implemented", references: ["deepwell/src/example.rs"]},
      closure: {status: "open", references: []},
    }],
  };
  const building = {
    schema: "wikijump.compatibility_ledger.v1",
    counts: {raw_records: 1, public_inventory_records: 1, canonical_surfaces: 1, input_alias_edges: 0, deduplication_relationships: 0},
    inputs: {inventory: {path: "/tmp/inventory.json", sha256: "a".repeat(64)}, wikijump: {commit: "4".repeat(40), tree: "2".repeat(40)}, ftml: {commit: "3".repeat(40), tree: "5".repeat(40)}},
    source_manifests: [{source_manifest_id: "manifest:00000001"}],
    raw_source_records: [{raw_record_id: "raw:00000001"}],
    source_local_identities: [{raw_record_id: "raw:00000001", source_local_id: "open43-audit-case:CASE_ONE"}],
    surface_assignments: [{surface_id: "surface:00000001", raw_record_id: "raw:00000001"}],
    relationships: [],
    deferred_exclusions: {count: 0, by_kind: {}, by_owner: {}, records: []},
    rows: [{
      surface_id: "surface:00000001",
      actor: {state: "missing", reason: "not_recorded"},
      input: {state: "missing", reason: "not_recorded"},
      observable_interval: {state: "missing", reason: "not_recorded"},
      result: {state: "missing", reason: "not_recorded"},
      source: {state: "present", bindings: [{source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001"}]},
      evidence: {state: "missing", reason: "blocked"},
      tests: {state: "missing", reason: "not_written"},
      owners: {state: "missing", reason: "not_recorded"},
      issues: {state: "missing", reason: "not_recorded"},
      blockers: {state: "present", numbers: [1001]},
      candidate: {state: "pending", artifacts: []},
      standing: {state: "pending", artifacts: []},
      closure: {state: "open", references: []},
    }],
  };
  const candidateArtifact = {path: "/tmp/case-one.json", sha256: "b".repeat(64)};
  const candidateMap = {
    schema: "wikijump.compatibility_candidate_map.v1",
    status: "pass",
    run_id: "candidate-run-abcdef123456",
    candidate: {artifact_key: "c".repeat(64), wikijump_commit: "1".repeat(40), wikijump_tree: "2".repeat(40), ftml_sha: "3".repeat(40)},
    inputs: {denominator: {path: "/tmp/denominator.json", sha256: "d".repeat(64)}, inventory: {path: "/tmp/inventory.json", sha256: "a".repeat(64)}, aggregate: {path: "/tmp/aggregate.json", sha256: "e".repeat(64)}},
    rows: [{surface_id: "surface:00000001", source_local_id: "open43-audit-case:CASE_ONE", kind: "open43_audit_case", status: "pass", artifacts: [candidateArtifact]}],
  };
  const standingArtifact = {path: "/tmp/standing-refresh.json", sha256: "f".repeat(64)};
  const standingMatrix = {
    schema: "wikijump.compatibility_standing_matrix.v2",
    status: "pass",
    run_id: "candidate-run-abcdef123456",
    merge_commit: "4".repeat(40),
    merge_tree: "2".repeat(40),
    ftml_sha: "3".repeat(40),
    ftml_tree: "5".repeat(40),
    candidate_commit: "1".repeat(40),
    candidate_artifact_key: "c".repeat(64),
    promotion_precondition: {path: "/tmp/promotion.json", sha256: "1".repeat(64)},
    standing_refresh: standingArtifact,
    rows: [{surface_id: "surface:00000001", source_local_id: "open43-audit-case:CASE_ONE", kind: "open43_audit_case", status: "pass", artifacts: [standingArtifact]}],
  };
  const reconciled = reconcileCompatibilityLedger({
    ledger: building,
    inventory,
    denominator,
    candidateMap,
    standingMatrix,
    finalFrozenReference: {path: "/tmp/final-frozen.json", sha256: "9".repeat(64)},
  });
  const row = reconciled.rows[0];
  assert.deepEqual(row.actor, {state: "known", value: "anonymous actor"});
  assert.deepEqual(row.owners, {state: "present", specification: ["open43.case:CASE_ONE"], implementation: ["wikijump.deepwell"]});
  assert.deepEqual(row.issues, {state: "present", numbers: [1001]});
  assert.equal(row.blockers.state, "none");
  assert.equal(row.evidence.state, "present");
  assert.equal(row.tests.state, "present");
  assert.match(row.tests.references[0], /^test:artifact:\/tmp\/case-one\.json#sha256=/u);
  assert.deepEqual(row.candidate, {state: "pass", artifacts: [candidateArtifact]});
  assert.deepEqual(row.standing, {state: "pass", artifacts: [standingArtifact]});
  assert.equal(row.closure.state, "closed");

  const noOwner = structuredClone(inventory);
  noOwner.surfaces[0].implementation_owners = [];
  assert.throws(
    () => reconcileCompatibilityLedger({ledger: building, inventory: noOwner, denominator, candidateMap, standingMatrix, finalFrozenReference: {path: "/tmp/final-frozen.json", sha256: "9".repeat(64)}}),
    /final reconciliation has no implementation owner/u,
  );
});
