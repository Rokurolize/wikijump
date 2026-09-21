import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function parseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  assert.ok(match, `${label} must be an exact MAJOR.MINOR.PATCH version`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function parseValkeyBase(source, label) {
  const match = /^FROM valkey\/valkey:(\d+\.\d+)-alpine@sha256:([0-9a-f]{64})$/mu.exec(
    source,
  );
  assert.ok(match, `${label} must pin one immutable valkey/valkey X.Y-alpine digest`);
  return {series: match[1], digest: match[2]};
}

test("standing-compatible Valkey floor prevents a durable-cache downgrade", async () => {
  const policy = JSON.parse(
    await fs.readFile(
      path.join(repositoryRoot, "install/standing/cache-data-compatibility.json"),
      "utf8",
    ),
  );
  assert.equal(policy.schema, "wikijump.standing_cache_data_compatibility.v1");
  assert.equal(policy.engine, "valkey");
  const minimum = parseVersion(policy.minimum_version, "minimum_version");

  const dockerfiles = await Promise.all(
    ["install/local/valkey/Dockerfile", "install/dev/valkey/Dockerfile"].map(
      async (relativePath) => ({
        relativePath,
        base: parseValkeyBase(
          await fs.readFile(path.join(repositoryRoot, relativePath), "utf8"),
          relativePath,
        ),
      }),
    ),
  );

  assert.deepEqual(
    dockerfiles[0].base,
    dockerfiles[1].base,
    "local/dev Valkey bases must stay identical",
  );
  const [major, minor] = dockerfiles[0].base.series.split(".").map(Number);
  const pinnedFloor = [major, minor, 0];
  assert.ok(
    compareVersions(pinnedFloor, minimum) >= 0,
    `Valkey ${dockerfiles[0].base.series} is below durable-cache floor ${policy.minimum_version}`,
  );
});
