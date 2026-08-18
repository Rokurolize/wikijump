import assert from "node:assert/strict";
import test from "node:test";

import {reconcileCompatibilityLedger} from "../src/compatibility-ledger-reconciliation.mjs";

const reference = {path: "/tmp/inventory.json", sha256: "a".repeat(64)};

function fixture() {
  return {
    inventory: {
      schema: "wikijump.compatibility_surface_inventory.v2",
      surfaces: [{
        surface_id: "catalog-feature:example",
        kind: "catalog_feature",
        public_reference: ["docs/spec.md"],
        specification_owner: "catalog.feature:example",
        implementation_owners: [],
        source: {status: "implemented", references: ["deepwell/src/example.rs"]},
        evidence: {status: "available", references: ["docs/spec.md"]},
        existing_refs: {issues: [], cases: [], tests: ["deepwell/tests/example.rs#public_example"]},
        candidate: {status: "pending", references: []},
        standing: {status: "pending", references: []},
        closure: {status: "open", references: []},
      }],
    },
    ledger: {
      schema: "wikijump.compatibility_ledger.v1",
      source_local_identities: [{raw_record_id: "raw:00000001", source_local_id: "catalog-feature:example"}],
      surface_assignments: [{surface_id: "surface:00000001", raw_record_id: "raw:00000001"}],
      rows: [{surface_id: "surface:00000001", actor: {}, input: {}, observable_interval: {}, result: {}, source: {}, evidence: {}, tests: {}, owners: {}, issues: {}, blockers: {}, candidate: {}, standing: {}, closure: {}}],
    },
  };
}

test("reconciliation fills semantic values and public ownership without hand-shaped row state", () => {
  const {inventory, ledger} = fixture();
  const result = reconcileCompatibilityLedger({inventory, inventoryReference: reference, ledger});
  const row = result.rows[0];
  assert.equal(row.actor.state, "known");
  assert.equal(row.input.state, "known");
  assert.equal(row.observable_interval.state, "known");
  assert.equal(row.result.state, "known");
  assert.deepEqual(row.owners, {state: "present", specification: ["catalog.feature:example"], implementation: ["wikijump.deepwell"]});
  assert.deepEqual(row.issues, {state: "present", numbers: [1354]});
  assert.equal(row.tests.state, "present");
  assert.equal(row.candidate.state, "pending");
  assert.equal(row.standing.state, "pending");
  assert.equal(row.closure.state, "open");
});

test("reconciliation closes only after exact candidate and standing row proofs exist", () => {
  const {inventory, ledger} = fixture();
  const candidateMap = {schema: "wikijump.compatibility_candidate_row_proof_map.v1", status: "pass", rows: [{surface_id: "surface:00000001"}]};
  const standingMatrix = {schema: "wikijump.compatibility_standing_matrix.v2", status: "pass", rows: [{surface_id: "surface:00000001"}]};
  const result = reconcileCompatibilityLedger({
    inventory,
    inventoryReference: reference,
    ledger,
    candidateMap,
    candidateMapReference: {path: "/tmp/candidate-map.json", sha256: "b".repeat(64)},
    standingMatrix,
    standingMatrixReference: {path: "/tmp/standing-matrix.json", sha256: "c".repeat(64)},
  });
  assert.equal(result.rows[0].candidate.state, "pass");
  assert.equal(result.rows[0].standing.state, "pass");
  assert.equal(result.rows[0].closure.state, "closed");
});

