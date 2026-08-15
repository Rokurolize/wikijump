import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {main, parseArgs, verifyFinalZero} from "../scripts/verify-final-zero.mjs";

const mergeCommit = "0123456789abcdef0123456789abcdef01234567";

function denominator(overrides = {}) {
  return {
    rows: [{
      surface_id: "surface:00000001",
      source_local_id: "catalog-feature:phase-4-6",
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
      ...overrides,
    }],
    charter_requirements: [{id: "phase-4-6", status: "represented"}],
    untyped_edge_count: 0,
  };
}

async function fixtures(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "final-zero-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const input = {
    root,
    ledger: path.join(root, "ledger.json"),
    denominator: path.join(root, "denominator.json"),
    standingMatrix: path.join(root, "standing.json"),
  };
  await fs.writeFile(input.ledger, JSON.stringify({producer: "canonical-ledger", status: "sealed"}));
  await fs.writeFile(input.denominator, JSON.stringify(denominator()));
  await fs.writeFile(input.standingMatrix, JSON.stringify({producer: "standing", merge_commit: mergeCommit}));
  return input;
}

function inputMap(input) {
  return {ledger: input.ledger, denominator: input.denominator, standingMatrix: input.standingMatrix};
}

test("final-zero accepts sealed producer outputs and binds only their digests and merge identity", async (t) => {
  const input = await fixtures(t);
  const receipt = await verifyFinalZero(inputMap(input));
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.merge_commit, mergeCommit);
  assert.deepEqual(Object.keys(receipt.inputs).sort(), ["denominator", "ledger", "standing_matrix"]);
  const output = path.join(input.root, "receipt.json");
  const args = ["--ledger", input.ledger, "--denominator", input.denominator, "--standing-matrix", input.standingMatrix, "--output", output];
  assert.equal(await main(args, {stdout: () => {}}), 0);
  assert.equal(await main(args, {stdout: () => {}}), 0);
});

test("final-zero rejects deferred work by current kind or source prefix without a deferred ledger", async (t) => {
  for (const row of [{kind: "framerail_xmlrpc_method"}, {source_local_id: "wikidot-py-amc-module:future"}]) {
    const input = await fixtures(t);
    await fs.writeFile(input.denominator, JSON.stringify(denominator(row)));
    await assert.rejects(verifyFinalZero(inputMap(input)), /contains deferred work/u);
  }
});

test("final-zero fails when a named campaign count is nonzero", async (t) => {
  const input = await fixtures(t);
  await fs.writeFile(input.denominator, JSON.stringify(denominator({candidate: "fail"})));
  await assert.rejects(verifyFinalZero(inputMap(input)), /missing_or_failing_candidate_proofs=1/u);
});

test("final-zero CLI requires only canonical ledger, denominator, standing output, and receipt", async (t) => {
  const input = await fixtures(t);
  const args = ["--ledger", input.ledger, "--denominator", input.denominator, "--standing-matrix", input.standingMatrix, "--output", path.join(input.root, "receipt.json")];
  assert.deepEqual(parseArgs(args), {
    ledger: input.ledger,
    denominator: input.denominator,
    "standing-matrix": input.standingMatrix,
    output: path.join(input.root, "receipt.json"),
  });
  assert.throws(() => parseArgs(args.filter((value) => value !== "--standing-matrix" && value !== input.standingMatrix)), /--standing-matrix is required/u);
});
