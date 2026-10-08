#!/usr/bin/env node

import process from "node:process";

import {
  deepwellNextestPartition,
  deepwellTestThreads,
  runValidationCommand,
  withDeepwellIntegrationStack,
} from "../src/deepwell-integration-stack.mjs";

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
        "",
      ].join("\n"),
    );
    return;
  }

  const separator = process.argv.indexOf("--", 2);
  const cargoTestArgs = process.argv.slice(2, separator === -1 ? undefined : separator);
  const harnessArgs = separator === -1 ? [] : process.argv.slice(separator + 1);

  await withDeepwellIntegrationStack(async ({env, cargo}) => {
    const partition = deepwellNextestPartition(env);
    if (partition) {
      await runValidationCommand(cargo, [
        "nextest", "run", "--offline", "--locked",
        "--manifest-path", "deepwell/Cargo.toml", ...cargoTestArgs,
        "--partition", partition, "--test-threads", deepwellTestThreads(env),
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
