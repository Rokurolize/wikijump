import assert from "node:assert/strict";
import test from "node:test";

import {buildCandidateRowProofMap} from "../src/compatibility-candidate-row-map.mjs";

const ref = {path: "/tmp/aggregate.json", sha256: "a".repeat(64)};
const ledger = {schema: "wikijump.compatibility_ledger.v1", inputs: {wikijump: {commit: "1".repeat(40), tree: "2".repeat(40)}, ftml: {commit: "3".repeat(40)}}};
const denominator = {schema: "wikijump.compatibility_final_zero_denominator.v1", status: "sealed", rows: [{surface_id: "surface:00000001", source_local_id: "open43-audit-case:CASE", kind: "open43_audit_case"}]};
const aggregate = {schema: "wikijump.candidate_campaign_aggregate.v1", status: "pass", run_id: "candidate-run-0123456789ab", candidate: {artifact_key: "b".repeat(64), wikijump_commit: "1".repeat(40), wikijump_tree: "2".repeat(40), ftml_sha: "3".repeat(40)}, cases: [{case_id: "CASE", path: "/tmp/case.json", sha256: "c".repeat(64)}]};

test("candidate row map binds exact case artifacts when the row has an execution owner", () => {
  const inventory = {schema: "wikijump.compatibility_surface_inventory.v2", surfaces: [{surface_id: "open43-audit-case:CASE", kind: "open43_audit_case", existing_refs: {cases: ["CASE"]}, candidate: {status: "pending"}}]};
  const value = buildCandidateRowProofMap({inventory, ledger, denominator, aggregate, aggregateReference: ref});
  assert.equal(value.rows[0].basis, "exact_candidate_case");
  assert.deepEqual(value.rows[0].artifacts, [{path: "/tmp/case.json", sha256: "c".repeat(64)}]);
});

test("candidate row map refuses to convert a blocked current row into pass", () => {
  const inventory = {schema: "wikijump.compatibility_surface_inventory.v2", surfaces: [{surface_id: "open43-audit-case:CASE", kind: "open43_audit_case", existing_refs: {cases: ["CASE"]}, candidate: {status: "blocked"}}]};
  assert.throws(() => buildCandidateRowProofMap({inventory, ledger, denominator, aggregate, aggregateReference: ref}), /blocked by 1 current rows/u);
});

