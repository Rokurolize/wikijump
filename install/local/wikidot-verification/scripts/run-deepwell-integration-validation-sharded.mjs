#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

import {
  buildNextestExactFilterset,
  evaluateNextestShard,
  parseNextestSummary,
  planTimeoutOnlyRetry,
} from "../src/nextest-shard-summary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, "run-deepwell-integration-validation.mjs");
const args = process.argv.slice(2);
const rawShards = process.env.WIKIJUMP_DEEPWELL_TEST_SHARDS?.trim() || "8";
const shards = Number(rawShards);
if (!Number.isInteger(shards) || shards < 1 || shards > 8) {
  throw new Error("WIKIJUMP_DEEPWELL_TEST_SHARDS must be an integer from 1 through 8");
}

if (args.some((argument) => argument === "--help" || argument === "-h")) {
  process.stdout.write(
    [
      "Usage: run-deepwell-integration-validation-sharded.mjs [cargo-test-args...] [-- harness-args...]",
      "",
      "Runs Deepwell integration tests across independent task-owned PostgreSQL/Valkey/MinIO",
      "stacks. Each shard stays single-test-threaded; the test set is partitioned with nextest.",
      "Set WIKIJUMP_DEEPWELL_TEST_SHARDS to 1..8 (default 8; lower it on smaller hosts).",
      "When shards fail solely due to TIMEOUT tests, one unloaded retry runs automatically",
      "unless WIKIJUMP_DEEPWELL_TIMEOUT_RETRY=0 is set.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

if (shards === 1) {
  const child = spawn(process.execPath, [runner, ...args], {stdio: "inherit", env: process.env});
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
} else {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wikijump-deepwell-shards."));
  const startedAt = Date.now();
  const children = [];
  let activeChild = null;
  let terminating = false;

  const terminate = (signal) => {
    if (terminating) return;
    terminating = true;
    for (const entry of children) {
      if (entry.child.exitCode === null && !entry.child.killed) entry.child.kill(signal);
    }
    if (activeChild && activeChild.exitCode === null && !activeChild.killed) {
      activeChild.kill(signal);
    }
  };
  process.once("SIGINT", () => terminate("SIGINT"));
  process.once("SIGTERM", () => terminate("SIGTERM"));

  try {
    for (let shard = 1; shard <= shards; shard += 1) {
      const logPath = path.join(tempDir, `shard-${shard}.log`);
      const logFd = fs.openSync(logPath, "wx", 0o600);
      const env = {
        ...process.env,
        WIKIJUMP_DEEPWELL_NEXTEST_PARTITION: `hash:${shard}/${shards}`,
        WIKIJUMP_DEEPWELL_TEST_THREADS: "1",
      };
      delete env.WIKIJUMP_DEEPWELL_TEST_SHARDS;
      delete env.WIKIJUMP_DEEPWELL_NEXTEST_FILTERSET;
      const child = spawn(process.execPath, [runner, ...args], {
        env,
        stdio: ["ignore", logFd, logFd],
      });
      fs.closeSync(logFd);
      children.push({shard, child, logPath, startedAt: Date.now()});
    }

    const results = await Promise.all(children.map((entry) => new Promise((resolve) => {
      entry.child.once("exit", (code, signal) => {
        resolve({
          ...entry,
          code,
          signal,
          elapsedMs: Date.now() - entry.startedAt,
        });
      });
    })));

    let failed = false;
    let totalTests = 0;
    const shardRuns = [];
    const failedShardLogs = [];
    for (const result of results) {
      const text = fs.readFileSync(result.logPath, "utf8");
      const evaluation = evaluateNextestShard({
        code: result.code,
        signal: result.signal,
        text,
      });
      const tests = evaluation.summary?.tests ?? null;
      const passed = evaluation.summary?.passed ?? null;
      if (tests !== null) totalTests += tests;
      const {ok} = evaluation;
      failed ||= !ok;
      shardRuns.push({shard: result.shard, code: result.code, signal: result.signal, text});
      if (!ok) {
        failedShardLogs.push({shard: result.shard, evaluation, text});
      }
      process.stdout.write(`${JSON.stringify({
        shard: result.shard,
        shards,
        status: ok ? "pass" : "fail",
        elapsed_ms: result.elapsedMs,
        tests,
        passed,
      })}\n`);
    }

    let timeoutRetry = null;
    if (failed && process.env.WIKIJUMP_DEEPWELL_TIMEOUT_RETRY !== "0") {
      const plan = planTimeoutOnlyRetry(shardRuns);
      if (plan.shouldRetry) {
        const filterset = buildNextestExactFilterset(plan.retryTargets);
        const retryLogPath = path.join(tempDir, "timeout-retry.log");
        const retryFd = fs.openSync(retryLogPath, "wx", 0o600);
        const retryEnv = {
          ...process.env,
          WIKIJUMP_DEEPWELL_TEST_SHARDS: "1",
          WIKIJUMP_DEEPWELL_TEST_THREADS: "1",
          WIKIJUMP_DEEPWELL_NEXTEST_FILTERSET: filterset,
        };
        delete retryEnv.WIKIJUMP_DEEPWELL_NEXTEST_PARTITION;
        process.stderr.write(
          `Retrying ${plan.retryTargets.length} timed-out Deepwell test(s) once unloaded: ${plan.retryTargets.map((target) => `${target.binaryId} ${target.testName}`).join(", ")}\n`,
        );
        const retryStartedAt = Date.now();
        activeChild = spawn(process.execPath, [runner, ...args], {
          env: retryEnv,
          stdio: ["ignore", retryFd, retryFd],
        });
        fs.closeSync(retryFd);
        const retryResult = await new Promise((resolve) => {
          activeChild.once("exit", (code, signal) => resolve({code, signal}));
        });
        activeChild = null;
        const retryText = fs.readFileSync(retryLogPath, "utf8");
        const retrySummary = parseNextestSummary(retryText);
        const retryOk = retryResult.code === 0 && !retryResult.signal && retrySummary !== null;
        timeoutRetry = {
          attempted: true,
          targets: plan.retryTargets.length,
          passed: retryOk,
          elapsed_ms: Date.now() - retryStartedAt,
        };
        if (retryOk) {
          failed = false;
        } else {
          const retryLines = retryText.trimEnd().split("\n");
          process.stderr.write(`--- Deepwell timeout-only retry tail ---\n${retryLines.slice(-120).join("\n")}\n`);
        }
      }
    }

    if (failed) {
      for (const {shard, evaluation, text} of failedShardLogs) {
        if (evaluation.missingSuccessfulSummary) {
          process.stderr.write(
            `Deepwell shard ${shard}/${shards} exited successfully without a parseable nextest Summary\n`,
          );
        }
        const lines = text.trimEnd().split("\n");
        process.stderr.write(`--- Deepwell shard ${shard}/${shards} tail ---\n${lines.slice(-120).join("\n")}\n`);
      }
    }

    process.stdout.write(`${JSON.stringify({
      schema: "wikijump_deepwell_sharded_validation.v1",
      shards,
      elapsed_ms: Date.now() - startedAt,
      partitioned_tests_run: totalTests,
      ...(timeoutRetry ? {timeout_retry: timeoutRetry} : {}),
      failed,
    })}\n`);
    if (failed) process.exitCode = 1;
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}
