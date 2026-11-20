#!/usr/bin/env node

import {readFileSync} from "node:fs";
import process from "node:process";

import {
  buildNextestExactFilterset,
  planTimeoutOnlyRetry,
} from "../src/nextest-shard-summary.mjs";

const [logPath, rawCode] = process.argv.slice(2);
if (!logPath || rawCode === undefined) {
  process.stderr.write("Usage: plan-nextest-timeout-retry.mjs <log-path> <exit-code>\n");
  process.exit(2);
}

const code = Number(rawCode);
if (!Number.isInteger(code)) {
  process.stderr.write(`Invalid exit code: ${rawCode}\n`);
  process.exit(2);
}

const text = readFileSync(logPath, "utf8");
const plan = planTimeoutOnlyRetry([{code, signal: null, text}]);
const filterset = plan.shouldRetry ? buildNextestExactFilterset(plan.retryTargets) : null;

process.stdout.write(
  `${JSON.stringify({
    shouldRetry: plan.shouldRetry,
    reason: plan.reason,
    targets: plan.retryTargets,
    nonTimeoutFailures: plan.nonTimeoutFailures,
    filterset,
  })}\n`,
);
