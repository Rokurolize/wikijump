import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {parseArgs, requireBrowser, requireCleanup, verdictExitCode, verifyArtifactReference} from "../scripts/merge-readiness-report.mjs";
import {sha256Hex} from "../src/canonical-json.mjs";
import {buildMergeReadiness} from "../src/deviation-log.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";
const validatorArgs = ["--validator", "static=static.json", "--validator", "candidate=candidate.json", "--validator", "browser=browser.json", "--validator", "cleanup=cleanup.json"];

test("merge readiness rejects unknown verdict shapes", () => {
  assert.equal(verdictExitCode({}), 2);
  assert.equal(verdictExitCode({aggregate: {}}), 2);
  assert.equal(verdictExitCode({status: "pass"}), 2);
  assert.equal(verdictExitCode({schema: "wikijump_syntax_differential.runtime_stack_cleanup.v1", status: "pass"}), 0);
});

test("merge readiness consumes the source-owned standing-browser admission receipt", () => {
  const admission = {
    schema: "wikijump.standing_candidate_parity_admission.v1",
    status: "pass",
    candidate_parity_receipt_sha256: "a".repeat(64),
    candidate_identity_sha256: "b".repeat(64),
    live_reference_sha256: "c".repeat(64),
    live_completion_policy_sha256: "d".repeat(64),
    source_runner_sha256: "e".repeat(64),
    source_observation_sha256: "f".repeat(64),
    source_execution_identity_sha256: "1".repeat(64),
    candidate: {wikijump_commit: commit, wikijump_tree: "2".repeat(40), ftml_sha: "3".repeat(40), artifact_key: "a".repeat(64)},
    parity: {
      pairs_total: 1,
      request_gate_final_sha256: "4".repeat(64),
      runtime_identity_sha256: "5".repeat(64),
      ledger_sha256: "6".repeat(64),
      local_artifacts_verified: 3,
    },
  };
  assert.equal(requireBrowser(admission, "candidate-run-ignored", commit, "a".repeat(64)), admission);
  assert.throws(() => requireBrowser({...admission, schema: "wikijump.standing_candidate_parity_receipt.v1"}, "candidate-run", commit, "a".repeat(64)), /source-owned standing-browser admission/u);
});

test("merge readiness requires exactly the four named validators", () => {
  const parsed = parseArgs(["--output", "report.json", "--run-id", "merge-run", "--frozen-candidate-commit", commit, "--pr-head", commit, "--candidate-review-freeze", "freeze.json", ...validatorArgs]);
  assert.equal(parsed.runId, "merge-run");
  assert.throws(() => parseArgs(["--output", "report.json", "--run-id", "merge-run", "--frozen-candidate-commit", commit, "--pr-head", commit, "--candidate-review-freeze", "freeze.json", ...validatorArgs.slice(0, -2)]), /exactly static,candidate,browser,cleanup/u);
  assert.throws(() => parseArgs(["--output", "report.json", "--run-id", "merge-run", "--frozen-candidate-commit", commit, "--pr-head", commit, "--candidate-review-freeze", "freeze.json", ...validatorArgs, "--validator", "other=other.json"]), /exactly static,candidate,browser,cleanup/u);
  assert.throws(() => parseArgs(["--output", "report.json", "--run-id", "merge-run", "--frozen-candidate-commit", commit, "--pr-head", commit, "--allowed-status", "status.json", "--candidate-review-freeze", "freeze.json", ...validatorArgs]), /Unknown argument/u);
});

test("merge readiness reports the sealed candidate run separately from the merge run", () => {
  const report = buildMergeReadiness({runId: "merge-run", validators: [{name: "browser", exitCode: 0}], deviations: [], candidateReviewFreeze: {run_id: "candidate-run"}});
  assert.equal(report.merge_ready, true);
  assert.equal(report.merge_run_id, "merge-run");
  assert.equal(report.candidate_run_id, "candidate-run");
});

test("merge readiness rehashes named producer artifacts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merge-readiness-artifact-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const file = path.join(root, "producer.json");
  const bytes = Buffer.from('{"status":"pass"}\n');
  await fs.writeFile(file, bytes);
  const reference = {path: file, sha256: sha256Hex(bytes), bytes: bytes.length};
  assert.deepEqual(verifyArtifactReference(reference, "producer"), {path: file, sha256: reference.sha256});
  await fs.writeFile(file, '{"status":"fail"}\n');
  assert.throws(() => verifyArtifactReference(reference, "producer"), /identity moved/u);
});

test("merge readiness binds cleanup to the candidate producer receipt", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "merge-readiness-cleanup-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const candidatePath = path.join(root, "candidate.json");
  const bytes = Buffer.from('{"candidate":true}\n');
  await fs.writeFile(candidatePath, bytes);
  const candidate = {path: candidatePath, sha256: sha256Hex(bytes)};
  const cleanup = {
    schema: "wikijump_syntax_differential.runtime_stack_cleanup.v1",
    status: "pass",
    run_id: "candidate-run-abcdef123456",
    run_root_removed: true,
    public_absence_verified: true,
    resources_released: true,
    vacant: true,
    browser_closed: true,
    candidate_receipt: candidate,
  };
  assert.equal(requireCleanup(cleanup, cleanup.run_id, {binding: {candidate_manifest: candidate}, artifacts: [candidate]}), cleanup);
  assert.throws(() => requireCleanup({...cleanup, candidate_receipt: {...candidate, sha256: "0".repeat(64)}}, cleanup.run_id, {artifacts: [candidate]}), /identity moved/u);
});
