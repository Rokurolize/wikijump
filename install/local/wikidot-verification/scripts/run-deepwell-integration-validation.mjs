#!/usr/bin/env node

import {
  nextestPartition, testThreads, withTaskOwnedDeepwellStack,
} from "../src/deepwell-test-stack.mjs";
import {withAuditSignals} from "../src/audit-command.mjs";

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
  await withAuditSignals((signal) => withTaskOwnedDeepwellStack(async ({env, cargo, execute}) => {
    const partition = nextestPartition();
    if (partition) {
      await execute(cargo, [
        "nextest", "run", "--offline", "--locked",
        "--manifest-path", "deepwell/Cargo.toml", ...cargoTestArgs,
        "--partition", partition, "--test-threads", testThreads(),
        ...(harnessArgs.length ? ["--", ...harnessArgs] : []),
      ], {env});
    } else {
      await execute(cargo, [
        "test", "--offline", "--locked",
        "--manifest-path", "deepwell/Cargo.toml", ...cargoTestArgs,
        "--", "--test-threads", testThreads(), ...harnessArgs,
      ], {env});
    }
  }, {signal}));
}

run().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
});
