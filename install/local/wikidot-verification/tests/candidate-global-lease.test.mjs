import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { withCandidateGlobalLease } from "../src/candidate-global-lease.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-global-lease-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return {root, lockPath: path.join(root, "candidate.lock")};
}

test("candidate CLI lease publishes one exact run identity and releases it", async (t) => {
  const {root, lockPath} = await fixture(t);
  const evidenceDirectory = path.join(root, "evidence");
  const runId = "candidate-run-0123456789ab";
  const result = await withCandidateGlobalLease({runId, evidenceDirectory, lockPath}, async () => {
    const receipt = JSON.parse(await fs.readFile(lockPath, "utf8"));
    assert.equal(receipt.schema, "wikijump.candidate_global_lock.v1");
    assert.equal(receipt.run_id, runId);
    assert.equal(receipt.evidence_directory, evidenceDirectory);
    assert.match(receipt.lease_id, /^[0-9a-f]{32}$/u);
    await assert.rejects(
      withCandidateGlobalLease({runId, evidenceDirectory, lockPath}, async () => null),
      (error) => error?.code === "EEXIST",
    );
    return "pass";
  });
  assert.equal(result, "pass");
  await assert.rejects(fs.stat(lockPath), (error) => error?.code === "ENOENT");
});

test("candidate CLI lease releases the lock after an operation failure", async (t) => {
  const {root, lockPath} = await fixture(t);
  await assert.rejects(
    withCandidateGlobalLease(
      {runId: "candidate-run-fedcba987654", evidenceDirectory: root, lockPath},
      async () => {
        throw new Error("fixture failure");
      },
    ),
    /fixture failure/u,
  );
  await assert.rejects(fs.stat(lockPath), (error) => error?.code === "ENOENT");
});

test("candidate CLI lease never removes a replacement lock", async (t) => {
  const {root, lockPath} = await fixture(t);
  await assert.rejects(
    withCandidateGlobalLease(
      {runId: "candidate-run-aabbccddeeff", evidenceDirectory: root, lockPath},
      async () => {
        await fs.unlink(lockPath);
        await fs.writeFile(lockPath, "replacement\n", {mode: 0o600, flag: "wx"});
      },
    ),
    /ownership changed before release/u,
  );
  assert.equal(await fs.readFile(lockPath, "utf8"), "replacement\n");
});
