import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ARTIFACT_ROOT = fileURLToPath(
  new URL("../artifacts/", import.meta.url),
);
const MAX_RAW_JSON_BYTES = 8 * 1024 * 1024;

function walk(directory) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...walk(filePath));
    else if (entry.isFile()) rows.push(filePath);
  }
  return rows;
}

test("tracked verification JSON artifacts stay below the raw eight-MiB budget", () => {
  const offenders = walk(ARTIFACT_ROOT)
    .filter((filePath) => /\.jsonl?$/u.test(filePath))
    .map((filePath) => ({
      file: path.relative(ARTIFACT_ROOT, filePath),
      bytes: fs.statSync(filePath).size,
    }))
    .filter(({ bytes }) => bytes > MAX_RAW_JSON_BYTES)
    .sort((left, right) => right.bytes - left.bytes);
  assert.deepEqual(offenders, []);
});
