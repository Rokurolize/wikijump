#!/usr/bin/env node

import {spawn} from "node:child_process";
import process from "node:process";
import {fileURLToPath} from "node:url";

import {
  SEED_CAPTURE_ENV,
  deepwellNextestPartition,
  deepwellTestShards,
  deepwellTestThreads,
  prepareShardSeedCapture,
  runValidationCommand,
  withProvisionedDeepwellStack,
} from "../src/deepwell-integration-stack.mjs";
import {
  buildNextestExactFilterset,
  planTimeoutOnlyRetry,
} from "../src/nextest-shard-summary.mjs";

function withPreflightProfile(cargoTestArgs) {
  const hasProfile = cargoTestArgs.some(
    (arg) => arg === "-P" || arg === "--profile" || arg.startsWith("--profile="),
  );
  return hasProfile ? cargoTestArgs : ["--profile", "preflight", ...cargoTestArgs];
}

function deepwellTestCompileArgs(cargoTestArgs) {
  const args = withPreflightProfile(cargoTestArgs);
  return args.includes("--no-run") ? args : [...args, "--no-run"];
}

function runChildScript(script, argv, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...argv], {env, stdio: "inherit"});
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({code, signal}));
  });
}

async function runShards(shards, argv) {
  const script = fileURLToPath(import.meta.url);
  const capture = await prepareShardSeedCapture(process.env);
  try {
    const results = await Promise.all(Array.from({length: shards}, (_, index) => new Promise((resolve, reject) => {
      const label = `[shard ${index + 1}/${shards}] `;
      const env = {...process.env, WIKIJUMP_DEEPWELL_NEXTEST_PARTITION: `hash:${index + 1}/${shards}`};
      delete env.WIKIJUMP_DEEPWELL_TEST_SHARDS;
      delete env.WIKIJUMP_DEEPWELL_NEXTEST_FILTERSET;
      if (capture.directory) env[SEED_CAPTURE_ENV] = capture.directory;
      else delete env[SEED_CAPTURE_ENV];
      const child = spawn(process.execPath, [script, ...argv], {env, stdio: ["ignore", "pipe", "pipe"]});
      let output = "";
      for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
        let pending = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => {
          output += chunk;
          const lines = (pending + chunk).split("\n");
          pending = lines.pop();
          for (const line of lines) sink.write(`${label}${line}\n`);
        });
        stream.on("end", () => { if (pending) sink.write(`${label}${pending}\n`); });
      }
      child.on("error", reject);
      child.on("exit", (code, signal) => resolve({shard: index + 1, code, signal, output}));
    })));
    const failed = results.filter(({code, signal}) => code !== 0 || Boolean(signal));
    if (failed.length === 0) return;

    if (process.env.WIKIJUMP_DEEPWELL_TIMEOUT_RETRY !== "0") {
      const plan = planTimeoutOnlyRetry(
        results.map(({shard, code, signal, output}) => ({shard, code, signal, text: output})),
      );
      if (plan.shouldRetry) {
        const filterset = buildNextestExactFilterset(plan.retryTargets);
        const summary = plan.retryTargets.map((target) => `${target.binaryId} ${target.testName}`).join(", ");
        console.error(
          `Deepwell shards failed only due to ${plan.retryTargets.length} TIMEOUT(s); running one unloaded retry (--profile preflight --test-threads 1): ${summary}`,
        );
        const retryEnv = {
          ...process.env,
          WIKIJUMP_DEEPWELL_TEST_THREADS: "1",
          WIKIJUMP_DEEPWELL_NEXTEST_FILTERSET: filterset,
        };
        delete retryEnv.WIKIJUMP_DEEPWELL_TEST_SHARDS;
        delete retryEnv.WIKIJUMP_DEEPWELL_NEXTEST_PARTITION;
        if (capture.directory) retryEnv[SEED_CAPTURE_ENV] = capture.directory;
        else delete retryEnv[SEED_CAPTURE_ENV];
        const retryResult = await runChildScript(script, argv, retryEnv);
        if (retryResult.code === 0 && !retryResult.signal) {
          console.error("Deepwell unloaded timeout-only retry passed.");
          return;
        }
        throw new Error(
          `Deepwell unloaded timeout-only retry failed (${retryResult.signal ?? retryResult.code}) for: ${summary}`,
        );
      }
    }

    throw new Error(`Deepwell test shards failed: ${failed.map(({shard, code, signal}) => `${shard} (${signal ?? code})`).join(", ")}`);
  } finally {
    await capture.dispose();
  }
}

