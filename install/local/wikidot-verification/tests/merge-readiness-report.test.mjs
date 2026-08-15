import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {main, parseArgs, verdictExitCode} from "../scripts/merge-readiness-report.mjs";

test("merge readiness rejects empty and unknown validator shapes", () => {
  assert.equal(verdictExitCode({}), 2);
  assert.equal(verdictExitCode({aggregate: {}}), 2);
  assert.equal(verdictExitCode({status: "pass"}), 2);
});

test("merge readiness records absolute validator inputs and their hashes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merge-readiness-"));
  const verdictPath = path.join(root, "verdict.json");
  const outputPath = path.join(root, "report.json");
  const statusPath = path.join(root, "status.json");
  const identityPath = path.join(root, "identity.json");
  const bytes = JSON.stringify({exit_code: 0});
  await fs.writeFile(verdictPath, bytes);
  const commit = "0123456789abcdef0123456789abcdef01234567";
  await fs.writeFile(statusPath, JSON.stringify({
    schemaVersion: 1,
    state: "OPEN",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    overall: "passing",
    subject: {headSha: commit},
  }));
  await fs.writeFile(identityPath, JSON.stringify({
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    candidate: {run_id: "candidate-run", wikijump_commit: commit, wikijump_tree: "fedcba9876543210fedcba9876543210fedcba98"},
  }));
  assert.deepEqual(parseArgs([
    "--output", outputPath,
    "--run-id", "candidate-run",
    "--frozen-candidate-commit", commit,
    "--pr-head", commit,
    "--allowed-status", statusPath,
    "--candidate-review-freeze", identityPath,
    "--validator", `direct=${verdictPath}`,
  ]).frozenCandidateCommit, commit);
  assert.equal(await main([
    "--output", outputPath,
    "--run-id", "candidate-run",
    "--frozen-candidate-commit", commit,
    "--pr-head", commit,
    "--allowed-status", statusPath,
    "--candidate-review-freeze", identityPath,
    "--validator", `direct=${verdictPath}`,
  ]), 0);
  const report = JSON.parse(await fs.readFile(outputPath, "utf8"));
  assert.deepEqual(report.validators, [{
    name: "direct",
    exit_code: 0,
    path: path.resolve(verdictPath),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }]);
  assert.equal(report.allowed_status.head_sha, commit);
  assert.equal(report.candidate_review_freeze.candidate_commit, commit);
});

test("merge readiness rejects an unallowed status or a stale review freeze", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merge-readiness-negative-"));
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const verdictPath = path.join(root, "verdict.json");
  await fs.writeFile(verdictPath, JSON.stringify({exit_code: 0}));
  const statusPath = path.join(root, "status.json");
  await fs.writeFile(statusPath, JSON.stringify({schemaVersion: 1, state: "OPEN", mergeable: "UNKNOWN", mergeStateStatus: "CLEAN", overall: "passing", subject: {headSha: commit}}));
  const identityPath = path.join(root, "identity.json");
  await fs.writeFile(identityPath, JSON.stringify({schema: "wikijump.standing_candidate_parity_identity.v1", status: "sealed", candidate: {run_id: "candidate-run", wikijump_commit: commit, wikijump_tree: "fedcba9876543210fedcba9876543210fedcba98"}}));
  await assert.rejects(main([
    "--output", path.join(root, "report.json"), "--run-id", "run",
    "--frozen-candidate-commit", commit, "--pr-head", commit,
    "--allowed-status", statusPath, "--candidate-review-freeze", identityPath,
    "--validator", `direct=${verdictPath}`,
  ]), /allowed status/u);
});

test("merge readiness rejects a candidate review freeze from another run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merge-readiness-run-"));
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const verdictPath = path.join(root, "verdict.json");
  const statusPath = path.join(root, "status.json");
  const identityPath = path.join(root, "identity.json");
  await fs.writeFile(verdictPath, JSON.stringify({exit_code: 0}));
  await fs.writeFile(statusPath, JSON.stringify({schemaVersion: 1, state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", overall: "passing", subject: {headSha: commit}}));
  await fs.writeFile(identityPath, JSON.stringify({schema: "wikijump.standing_candidate_parity_identity.v1", status: "sealed", candidate: {run_id: "candidate-run", wikijump_commit: commit, wikijump_tree: "fedcba9876543210fedcba9876543210fedcba98"}}));
  assert.equal(await main([
    "--output", path.join(root, "report.json"), "--run-id", "other-run",
    "--frozen-candidate-commit", commit, "--pr-head", commit,
    "--allowed-status", statusPath, "--candidate-review-freeze", identityPath,
    "--validator", `direct=${verdictPath}`,
  ]), 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "report.json"), "utf8")).blockers.map(({kind}) => kind), ["candidate-run-id-mismatch"]);
});
