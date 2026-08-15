import assert from "node:assert/strict";
import {createHash} from "node:crypto";
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
    actor: {state: "missing", reason: "not_recorded"},
    input: {state: "missing", reason: "not_recorded"},
    observable_interval: {state: "missing", reason: "not_recorded"},
    result: {state: "missing", reason: "not_recorded"},
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
    inputs: {
      inventory: {path: "/tmp/inventory.json", sha256: "a".repeat(64)},
        wikijump: {commit: mergeCommit, tree: "2".repeat(40)},
      ftml: {commit: "3".repeat(40), tree: "4".repeat(40)},
    },
    source_manifests: [{
      source_manifest_id: "manifest:00000001",
      source_class: "wikijump-consolidated-inventory",
      schema_id: "wikijump.compatibility_surface_inventory.v2",
      repository: "Rokurolize/wikijump",
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      path: "/tmp/inventory.json",
      sha256: "a".repeat(64),
    }],
    raw_source_records: [{source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001", record_sha256: "d".repeat(64)}],
    source_local_identities: [{source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001", source_local_id: "catalog-feature:one"}],
    surface_assignments: [{assignment_id: "assignment:00000001", surface_id: "surface:00000001", source_manifest_id: "manifest:00000001", raw_record_id: "raw:00000001"}],
    relationships: [],
    deferred_exclusions: deferredExclusions(),
    rows: [row],
  };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeReceipt(root, name, value) {
  const file = path.join(root, name);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  await fs.writeFile(file, bytes);
  return {path: file, sha256: digest(bytes)};
}

async function standingReceipt(root) {
  const runId = "candidate-run-000000000001";
  const source = {wikijump_sha: mergeCommit, wikijump_tree: "2".repeat(40), ftml_sha: "3".repeat(40)};
  const imageIds = {deepwell: `sha256:${"e".repeat(64)}`, framerail: `sha256:${"f".repeat(64)}`, wws: `sha256:${"a".repeat(64)}`};
  const buildImages = Object.fromEntries(["cache", "caddy", "database", "deepwell", "files", "framerail", "wws"].map((role) => [role, imageIds[role] ?? `sha256:${"b".repeat(64)}`]));
  const precondition = {
    schema: "wikijump.standing_promotion_precondition.v1",
    status: "pass",
    run_id: runId,
    admission: Object.fromEntries(["candidate_parity_receipt_sha256", "candidate_identity_sha256", "live_reference_sha256", "live_completion_policy_sha256", "source_runner_sha256", "source_observation_sha256", "source_execution_identity_sha256"].map((name, index) => [name, String(index + 1).repeat(64)])),
    candidate: {artifact_key: "c".repeat(64), wikijump_commit: source.wikijump_sha, wikijump_tree: source.wikijump_tree, ftml_sha: source.ftml_sha},
    build: {wikijump_commit: source.wikijump_sha, wikijump_tree: source.wikijump_tree, ftml_sha: source.ftml_sha, images: buildImages},
  };
  const preconditionRef = await writeReceipt(root, "promotion-precondition.json", precondition);
  const prepared = {
    schema_version: 1,
    kind: "standing-image-preparation",
    status: "pass",
    run_id: runId,
    ...source,
    dependency_lock_sha256: "d".repeat(64),
    promotion_precondition: preconditionRef,
    images: Object.fromEntries(Object.entries(imageIds).map(([service, id]) => [service, {id, reference: id}])),
  };
  const preparedRef = await writeReceipt(root, "prepared.json", prepared);
  const runtime = {
    schema: "wikijump_syntax_differential.wikijump_runtime_identity.v1",
    identity: {wikijump_sha: source.wikijump_sha, ftml_sha: source.ftml_sha, dependency_lock_sha256: prepared.dependency_lock_sha256, executable_sha256: imageIds.deepwell.slice(7), runtime_config_sha256: "1".repeat(64)},
  };
  const runtimeRef = await writeReceipt(root, "runtime-identity.json", runtime);
  return {
    schema_version: 1,
    kind: "standing-promotion",
    status: "pass",
    run_id: runId,
    ...source,
    dependency_lock_sha256: prepared.dependency_lock_sha256,
    prepared_receipt: preparedRef,
    promotion_precondition: preconditionRef,
    images: prepared.images,
    health: {deepwell: "healthy", framerail: "healthy", wws: "healthy"},
    canary: {status: "pass"},
    runtime_differential_identity: runtimeRef,
    cleanup: {status: "pass", candidate_receipt: preparedRef},
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
  await fs.writeFile(input.standingMatrix, JSON.stringify(await standingReceipt(root)));
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
  value.counts.raw_records = 2;
  await fs.writeFile(input.ledger, JSON.stringify(value));
  await assert.rejects(verifyFinalZero(inputMap(input)), /contains deferred work.*catalog-feature:api-01/u);
});

test("final-zero reports a canonical row failure", async (t) => {
  const input = await fixtures(t);
  const value = JSON.parse(await fs.readFile(input.standingMatrix, "utf8"));
  value.status = "fail";
  await fs.writeFile(input.standingMatrix, JSON.stringify(value));
  await assert.rejects(verifyFinalZero(inputMap(input)), /sealed successful standing promotion receipt/u);
});

test("final-zero rejects incomplete ledgers and arbitrary standing JSON", async (t) => {
  const input = await fixtures(t);
  const incomplete = JSON.parse(await fs.readFile(input.ledger, "utf8"));
  delete incomplete.source_manifests;
  await fs.writeFile(input.ledger, JSON.stringify(incomplete));
  await assert.rejects(verifyFinalZero(inputMap(input)), /missing or unknown fields/u);

  await fs.writeFile(input.ledger, JSON.stringify(ledger()));
  await fs.writeFile(input.standingMatrix, JSON.stringify({producer: "standing", merge_commit: mergeCommit}));
  await assert.rejects(verifyFinalZero(inputMap(input)), /sealed successful standing promotion receipt/u);
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
