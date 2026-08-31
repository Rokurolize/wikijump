import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

test("Deepwell migration versions are unique", () => {
  const migrations = fs
    .readdirSync(path.join(repositoryRoot, "deepwell/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const versions = migrations.map((name) => name.split("_", 1)[0]);
  assert.equal(new Set(versions).size, versions.length);
});
