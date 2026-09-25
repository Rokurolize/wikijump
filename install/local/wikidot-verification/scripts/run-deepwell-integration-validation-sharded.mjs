#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, "run-deepwell-integration-validation.mjs");
const args = process.argv.slice(2);
const rawShards = process.env.WIKIJUMP_DEEPWELL_TEST_SHARDS?.trim() || "6";
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
      "Set WIKIJUMP_DEEPWELL_TEST_SHARDS to 1..8 (default 6).",
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
  let terminating = false;

  const terminate = (signal) => {
    if (terminating) return;
    terminating = true;
    for (const entry of children) {
      if (entry.child.exitCode === null && !entry.child.killed) entry.child.kill(signal);
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
    for (const result of results) {
      const text = fs.readFileSync(result.logPath, "utf8");
      const summaries = [...text.matchAll(/Summary \[[^\]]+\]\s+(\d+) tests run:\s+(\d+) passed(?:,\s+(\d+) skipped)?/gu)];
      const finalSummary = summaries.at(-1);
      const tests = finalSummary ? Number(finalSummary[1]) : null;
      const passed = finalSummary ? Number(finalSummary[2]) : null;
      if (tests !== null) totalTests += tests;
      const ok = result.code === 0 && !result.signal;
      failed ||= !ok;
      process.stdout.write(`${JSON.stringify({
        shard: result.shard,
        shards,
        status: ok ? "pass" : "fail",
        elapsed_ms: result.elapsedMs,
        tests,
        passed,
      })}\n`);
      if (!ok) {
        const lines = text.trimEnd().split("\n");
        process.stderr.write(`--- Deepwell shard ${result.shard}/${shards} tail ---\n${lines.slice(-120).join("\n")}\n`);
      }
    }

    process.stdout.write(`${JSON.stringify({
      schema: "wikijump_deepwell_sharded_validation.v1",
      shards,
      elapsed_ms: Date.now() - startedAt,
      partitioned_tests_run: totalTests,
      failed,
    })}\n`);
    if (failed) process.exitCode = 1;
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}
