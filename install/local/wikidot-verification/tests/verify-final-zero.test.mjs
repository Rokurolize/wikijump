import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {DEFERRED_SCOPE_ROWS, parseArgs, verifyFinalZero} from "../scripts/verify-final-zero.mjs";

const repository = path.resolve(new URL("../../../..", import.meta.url).pathname);
const mergeCommit = execFileSync("git", ["-C", repository, "rev-parse", "HEAD^{commit}"], {encoding: "utf8"}).trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const surfaceId = "surface:00000001";
const currentSourceId = "catalog-feature:phase-4-6";
const deferredRows = DEFERRED_SCOPE_ROWS.map(([source_local_id, kind]) => ({source_local_id, kind}));

function inventory() {
  return {
    schema: "wikijump.compatibility_surface_inventory.v2",
    surfaces: [{surface_id: currentSourceId, kind: "catalog_feature"}],
  };
}

function denominator() {
  return {
    schema: "wikijump.compatibility_final_zero_denominator.v1",
    untyped_edge_count: 0,
    charter_requirements: [{id: "phase-4-6", status: "represented"}],
    rows: [{surface_id: surfaceId, source_local_id: currentSourceId, kind: "catalog_feature", identity: "canonical", public_surface: true, owner: "known", source_provenance: "present", evidence: "resolved", source: "implemented", standards_review: "pass", spec_review: "pass", candidate: "pass", standing: "pass", closure: "closed", issue: "reconciled", charter: "represented"}],
  };
}

async function fixtures() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "final-zero-"));
  const artifact = path.join(root, "standing.json");
  await fs.writeFile(artifact, "standing proof\n", {mode: 0o600});
  const inventoryPath = path.join(root, "inventory.json");
  const inventoryValue = inventory();
  await fs.writeFile(inventoryPath, JSON.stringify(inventoryValue));
  const artifactIdentity = {path: artifact, sha256: sha256("standing proof\n")};
  const ledgerPath = path.join(root, "ledger.json");
  const inventorySha256 = sha256(JSON.stringify(inventoryValue));
  await fs.writeFile(ledgerPath, JSON.stringify({
    schema: "wikijump.compatibility_ledger.v1",
    counts: {raw_records: 2, public_inventory_records: 1, canonical_surfaces: 1, input_alias_edges: 0, deduplication_relationships: 0},
    inputs: {inventory: {path: inventoryPath, sha256: inventorySha256}, wikijump: {}, ftml: {}},
    rows: [{surface_id: surfaceId, actor: {}, input: {}, observable_interval: {}, result: {}, source: {state: "present", bindings: []}, evidence: {state: "present", references: []}, tests: {}, owners: {}, issues: {}, blockers: {state: "none", numbers: []}, candidate: {state: "pass", artifacts: []}, standing: {state: "pass", artifacts: [artifactIdentity]}, closure: {state: "closed", references: []}}],
  }));
  const denominatorPath = path.join(root, "denominator.json");
  await fs.writeFile(denominatorPath, JSON.stringify(denominator()));
  const deferredDenominatorPath = path.join(root, "deferred-denominator.json");
  await fs.writeFile(deferredDenominatorPath, JSON.stringify({schema: "wikijump.compatibility_deferred_denominator.v1", rows: deferredRows}));
  const deferredLedgerPath = path.join(root, "deferred-ledger.json");
  await fs.writeFile(deferredLedgerPath, JSON.stringify({schema: "wikijump.compatibility_deferred_ledger.v1", rows: deferredRows}));
  const matrixPath = path.join(root, "standing-matrix.json");
  await fs.writeFile(matrixPath, JSON.stringify({schema: "wikijump.compatibility_standing_matrix.v1", merge_commit: mergeCommit, rows: [{surface_id: surfaceId, status: "pass", artifacts: [artifactIdentity]}]}));
  return {root, repository, inventoryPath, ledgerPath, denominatorPath, deferredDenominatorPath, deferredLedgerPath, matrixPath};
}

function inputMap(input) {
  return {ledger: input.ledgerPath, inventory: input.inventoryPath, denominator: input.denominatorPath, deferredDenominator: input.deferredDenominatorPath, deferredLedger: input.deferredLedgerPath, standingMatrix: input.matrixPath, repository: input.repository};
}

function cliArgs(input) {
  return ["--ledger", input.ledgerPath, "--inventory", input.inventoryPath, "--denominator", input.denominatorPath, "--deferred-denominator", input.deferredDenominatorPath, "--deferred-ledger", input.deferredLedgerPath, "--standing-matrix", input.matrixPath, "--repository", input.repository, "--output", path.join(input.root, "receipt.json")];
}

test("final-zero requires the canonical ledger, frozen inventory, and exact direct input set", async () => {
  const input = await fixtures();
  assert.equal(parseArgs(cliArgs(input)).inventory, path.resolve(input.inventoryPath));
  assert.throws(() => parseArgs(cliArgs(input).filter((value) => value !== "--inventory" && value !== input.inventoryPath)), /required/u);
});

test("final-zero binds canonical IDs, kinds, row artifacts, and the exact deferred union", async () => {
  const input = await fixtures();
  const receipt = await verifyFinalZero(inputMap(input));
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.inputs.inventory.path, path.resolve(input.inventoryPath));
  assert.equal(deferredRows.length, 39);
  const denominatorValue = JSON.parse(await fs.readFile(input.denominatorPath, "utf8"));
  denominatorValue.rows[0].kind = "wrong_kind";
  await fs.writeFile(input.denominatorPath, JSON.stringify(denominatorValue));
  await assert.rejects(verifyFinalZero(inputMap(input)), /frozen inventory ID\/kind/u);
});

test("final-zero rejects swapped standing artifacts and a noncanonical deferred union", async () => {
  const input = await fixtures();
  const matrix = JSON.parse(await fs.readFile(input.matrixPath, "utf8"));
  matrix.rows[0].artifacts[0].sha256 = sha256("other\n");
  await fs.writeFile(input.matrixPath, JSON.stringify(matrix));
  await assert.rejects(verifyFinalZero(inputMap(input)), /mismatched SHA-256/u);
  matrix.rows[0].artifacts[0].sha256 = sha256("standing proof\n");
  await fs.writeFile(input.matrixPath, JSON.stringify(matrix));
  const deferred = JSON.parse(await fs.readFile(input.deferredLedgerPath, "utf8"));
  deferred.rows = deferred.rows.slice(0, -1);
  await fs.writeFile(input.deferredLedgerPath, JSON.stringify(deferred));
  await assert.rejects(verifyFinalZero(inputMap(input)), /does not exactly own the deferred denominator/u);
});
