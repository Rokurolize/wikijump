import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "../scripts/preview-source.mjs");

async function runPreview(args) {
  return execFileAsync(process.execPath, [scriptPath, ...args]);
}

async function assertPreviewFails(args, messagePattern) {
  await assert.rejects(runPreview(args), (error) => {
    assert.match(error.stderr, messagePattern);
    return true;
  });
}

test("preview-source writes deterministic failure diagnostics when RPC is unavailable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-preview-source-"));
  const sourceDir = path.join(root, "pages", "scp-001");
  const outputDir = path.join(root, "out");
  const sourcePath = path.join(sourceDir, "source.wikidot.txt");

  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(
    sourcePath,
    [
      "[[include fragment:card]]",
      "[[image local--files/scp-001/example.png]]",
      "Preview fixture body"
    ].join("\n")
  );

  await runPreview([
    "--source",
    sourcePath,
    "--output-dir",
    outputDir,
    "--rpc-url",
    "http://127.0.0.1:1/jsonrpc",
    "--json"
  ]);

  const result = JSON.parse(await fs.readFile(path.join(outputDir, "preview-result.json"), "utf8"));

  assert.equal(result.source.path, sourcePath);
  assert.equal(result.source.manifestMatched, false);
  assert.equal(result.request.previewSlug, "preview-scp-001");
  assert.equal(result.diagnostics.status, "failed-import");
  assert.equal(result.wikijump.action, "failed");
  assert.deepEqual(result.dependencies.includes, ["include:fragment:card"]);
  assert.deepEqual(result.assets.references, ["local--files/scp-001/example.png"]);
  assert.equal(result.html.bytes, 0);
});

test("preview-source rejects missing required option values", async () => {
  await assertPreviewFails([], /--source is required/);
  await assertPreviewFails(["--source"], /--source requires a value/);
  await assertPreviewFails(["--source", "--output-dir"], /--source requires a value/);
  await assertPreviewFails(["--source", "fixture", "--rpc-url"], /--rpc-url requires a value/);
});
