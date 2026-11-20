import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNextestExactFilterset,
  evaluateNextestShard,
  parseNextestSummary,
  parseNextestTestOutcomes,
  planTimeoutOnlyRetry,
  stripAnsi,
} from "../src/nextest-shard-summary.mjs";

test("parses plural nextest summaries", () => {
  assert.deepEqual(
    parseNextestSummary("Summary [ 12.345s] 219 tests run: 219 passed"),
    {tests: 219, passed: 219, skipped: 0},
  );
});

test("parses singular nextest summaries", () => {
  assert.deepEqual(
    parseNextestSummary("Summary [  0.123s] 1 test run: 1 passed"),
    {tests: 1, passed: 1, skipped: 0},
  );
});

test("parses skipped tests in nextest summaries", () => {
  assert.deepEqual(
    parseNextestSummary("Summary [  1.234s] 8 tests run: 6 passed, 2 skipped"),
    {tests: 8, passed: 6, skipped: 2},
  );
});

test("fails closed when a successful child has no parseable summary", () => {
  assert.deepEqual(evaluateNextestShard({code: 0, signal: null, text: "done\n"}), {
    ok: false,
    summary: null,
    missingSuccessfulSummary: true,
  });
});

test("preserves child failure when a summary is parseable", () => {
  assert.deepEqual(
    evaluateNextestShard({
      code: 1,
      signal: null,
      text: "Summary [  1.234s] 8 tests run: 7 passed, 1 skipped",
    }),
    {
      ok: false,
      summary: {tests: 8, passed: 7, skipped: 1},
      missingSuccessfulSummary: false,
    },
  );
});

test("strips ANSI escapes before parsing nextest outcomes and plans timeout-only retry", () => {
  const esc = String.fromCharCode(0x1b);
  const shardOne = [
    `${esc}[32m        PASS${esc}[0m [   0.450s] deepwell::page fast_test`,
    `${esc}[31m     TIMEOUT${esc}[0m [  15.002s] deepwell::page contention::timed_out_alpha`,
    `     TIMEOUT [  15.004s] (12/20) deepwell::list_pages contention::timed_out_beta`,
    "     Summary [  31.200s] 3 tests run: 1 passed, 2 timed out",
  ].join("\n");
  const shardTwo = [
    "     TIMEOUT [  15.002s] deepwell::page contention::timed_out_alpha",
    "        PASS [   0.200s] deepwell::auth ok_test",
    "     Summary [  15.202s] 2 tests run: 1 passed, 1 timed out",
  ].join("\n");

  assert.equal(stripAnsi(`${esc}[31mTIMEOUT${esc}[0m`), "TIMEOUT");
  const outcomes = parseNextestTestOutcomes(shardOne);
  assert.deepEqual(outcomes.timedOut, [
    {binaryId: "deepwell::page", testName: "contention::timed_out_alpha"},
    {binaryId: "deepwell::list_pages", testName: "contention::timed_out_beta"},
  ]);
  assert.deepEqual(outcomes.nonTimeoutFailed, []);

  const plan = planTimeoutOnlyRetry([
    {shard: 1, code: 100, signal: null, text: shardOne},
    {shard: 2, code: 100, signal: null, text: shardTwo},
    {shard: 3, code: 0, signal: null, text: "     Summary [  1.000s] 10 tests run: 10 passed\n"},
  ]);
  assert.equal(plan.shouldRetry, true);
  assert.equal(plan.reason, "timeout-only");
  assert.deepEqual(plan.retryTargets, [
    {binaryId: "deepwell::page", testName: "contention::timed_out_alpha"},
    {binaryId: "deepwell::list_pages", testName: "contention::timed_out_beta"},
  ]);
  assert.equal(
    buildNextestExactFilterset(plan.retryTargets),
    "(binary_id(=deepwell::page) & test(=contention::timed_out_alpha)) | (binary_id(=deepwell::list_pages) & test(=contention::timed_out_beta))",
  );
});

test("fails closed without retry on functional FAIL, mixed TIMEOUT+FAIL, compile errors, or signals", () => {
  const mixedPlan = planTimeoutOnlyRetry([
    {
      shard: 1,
      code: 100,
      signal: null,
      text: [
        "     TIMEOUT [  15.001s] deepwell::page timed_out_one",
        "        FAIL [   0.042s] deepwell::page broken_assertion",
        "     Summary [  15.043s] 2 tests run: 0 passed, 1 failed, 1 timed out",
      ].join("\n"),
    },
  ]);
  assert.equal(mixedPlan.shouldRetry, false);
  assert.equal(mixedPlan.reason, "non-timeout-failure");

  const failPlusTimeoutShardPlan = planTimeoutOnlyRetry([
    {
      shard: 1,
      code: 100,
      signal: null,
      text: "     TIMEOUT [  15.001s] deepwell::page timed_out_one\n",
    },
    {
      shard: 2,
      code: 100,
      signal: null,
      text: "   FAIL + LEAK [   0.100s] deepwell::page leaked_failure\n",
    },
  ]);
  assert.equal(failPlusTimeoutShardPlan.shouldRetry, false);
  assert.equal(failPlusTimeoutShardPlan.reason, "non-timeout-failure");

  const compileErrorPlan = planTimeoutOnlyRetry([
    {
      shard: 1,
      code: 101,
      signal: null,
      text: "error[E0425]: cannot find value `oops` in this scope\n",
    },
  ]);
  assert.equal(compileErrorPlan.shouldRetry, false);
  assert.equal(compileErrorPlan.reason, "no-timeouts-found");

  const signaledPlan = planTimeoutOnlyRetry([
    {
      shard: 1,
      code: null,
      signal: "SIGTERM",
      text: "     TIMEOUT [  15.001s] deepwell::page timed_out_one\n",
    },
  ]);
  assert.equal(signaledPlan.shouldRetry, false);
  assert.equal(signaledPlan.reason, "signal");
});
