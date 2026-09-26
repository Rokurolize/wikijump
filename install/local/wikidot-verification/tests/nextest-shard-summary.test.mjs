import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateNextestShard,
  parseNextestSummary,
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
