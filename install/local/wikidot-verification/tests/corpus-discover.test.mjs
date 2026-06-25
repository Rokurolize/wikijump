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
const scriptPath = path.resolve(__dirname, "../scripts/corpus-discover.mjs");

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("corpus-discover inventories files and writes deterministic canaries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikijump-corpus-discover-"));
  const corpus = path.join(root, "corpus");
  const outputDir = path.join(root, "out");
  const pageDir = path.join(corpus, "pages", "scp-001");
  const fragmentDir = path.join(corpus, "pages", "fragment:card");
  const assetDir = path.join(corpus, "assets");

  await fs.mkdir(pageDir, { recursive: true });
  await fs.mkdir(fragmentDir, { recursive: true });
  await fs.mkdir(assetDir, { recursive: true });

  await fs.writeFile(
    path.join(pageDir, "source.wikidot.txt"),
    [
      "[[include fragment:card]]",
      "[[module ListPages category=\"scp\"]]",
      "[[image assets/example.svg]]",
      "http://example.test/link"
    ].join("\n")
  );
  await writeJson(path.join(pageDir, "meta.json"), {
    title: "SCP-001 Fixture",
    tags: ["scp", "featured"],
    parent_fullname: "scp-series"
  });
  await fs.writeFile(path.join(pageDir, "entity_id.txt"), "1001\n");

  await fs.writeFile(path.join(fragmentDir, "source.wikidot.txt"), "|| cell ||\n");
  await writeJson(path.join(fragmentDir, "meta.json"), {
    title_shown: "Fragment Card",
    tags: ["fragment"]
  });
  await fs.writeFile(path.join(assetDir, "example.svg"), "<svg />\n");

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--corpus",
    corpus,
    "--output-dir",
    outputDir,
    "--canary-count",
    "2"
  ]);
  const summary = JSON.parse(stdout);

  assert.equal(summary.filesInventoried, 6);
  assert.equal(summary.pageSourceCandidates, 2);
  assert.equal(summary.canaryRows, 2);
  assert.equal(summary.candidateTypeCounts["page-source"], 2);
  assert.equal(summary.candidateTypeCounts.image, 1);
  assert.equal(summary.constructCounts.include, 1);
  assert.equal(summary.constructCounts["module-listpages"], 1);

  const manifest = await fs.readFile(path.join(outputDir, "corpus-manifest.tsv"), "utf8");
  assert.match(manifest, /scp-001\tSCP-001 Fixture/);
  assert.match(manifest, /include:fragment:card/);
  assert.match(manifest, /module:ListPages/);
  assert.match(manifest, /metadata\/tags/);

  const canaries = await fs.readFile(path.join(outputDir, "canary-pages.tsv"), "utf8");
  assert.match(canaries, /scp-001/);

  const markdown = await fs.readFile(path.join(outputDir, "corpus-discovery-summary.md"), "utf8");
  assert.match(markdown, /files inventoried: 6/);
});
