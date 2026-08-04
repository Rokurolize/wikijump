import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("local PostgreSQL is private to the Compose network and has no read-only seed credential", async () => {
  const compose = await readFile(path.join(repositoryRoot, "install/local/docker-compose.yaml"), "utf8");
  const hba = await readFile(path.join(repositoryRoot, "install/common/postgres/init/01-setup.sh"), "utf8");
  const seed = await readFile(path.join(repositoryRoot, "install/common/postgres/init/02-seed.sql"), "utf8");

  const databaseService = compose.slice(compose.indexOf("  database:"), compose.indexOf("\n  files:"));
  assert.doesNotMatch(databaseService, /^\s+ports:/mu);
  assert.doesNotMatch(databaseService, /5432:5432/u);
  assert.doesNotMatch(`${hba}\n${seed}`, /wikijump_ro/u);
});
