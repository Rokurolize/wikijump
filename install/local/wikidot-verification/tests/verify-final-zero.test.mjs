import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {DEFERRED_SCOPE_ROWS, parseArgs, verifyFinalZero} from "../scripts/verify-final-zero.mjs";

const surfaceId = "surface:00000001";
const repository = path.resolve(new URL("../../../..", import.meta.url).pathname);
const mergeCommit = execFileSync("git", ["-C", repository, "rev-parse", "HEAD^{commit}"], {encoding: "utf8"}).trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const currentSourceId = "catalog-feature:phase-4-6";
const deferredRows = DEFERRED_SCOPE_ROWS.map(([source_local_id, kind]) => ({source_local_id, kind}));

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
  return {root, repository, ledgerPath, denominatorPath, deferredDenominatorPath, deferredLedgerPath, matrixPath};
}

test("final-zero CLI requires the exact direct input set", () => {
  assert.deepEqual(parseArgs([
    "--ledger", "ledger.json",
    "--denominator", "denominator.json",
    "--deferred-denominator", "deferred-denominator.json",
    "--deferred-ledger", "deferred-ledger.json",
    "--standing-matrix", "standing.json",
    "--repository", repository,
    "--output", "receipt.json",
  ]), {
    ledger: path.resolve("ledger.json"),
    denominator: path.resolve("denominator.json"),
    "deferred-denominator": path.resolve("deferred-denominator.json"),
    "deferred-ledger": path.resolve("deferred-ledger.json"),
    "standing-matrix": path.resolve("standing.json"),
    repository,
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
    repository: inputs.repository,
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
      repository: inputs.repository,
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
      repository: inputs.repository,
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
        repository: inputs.repository,
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
      repository: inputs.repository,
    }),
    /source-local identities and kinds differ from the current denominator/u,
  );
});

test("final-zero scope admission requires the deferred ledger exact union", async () => {
  const inputs = await fixtures();
  assert.equal(deferredRows.length, 39);
  const verify = () => verifyFinalZero({
    ledger: inputs.ledgerPath,
    denominator: inputs.denominatorPath,
    deferredDenominator: inputs.deferredDenominatorPath,
    deferredLedger: inputs.deferredLedgerPath,
    standingMatrix: inputs.matrixPath,
    repository: inputs.repository,
  });
  const deferred = JSON.parse(await fs.readFile(inputs.deferredLedgerPath, "utf8"));

  deferred.rows = deferred.rows.slice(0, 1);
  await fs.writeFile(inputs.deferredLedgerPath, JSON.stringify(deferred));
  await assert.rejects(verify(), /does not exactly own the deferred denominator/u);

  deferred.rows = [...deferredRows, deferredRows[0]];
  await fs.writeFile(inputs.deferredLedgerPath, JSON.stringify(deferred));
  await assert.rejects(verify(), /duplicate source-local identities/u);

  deferred.rows = structuredClone(deferredRows);
  deferred.rows[17].kind = "framerail_xmlrpc_method";
  await fs.writeFile(inputs.deferredLedgerPath, JSON.stringify(deferred));
  await assert.rejects(verify(), /invalid kind for its source-local identity/u);

  deferred.rows = [...deferredRows, {
    source_local_id: "wikidot-py-amc-module:fake-matching-prefix",
    kind: "wikidot_py_amc_module_shape",
  }];
  await fs.writeFile(inputs.deferredLedgerPath, JSON.stringify(deferred));
  await assert.rejects(verify(), /unknown deferred source-local identity/u);

  const deferredDenominator = JSON.parse(await fs.readFile(inputs.deferredDenominatorPath, "utf8"));
  deferredDenominator.rows[0] = {
    source_local_id: "framerail-xmlrpc:fake-matching-prefix",
    kind: "framerail_xmlrpc_method",
  };
  await fs.writeFile(inputs.deferredDenominatorPath, JSON.stringify(deferredDenominator));
  await assert.rejects(verify(), /unknown deferred source-local identity/u);
});

test("final-zero rejects a merge commit that is not the repository HEAD", async () => {
  const inputs = await fixtures();
  const matrix = JSON.parse(await fs.readFile(inputs.matrixPath, "utf8"));
  matrix.merge_commit = "0123456789abcdef0123456789abcdef01234567";
  await fs.writeFile(inputs.matrixPath, JSON.stringify(matrix));
  await assert.rejects(
    verifyFinalZero({
      ledger: inputs.ledgerPath,
      denominator: inputs.denominatorPath,
      deferredDenominator: inputs.deferredDenominatorPath,
      deferredLedger: inputs.deferredLedgerPath,
      standingMatrix: inputs.matrixPath,
      repository: inputs.repository,
    }),
    /post-merge repository HEAD/u,
  );
});
