import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { withCandidateGlobalLease } from "../src/candidate-global-lease.mjs";

const lockPath = path.join(os.tmpdir(), "wikijump-candidate-run.lock");

test("candidate CLI lease publishes one exact run identity and releases it", async (t) => {
  await fs.rm(lockPath, {force: true});
  t.after(() => fs.rm(lockPath, {force: true}));
  const evidenceDirectory = path.join(os.tmpdir(), "candidate-evidence-fixture");
  const runId = "candidate-run-0123456789ab";
  const result = await withCandidateGlobalLease({runId, evidenceDirectory}, async () => {
    const receipt = JSON.parse(await fs.readFile(lockPath, "utf8"));
    assert.deepEqual(receipt, {
      schema: "wikijump.candidate_global_lock.v1",
      run_id: runId,
      evidence_directory: evidenceDirectory,
    });
    await assert.rejects(
      withCandidateGlobalLease({runId, evidenceDirectory}, async () => null),
      (error) => error?.code === "EEXIST",
    );
    return "pass";
  });
  assert.equal(result, "pass");
  await assert.rejects(fs.stat(lockPath), (error) => error?.code === "ENOENT");
});

test("candidate CLI lease releases the lock after an operation failure", async (t) => {
  await fs.rm(lockPath, {force: true});
  t.after(() => fs.rm(lockPath, {force: true}));
  await assert.rejects(
    withCandidateGlobalLease(
      {runId: "candidate-run-fedcba987654", evidenceDirectory: os.tmpdir()},
      async () => {
        throw new Error("fixture failure");
      },
    ),
    /fixture failure/u,
  );
  await assert.rejects(fs.stat(lockPath), (error) => error?.code === "ENOENT");
});
