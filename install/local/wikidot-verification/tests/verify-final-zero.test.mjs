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

function denominator() {
  return {
    schema: "wikijump.compatibility_final_zero_denominator.v1",
    untyped_edge_count: 0,
    charter_requirements: [{id: "phase-4-6", status: "represented"}],
    rows: [{
      surface_id: surfaceId,
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
    rows: [{surface_id: surfaceId}],
  }));
  const denominatorPath = path.join(root, "denominator.json");
  await fs.writeFile(denominatorPath, JSON.stringify(denominator()));
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
  return {root, ledgerPath, denominatorPath, matrixPath};
}

test("final-zero CLI requires the exact direct input set", () => {
  assert.deepEqual(parseArgs([
    "--ledger", "ledger.json",
    "--denominator", "denominator.json",
    "--standing-matrix", "standing.json",
    "--output", "receipt.json",
  ]), {
    ledger: path.resolve("ledger.json"),
    denominator: path.resolve("denominator.json"),
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
    standingMatrix: inputs.matrixPath,
  });
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.merge_commit, mergeCommit);
  assert.deepEqual(Object.values(receipt.counts), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const changedMatrix = JSON.parse(await fs.readFile(inputs.matrixPath, "utf8"));
  changedMatrix.rows[0].artifacts[0].sha256 = sha256("different standing proof\n");
  await fs.writeFile(inputs.matrixPath, JSON.stringify(changedMatrix));
  await assert.rejects(
    verifyFinalZero({
      ledger: inputs.ledgerPath,
      denominator: inputs.denominatorPath,
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
      standingMatrix: inputs.matrixPath,
    }),
    /missing_or_failing_candidate_proofs=1/u,
  );
});
