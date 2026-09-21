import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readArtifactBytes,
  readArtifactText,
  readJsonArtifact,
  readJsonArtifactVariant,
  readJsonlArtifact,
  readJsonlArtifactVariant,
  writeGzipText,
  writeJsonGzip,
  writeJsonlGzip,
} from "../src/compressed-artifact-io.mjs";

test("gzip artifact I/O is deterministic and preserves uncompressed bytes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compressed-artifact-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = path.join(root, "first.txt.gz");
  const second = path.join(root, "second.txt.gz");
  const text = "alpha\nbeta\n".repeat(100);
  await writeGzipText(first, text);
  await writeGzipText(second, text);
  assert.deepEqual(await fs.readFile(first), await fs.readFile(second));
  assert.equal(await readArtifactText(first), text);
  assert.deepEqual(await readArtifactBytes(first), Buffer.from(text));
});

test("JSON and JSONL readers accept plain and gzip artifacts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compressed-artifact-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const plainJson = path.join(root, "plain.json");
  const gzipJson = path.join(root, "gzip.json.gz");
  const plainJsonl = path.join(root, "plain.jsonl");
  const gzipJsonl = path.join(root, "gzip.jsonl.gz");
  const object = { a: 1, b: "two" };
  const rows = [{ id: 1 }, { id: 2 }];
  await fs.writeFile(plainJson, `${JSON.stringify(object)}\n`);
  await writeJsonGzip(gzipJson, object);
  await fs.writeFile(plainJsonl, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  await writeJsonlGzip(gzipJsonl, rows);
  assert.deepEqual(await readJsonArtifact(plainJson), object);
  assert.deepEqual(await readJsonArtifact(gzipJson), object);
  assert.deepEqual(await readJsonlArtifact(plainJsonl), rows);
  assert.deepEqual(await readJsonlArtifact(gzipJsonl), rows);
  assert.deepEqual(await readJsonArtifactVariant(path.join(root, "gzip.json")), object);
  assert.deepEqual(await readJsonlArtifactVariant(path.join(root, "gzip.jsonl")), rows);
});
