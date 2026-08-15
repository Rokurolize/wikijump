import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {main, parseArgs, verifyFinalZero} from "../scripts/verify-final-zero.mjs";

const mergeCommit = "0123456789abcdef0123456789abcdef01234567";

function deferredExclusions() {
  const records = [
    ...Array.from({length: 15}, (_, index) => ({
      source_local_id: `catalog-feature:api-${String(index + 1).padStart(2, "0")}`,
      kind: "catalog_feature",
      deferred_owner: "wikijump.xmlrpc-api",
    })),
    ...Array.from({length: 17}, (_, index) => ({
      source_local_id: `framerail-xmlrpc:method-${String(index + 1).padStart(2, "0")}`,
      kind: "framerail_xmlrpc_method",
      deferred_owner: "wikijump.xmlrpc-api",
    })),
    ...Array.from({length: 22}, (_, index) => ({
      source_local_id: `wikidot-py-amc-module:module-${String(index + 1).padStart(2, "0")}`,
      kind: "wikidot_py_amc_module_shape",
      deferred_owner: "external.wikidot-py",
    })),
  ];
  return {
    count: records.length,
    by_kind: {
      catalog_feature: 15,
      framerail_xmlrpc_method: 17,
      wikidot_py_amc_module_shape: 22,
    },
    by_owner: {
      "external.wikidot-py": 22,
      "wikijump.xmlrpc-api": 32,
    },
    records,
  };
}

function ledger(overrides = {}) {
  const row = {
    surface_id: "surface:00000001",
    source: {state: "present", bindings: [{source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001"}]},
    evidence: {state: "present", references: [{path: "/tmp/inventory.json", sha256: "a".repeat(64)}]},
    tests: {state: "present", references: ["test:review.js#case"]},
    owners: {state: "present", specification: ["spec:a"], implementation: ["impl:a"]},
    issues: {state: "present", numbers: [1365]},
    blockers: {state: "none", numbers: []},
    candidate: {state: "pass", artifacts: [{path: "/tmp/candidate.json", sha256: "b".repeat(64)}]},
    standing: {state: "pass", artifacts: [{path: "/tmp/standing.json", sha256: "c".repeat(64)}]},
    closure: {state: "closed", references: ["test:review.js#case"]},
    ...overrides,
  };
  return {
    schema: "wikijump.compatibility_ledger.v1",
    counts: {raw_records: 1, public_inventory_records: 1, canonical_surfaces: 1, input_alias_edges: 0, deduplication_relationships: 0},
    inputs: {},
    source_manifests: [],
    raw_source_records: [{source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001", record_sha256: "d".repeat(64)}],
    source_local_identities: [{source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001", source_local_id: "catalog-feature:one"}],
    surface_assignments: [],
    relationships: [],
    deferred_exclusions: deferredExclusions(),
    rows: [row],
  };
}

async function fixtures(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "final-zero-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const input = {
    root,
    ledger: path.join(root, "ledger.json"),
    standingMatrix: path.join(root, "standing.json"),
  };
  await fs.writeFile(input.ledger, JSON.stringify(ledger()));
  await fs.writeFile(input.standingMatrix, JSON.stringify({producer: "standing", merge_commit: mergeCommit}));
  return input;
}

function inputMap(input) {
  return {ledger: input.ledger, standingMatrix: input.standingMatrix};
}

test("final-zero consumes the sealed canonical ledger and binds its digest and merge identity", async (t) => {
  const input = await fixtures(t);
  const receipt = await verifyFinalZero(inputMap(input));
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.merge_commit, mergeCommit);
  assert.deepEqual(Object.keys(receipt.inputs).sort(), ["ledger", "standing_matrix"]);
  const output = path.join(input.root, "receipt.json");
  const args = ["--ledger", input.ledger, "--standing-matrix", input.standingMatrix, "--output", output];
  assert.equal(await main(args, {stdout: () => {}}), 0);
  assert.equal(await main(args, {stdout: () => {}}), 0);
});

test("final-zero consumes the builder exclusion audit and rejects a realistic catalog leak", async (t) => {
  const input = await fixtures(t);
  const value = JSON.parse(await fs.readFile(input.ledger, "utf8"));
  const leaked = value.deferred_exclusions.records.find(({kind}) => kind === "catalog_feature");
  value.raw_source_records.push({source_manifest_id: "manifest:00000002", raw_record_id: "raw:00000002", record_sha256: "e".repeat(64)});
  value.source_local_identities.push({source_manifest_id: "manifest:00000002", raw_record_id: "raw:00000002", source_local_id: leaked.source_local_id});
  await fs.writeFile(input.ledger, JSON.stringify(value));
  await assert.rejects(verifyFinalZero(inputMap(input)), /contains deferred work.*catalog-feature:api-01/u);
});

test("final-zero reports a canonical row failure", async (t) => {
  const input = await fixtures(t);
  const value = JSON.parse(await fs.readFile(input.ledger, "utf8"));
  value.rows[0].candidate = {state: "fail", artifacts: []};
  await fs.writeFile(input.ledger, JSON.stringify(value));
  await assert.rejects(verifyFinalZero(inputMap(input)), /missing_or_failing_candidate_proofs=1/u);
});

test("final-zero CLI has no test-only denominator input", async (t) => {
  const input = await fixtures(t);
  const args = ["--ledger", input.ledger, "--standing-matrix", input.standingMatrix, "--output", path.join(input.root, "receipt.json")];
  assert.deepEqual(parseArgs(args), {
    ledger: input.ledger,
    "standing-matrix": input.standingMatrix,
    output: path.join(input.root, "receipt.json"),
  });
  assert.throws(() => parseArgs([...args, "--denominator", path.join(input.root, "unused.json")]), /unknown or duplicate option/u);
});
