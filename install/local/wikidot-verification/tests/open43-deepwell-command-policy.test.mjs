import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const RAW_DEEPWELL_INTEGRATION_COMMAND = "cargo test --manifest-path deepwell/Cargo.toml";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPEN43_DIRECTORY = path.join(REPOSITORY_ROOT, "docs/development");

test("Open43 machine authority uses the task-owned Deepwell integration runner", async () => {
  const entries = await fs.readdir(OPEN43_DIRECTORY, { withFileTypes: true });
  const offenders = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("open43-") || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(OPEN43_DIRECTORY, entry.name);
    const text = await fs.readFile(filePath, "utf8");
    if (text.includes(RAW_DEEPWELL_INTEGRATION_COMMAND)) offenders.push(entry.name);
  }

  assert.deepEqual(
    offenders,
    [],
    "Open43 integration commands must use run-deepwell-integration-validation.mjs so PostgreSQL, Valkey, MinIO, and required environment are task-owned rather than ambient",
  );
});
