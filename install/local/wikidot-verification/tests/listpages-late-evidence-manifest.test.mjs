import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const verifierRoot = path.resolve(testDirectory, "..");
const scriptPath = path.join(
  verifierRoot,
  "scripts",
  "import-listpages-late-evidence.mjs",
);
const manifestPath = path.join(
  verifierRoot,
  "artifacts",
  "listpages-late-evidence-manifest.json",
);

test("late ListPages evidence manifest reproduces from frozen references", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--check",
  ]);
  const result = JSON.parse(stdout);
  assert.deepEqual(result, {
    mode: "check",
    family_count: 32,
    case_count: 1142,
    manifest: manifestPath,
  });
});

test("late ListPages evidence accounts for every issue after core closure", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.equal(manifest.schema, "wikijump.listpages_late_evidence_manifest.v1");
  assert.equal(manifest.family_count, 32);
  assert.equal(manifest.case_count, 1142);
  assert.deepEqual(
    [
      ...new Set([
        manifest.html_preview_context.issue,
        ...manifest.entries.flatMap(({ issues }) => issues),
      ]),
    ].sort(
      (left, right) => left - right,
    ),
    Array.from({ length: 28 }, (_, index) => index + 983),
  );
  assert.equal(manifest.html_preview_context.preview_case_count, 8);
  for (const entry of manifest.entries) {
    assert.match(entry.cases.sha256, /^[0-9a-f]{64}$/u);
    assert.match(entry.live_references.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(entry.case_count > 0);
  }
});
