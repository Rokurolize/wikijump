import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {parseArgs, verifyFinalZero} from "../scripts/verify-final-zero.mjs";

const surfaceId = "surface:00000001";
const mergeCommit = "0123456789abcdef0123456789abcdef01234567";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const currentSourceId = "catalog-feature:phase-4-6";
const deferredRows = [
  {
    source_local_id: "wikidot-py-amc-module:edit/EditMetaModule:parameters=pageId",
    kind: "wikidot_py_amc_module_shape",
  },
  {
    source_local_id: "framerail-xmlrpc:pages.get_one",
    kind: "framerail_xmlrpc_method",
  },
];

function denominator() {
  return {
    schema: "wikijump.compatibility_final_zero_denominator.v1",
    untyped_edge_count: 0,
    charter_requirements: [{id: "phase-4-6", status: "represented"}],
    rows: [{
      surface_id: surfaceId,
      source_local_id: currentSourceId,
      kind: "catalog_feature",
      identity: "canonical",
      public_surface: true,
      owner: "known",
      source_provenance: "present",
      evidence: "resolved",
      source: "implemented",
      standards_review: "pass",
      spec_review: "pass",
      candidate: "pass",
      standing: "pass",
      closure: "closed",
      issue: "reconciled",
      charter: "represented",
    }],
  };
}

async function fixtures() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "final-zero-"));
  const artifact = path.join(root, "standing.json");
  await fs.writeFile(artifact, "standing proof\n", {mode: 0o600});
  const ledgerPath = path.join(root, "ledger.json");
  await fs.writeFile(ledgerPath, JSON.stringify({
    schema: "wikijump.compatibility_ledger.v1",
    counts: {canonical_surfaces: 1},
    rows: [{surface_id: surfaceId, source_local_id: currentSourceId, kind: "catalog_feature"}],
  }));
  const denominatorPath = path.join(root, "denominator.json");
  await fs.writeFile(denominatorPath, JSON.stringify(denominator()));
  const deferredDenominatorPath = path.join(root, "deferred-denominator.json");
  await fs.writeFile(deferredDenominatorPath, JSON.stringify({
    schema: "wikijump.compatibility_deferred_denominator.v1",
    rows: deferredRows,
  }));
  const deferredLedgerPath = path.join(root, "deferred-ledger.json");
  await fs.writeFile(deferredLedgerPath, JSON.stringify({
    schema: "wikijump.compatibility_deferred_ledger.v1",
    rows: deferredRows,
  }));
  const matrixPath = path.join(root, "standing-matrix.json");
  await fs.writeFile(matrixPath, JSON.stringify({
    schema: "wikijump.compatibility_standing_matrix.v1",
    merge_commit: mergeCommit,
    rows: [{
      surface_id: surfaceId,
      status: "pass",
      artifacts: [{path: artifact, sha256: sha256("standing proof\n")}],
    }],
  }));
  return {root, ledgerPath, denominatorPath, deferredDenominatorPath, deferredLedgerPath, matrixPath};
}

test("final-zero CLI requires the exact direct input set", () => {
  assert.deepEqual(parseArgs([
    "--ledger", "ledger.json",
    "--denominator", "denominator.json",
    "--deferred-denominator", "deferred-denominator.json",
    "--deferred-ledger", "deferred-ledger.json",
    "--standing-matrix", "standing.json",
    "--output", "receipt.json",
  ]), {
    ledger: path.resolve("ledger.json"),
    denominator: path.resolve("denominator.json"),
    "deferred-denominator": path.resolve("deferred-denominator.json"),
    "deferred-ledger": path.resolve("deferred-ledger.json"),
    "standing-matrix": path.resolve("standing.json"),
    output: path.resolve("receipt.json"),
  });
  assert.throws(() => parseArgs(["--ledger", "a", "--ledger", "b"]), /duplicate/u);
  assert.throws(() => parseArgs(["--ledger", "a"]), /required/u);
});

