import assert from "node:assert/strict";
import test from "node:test";

import {
  deepwellNextestPartition,
  deepwellTestImageName,
  deepwellTestThreads,
  runValidationCommand,
  resolveDeepwellSeedBinary,
} from "../src/deepwell-integration-stack.mjs";

test("Deepwell stack validates test concurrency and nextest partitions", () => {
  assert.equal(deepwellTestThreads({}), "1");
  assert.equal(deepwellTestThreads({WIKIJUMP_DEEPWELL_TEST_THREADS: "4"}), "4");
  assert.throws(
    () => deepwellTestThreads({WIKIJUMP_DEEPWELL_TEST_THREADS: "0"}),
    /integer from 1 through 16/u,
  );
  assert.equal(deepwellNextestPartition({}), null);
  assert.equal(
    deepwellNextestPartition({WIKIJUMP_DEEPWELL_NEXTEST_PARTITION: "hash:2/4"}),
    "hash:2/4",
  );
  assert.throws(
    () => deepwellNextestPartition({WIKIJUMP_DEEPWELL_NEXTEST_PARTITION: "hash:0/4"}),
    /must look like/u,
  );
});

test("Deepwell stack honors local image overrides", () => {
  assert.equal(
    deepwellTestImageName("database", {WIKIJUMP_DEEPWELL_TEST_DATABASE_IMAGE: "custom-db"}),
    "custom-db",
  );
  assert.equal(deepwellTestImageName("cache", {}), "wikijump-local-development-cache");
});

test("Deepwell seed binary follows Cargo target-directory overrides", async () => {
  const targetDirectory = "/tmp/wikijump-test-quality-target-override";
  const path = await resolveDeepwellSeedBinary({
    env: {...process.env, CARGO_TARGET_DIR: targetDirectory},
  });
  assert.equal(path, `${targetDirectory}/debug/deepwell`);
});

test("validation command can explicitly accept a reviewed nonzero outcome", async () => {
  const result = await runValidationCommand(
    process.execPath,
    ["-e", "process.exit(2)"],
    {acceptableExitCodes: [0, 2]},
  );
  assert.equal(result.exitCode, 2);
});
