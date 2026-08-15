import assert from "node:assert/strict";
import test from "node:test";

import {parseArgs, verdictExitCode} from "../scripts/merge-readiness-report.mjs";
import {buildMergeReadiness} from "../src/deviation-log.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";
const validatorArgs = ["--validator", "static=static.json", "--validator", "candidate=candidate.json", "--validator", "browser=browser.json", "--validator", "cleanup=cleanup.json"];

test("merge readiness rejects unknown verdict shapes", () => {
  assert.equal(verdictExitCode({}), 2);
  assert.equal(verdictExitCode({aggregate: {}}), 2);
  assert.equal(verdictExitCode({status: "pass"}), 2);
  assert.equal(verdictExitCode({schema: "wikijump_syntax_differential.runtime_stack_cleanup.v1", status: "pass"}), 0);
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