test("final-zero verification independently reconciles the ledger and standing matrix", async () => {
  const inputs = await fixtures();
  const receipt = await verifyFinalZero({
    ledger: inputs.ledgerPath,
    denominator: inputs.denominatorPath,
    deferredDenominator: inputs.deferredDenominatorPath,
    deferredLedger: inputs.deferredLedgerPath,
    standingMatrix: inputs.matrixPath,
  });
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.merge_commit, mergeCommit);
  assert.deepEqual(receipt.scope_admission, {
    status: "pass",
    current_deferred_rows: 0,
    deferred_rows: deferredRows.length,
  });
  assert.deepEqual(Object.values(receipt.counts), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const changedMatrix = JSON.parse(await fs.readFile(inputs.matrixPath, "utf8"));
  changedMatrix.rows[0].artifacts[0].sha256 = sha256("different standing proof\n");
  await fs.writeFile(inputs.matrixPath, JSON.stringify(changedMatrix));
  await assert.rejects(
    verifyFinalZero({
      ledger: inputs.ledgerPath,
      denominator: inputs.denominatorPath,
      deferredDenominator: inputs.deferredDenominatorPath,
      deferredLedger: inputs.deferredLedgerPath,
      standingMatrix: inputs.matrixPath,
    }),
    /mismatched SHA-256/u,
  );
  changedMatrix.rows[0].artifacts[0].sha256 = sha256("standing proof\n");
  await fs.writeFile(inputs.matrixPath, JSON.stringify(changedMatrix));

  const failed = JSON.parse(await fs.readFile(inputs.denominatorPath, "utf8"));
  failed.rows[0].candidate = "fail";
  await fs.writeFile(inputs.denominatorPath, JSON.stringify(failed));
  await assert.rejects(
    verifyFinalZero({
      ledger: inputs.ledgerPath,
      denominator: inputs.denominatorPath,
      deferredDenominator: inputs.deferredDenominatorPath,
      deferredLedger: inputs.deferredLedgerPath,
      standingMatrix: inputs.matrixPath,
    }),
    /missing_or_failing_candidate_proofs=1/u,
  );
});

test("final-zero scope admission rejects deferred rows in the current ledger", async () => {
  for (const forbidden of [
    {source_local_id: currentSourceId, kind: "wikidot_py_amc_module_shape"},
    {source_local_id: "wikidot-py-amc-module:unknown", kind: "catalog_feature"},
    {source_local_id: "framerail-xmlrpc:unknown", kind: "catalog_feature"},
    {source_local_id: currentSourceId, kind: "framerail_xmlrpc_method"},
  ]) {
    const inputs = await fixtures();
    const ledger = JSON.parse(await fs.readFile(inputs.ledgerPath, "utf8"));
    ledger.rows[0] = {...ledger.rows[0], ...forbidden};
    await fs.writeFile(inputs.ledgerPath, JSON.stringify(ledger));
    await assert.rejects(
      verifyFinalZero({
        ledger: inputs.ledgerPath,
        denominator: inputs.denominatorPath,
        deferredDenominator: inputs.deferredDenominatorPath,
        deferredLedger: inputs.deferredLedgerPath,
        standingMatrix: inputs.matrixPath,
      }),
      /current compatibility ledger contains deferred scope row/u,
    );
  }

  const inputs = await fixtures();
  const ledger = JSON.parse(await fs.readFile(inputs.ledgerPath, "utf8"));
  ledger.rows[0].source_local_id = "catalog-feature:reclassified";
  await fs.writeFile(inputs.ledgerPath, JSON.stringify(ledger));
  await assert.rejects(
    verifyFinalZero({
      ledger: inputs.ledgerPath,
      denominator: inputs.denominatorPath,
      deferredDenominator: inputs.deferredDenominatorPath,
      deferredLedger: inputs.deferredLedgerPath,
      standingMatrix: inputs.matrixPath,
    }),
    /source-local identities and kinds differ from the current denominator/u,
  );
});

test("final-zero scope admission requires the deferred ledger exact union", async () => {
  const inputs = await fixtures();
  const verify = () => verifyFinalZero({
    ledger: inputs.ledgerPath,
    denominator: inputs.denominatorPath,
    deferredDenominator: inputs.deferredDenominatorPath,
    deferredLedger: inputs.deferredLedgerPath,
    standingMatrix: inputs.matrixPath,
  });
  const deferred = JSON.parse(await fs.readFile(inputs.deferredLedgerPath, "utf8"));

  deferred.rows = deferred.rows.slice(0, 1);
  await fs.writeFile(inputs.deferredLedgerPath, JSON.stringify(deferred));
  await assert.rejects(verify(), /does not exactly own the deferred denominator/u);

  deferred.rows = [...deferredRows, deferredRows[0]];
  await fs.writeFile(inputs.deferredLedgerPath, JSON.stringify(deferred));
  await assert.rejects(verify(), /duplicate source-local identities/u);

  deferred.rows = structuredClone(deferredRows);
  deferred.rows[0].kind = "framerail_xmlrpc_method";
  await fs.writeFile(inputs.deferredLedgerPath, JSON.stringify(deferred));
  await assert.rejects(verify(), /invalid kind for its source-local identity/u);

  deferred.rows = [...deferredRows, {
    source_local_id: "wikidot-py-amc-module:unknown",
    kind: "wikidot_py_amc_module_shape",
  }];
  await fs.writeFile(inputs.deferredLedgerPath, JSON.stringify(deferred));
  await assert.rejects(verify(), /does not exactly own the deferred denominator/u);
});