async function run() {
  if (process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h")) {
    process.stdout.write(
      [
        "Usage: run-deepwell-integration-validation.mjs [cargo-test-args...] [-- harness-args...]",
        "",
        "Runs Deepwell tests against a task-owned PostgreSQL/Valkey/MinIO stack.",
        "Arguments before -- are forwarded to `cargo test`; arguments after -- are forwarded",
        "to the Rust test harness after the runner's bounded `--test-threads` argument.",
        "Set WIKIJUMP_DEEPWELL_TEST_THREADS=1..16 to select task-owned integration-test concurrency.",
        "Set WIKIJUMP_DEEPWELL_NEXTEST_PARTITION=hash:I/N to run one independently provisioned",
        "nextest shard; each shard still defaults to one active test so task-owned state is isolated.",
        "Set WIKIJUMP_DEEPWELL_TEST_SHARDS=N to run N such shards side by side. The shards then seed once and",
        "restore that capture into their own stacks; WIKIJUMP_DEEPWELL_SEED_CAPTURE=off makes each shard run the",
        "seeder instead, and WIKIJUMP_DEEPWELL_SEED_CAPTURE_ROOT=<dir> keeps captures between runs, keyed by their inputs.",
        "When sharded nextest runs fail solely due to TIMEOUT tests, one unloaded single-stack retry is run automatically",
        "unless WIKIJUMP_DEEPWELL_TIMEOUT_RETRY=0 is set.",
        "",
      ].join("\n"),
    );
    return;
  }

  const filterset = process.env.WIKIJUMP_DEEPWELL_NEXTEST_FILTERSET?.trim() || "";
  const shards = deepwellTestShards(process.env);
  const separator = process.argv.indexOf("--", 2);
  const cargoTestArgs = process.argv.slice(2, separator === -1 ? undefined : separator);
  const harnessArgs = separator === -1 ? [] : process.argv.slice(separator + 1);
  if (shards > 1 && !deepwellNextestPartition(process.env) && !filterset) {
    const cargo = process.env.WIKIJUMP_OFFLINE_CARGO?.trim() || "cargo";
    await runValidationCommand(cargo, [
      "test", "--offline", "--locked",
      "--manifest-path", "deepwell/Cargo.toml",
      ...deepwellTestCompileArgs(cargoTestArgs),
    ], {env: {...process.env, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS?.trim() || "1"}});
    await runShards(shards, process.argv.slice(2));
    return;
  }

  await withProvisionedDeepwellStack(async ({env, cargo}) => {
    const partition = deepwellNextestPartition(env);
    if (partition || filterset) {
      await runValidationCommand(cargo, [
        "nextest", "run", "--offline", "--locked",
        "--manifest-path", "deepwell/Cargo.toml",
        ...withPreflightProfile(cargoTestArgs),
        ...(partition ? ["--partition", partition] : []),
        ...(filterset ? ["--no-tests", "fail", "-E", filterset] : []),
        "--test-threads", deepwellTestThreads(env),
        ...(harnessArgs.length ? ["--", ...harnessArgs] : []),
      ], {env});
    } else {
      await runValidationCommand(cargo, [
        "test", "--offline", "--locked",
        "--manifest-path", "deepwell/Cargo.toml", ...cargoTestArgs,
        "--", "--test-threads", deepwellTestThreads(env), ...harnessArgs,
      ], {env});
    }
  });
}

run().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
});
