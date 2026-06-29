import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {
  buildEvidenceRecord,
  compactVisibleText,
  inventoryRows,
  rowLocalUrl,
  rowSourceUrl,
  safePathSegment,
  selectInventoryRows,
  writeEvidenceArtifacts,
} from "../src/browser-render-evidence.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "../scripts/capture-browser-rendering.mjs");

const inventory = {
  schema: "wikijump_full_parity.corpus_inventory_lock.v1",
  rows: [
    {
      fixture_id: "EN:alpha",
      family: "EN",
      slug: "alpha",
      source_url: "https://scp-wiki.wikidot.com/alpha",
      local_https_url: "https://scp-wiki.wikijump.localhost/alpha",
      required_browser: true,
    },
    {
      fixture_id: "EN:beta",
      family: "EN",
      slug: "beta",
      source_url: "https://scp-wiki.wikidot.com/beta",
      local_https_url: "https://scp-wiki.wikijump.localhost/beta",
      required_browser: true,
    },
  ],
};

test("selectInventoryRows intersects explicit fixture ids with shard membership", () => {
  const rows = inventoryRows(inventory);
  const selected = selectInventoryRows({
    rows,
    fixtureIds: ["EN:alpha", "EN:beta"],
    shardId: "en-0001",
    shardManifest: {
      schema: "wikijump_full_parity.corpus_shard_manifest.v1",
      shards: [{shard_id: "en-0001", fixture_ids: ["EN:beta"]}],
    },
  });

  assert.deepEqual(selected.map((row) => row.fixture_id), ["EN:beta"]);
});

test("buildEvidenceRecord emits fields accepted by the browser rendering validator", () => {
  const record = buildEvidenceRecord({
    row: inventory.rows[0],
    source: {status: 200, finalUrl: "https://scp-wiki.wikidot.com/alpha", visibleText: " Alpha\n page "},
    local: {status: 200, finalUrl: "https://scp-wiki.wikijump.localhost/alpha", visibleText: "Alpha page"},
    sourceArtifact: "/tmp/live.dom.html",
    localArtifact: "/tmp/local.dom.html",
    sourceScreenshot: "/tmp/live.png",
    localScreenshot: "/tmp/local.png",
  });

  assert.equal(record.evidence_type, "browser_rendering");
  assert.equal(record.fixture_id, "EN:alpha");
  assert.equal(record.source_visible_text, "Alpha page");
  assert.equal(record.local_visible_text, "Alpha page");
  assert.equal(record.source_browser_artifact, "/tmp/live.dom.html");
  assert.equal(record.local_browser_artifact, "/tmp/local.dom.html");
  assert.deepEqual(record.capture_errors, []);
});

test("writeEvidenceArtifacts keeps row artifacts under a safe fixture directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-browser-evidence-"));
  const artifacts = await writeEvidenceArtifacts({
    outputDir: root,
    row: {fixture_id: "EN:../alpha beta"},
    source: {html: "<html>live</html>"},
    local: {html: "<html>local</html>"},
    screenshot: true,
  });

  assert.equal(path.dirname(artifacts.sourceArtifact), path.join(root, safePathSegment("EN:../alpha beta")));
  assert.equal(await fs.readFile(artifacts.sourceArtifact, "utf8"), "<html>live</html>");
  assert.equal(await fs.readFile(artifacts.localArtifact, "utf8"), "<html>local</html>");
  assert.equal(compactVisibleText(" one\n\t two "), "one two");
});

test("safePathSegment keeps colliding fixture IDs distinct", () => {
  assert.notEqual(safePathSegment("EN:a/b"), safePathSegment("EN:a_b"));
  assert.notEqual(
    safePathSegment(`EN:${"a".repeat(180)}1`),
    safePathSegment(`EN:${"a".repeat(180)}2`)
  );
});

test("row URL helpers skip blank preferred fields before falling back", () => {
  assert.equal(rowSourceUrl({source_url: "", live_url: "https://live.example/page"}), "https://live.example/page");
  assert.equal(
    rowLocalUrl({local_https_url: "", local_http_url: "http://local.example/page"}),
    "http://local.example/page"
  );
});

test("capture CLI rejects an empty row selection before launching a browser", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-browser-empty-selection-"));
  const inventoryPath = path.join(root, "inventory.json");
  await fs.writeFile(inventoryPath, JSON.stringify(inventory), "utf8");

  await assert.rejects(
    execFileAsync(process.execPath, [
      scriptPath,
      "--inventory",
      inventoryPath,
      "--output-dir",
      path.join(root, "out"),
      "--fixture-id",
      "EN:missing",
      "--json",
    ]),
    (error) => {
      assert.match(error.stderr, /no inventory rows selected/);
      return true;
    }
  );
});
