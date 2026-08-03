import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  exportPreviewCases,
} from "../scripts/export-listpages-preview-cases.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(
  __dirname,
  "../scripts/export-listpages-preview-cases.mjs",
);

async function writeJsonl(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

test("exports generated matrix rows as syntax preview cases with campaign provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-preview-export-"));
  const matrixDir = path.join(root, "matrix");
  const output = path.join(root, "cases.jsonl");
  await writeJsonl(path.join(matrixDir, "generated-listpages-cases.jsonl"), [
    {
      id: "lpgen-0001-category",
      origin: "generated",
      label: "category selector",
      source: '[[module ListPages category="."]]\n%%title%%\n[[/module]]',
      dimensions: ["selector", "category"],
      documentation_claim_ids: ["doc-include:page-selection:L34"],
    },
    {
      id: "lpgen-0002-tags",
      origin: "generated",
      label: "tags selector",
      source: '[[module ListPages tags="+scp"]]\n%%title%%\n[[/module]]',
      dimensions: ["selector", "tags"],
      documentation_claim_ids: [],
    },
  ]);

  const summary = await exportPreviewCases({
    matrixDir,
    lanes: ["generated"],
    limit: 1,
    deduplicateSource: false,
    output,
  });
  assert.equal(summary.case_count, 1);
  const record = JSON.parse((await fs.readFile(output, "utf8")).trim());
  assert.equal(record.schema, "wikijump_syntax_differential.syntax_case.v1");
  assert.equal(record.local_execution_tier, "wikijump-runtime");
  assert.deepEqual(record.campaign_matrix.documentation_claim_ids, [
    "doc-include:page-selection:L34",
  ]);
});

test("export CLI writes the requested lane", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-preview-export-cli-"));
  const matrixDir = path.join(root, "matrix");
  const output = path.join(root, "cases.jsonl");
  await writeJsonl(path.join(matrixDir, "corpus-cluster-cases.jsonl"), [
    {
      id: "lpcorpus-0001",
      origin: "corpus-cluster-representative",
      source: "[[module ListPages]]%%title%%[[/module]]",
      dimensions: ["corpus"],
      provenance: { branch: "en", page_fullname: "example" },
    },
  ]);

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--matrix-dir",
    matrixDir,
    "--lane",
    "corpus-cluster",
    "--output",
    output,
  ]);
  const summary = JSON.parse(stdout);
  assert.equal(summary.case_count, 1);
  const record = JSON.parse((await fs.readFile(output, "utf8")).trim());
  assert.equal(record.case_id, "lpcorpus-0001");
  assert.equal(record.campaign_matrix.provenance.branch, "en");
});

test("exports every exact corpus invocation as a replayable preview case", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-invocation-export-"),
  );
  const matrixDir = path.join(root, "matrix");
  const output = path.join(root, "cases.jsonl");
  await writeJsonl(path.join(matrixDir, "corpus-invocation-cases.jsonl"), [
    {
      id: "en:alpha:L1:B0",
      origin: "corpus-invocation",
      source: '[[module ListPages tags="+scp"]]%%title%%[[/module]]',
      dimensions: ["corpus", "arg:tags", "var:title"],
      provenance: {
        branch: "en",
        page_fullname: "alpha",
        source_path: "/corpus/en/pages/alpha/source.wikidot.txt",
        line_start: 1,
      },
    },
  ]);

  const summary = await exportPreviewCases({
    matrixDir,
    lanes: ["corpus-invocation"],
    limit: null,
    deduplicateSource: false,
    output,
  });

  assert.equal(summary.case_count, 1);
  const record = JSON.parse((await fs.readFile(output, "utf8")).trim());
  assert.equal(record.case_id, "en:alpha:L1:B0");
  assert.equal(
    record.source,
    '[[module ListPages tags="+scp"]]%%title%%[[/module]]',
  );
  assert.equal(record.campaign_matrix.origin, "corpus-invocation");
  assert.equal(record.campaign_matrix.provenance.page_fullname, "alpha");
});

test("deduplicates exact corpus sources while retaining the first provenance", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-source-dedup-"),
  );
  const matrixDir = path.join(root, "matrix");
  const output = path.join(root, "cases.jsonl");
  const source = "[[module ListPages]]%%title%%[[/module]]";
  const sourceSha256 = "same-source";
  await writeJsonl(path.join(matrixDir, "corpus-invocation-cases.jsonl"), [
    {
      id: "en:alpha:L1:B0",
      origin: "corpus-invocation",
      source,
      source_sha256: sourceSha256,
      provenance: { branch: "en", page_fullname: "alpha" },
    },
    {
      id: "jp:beta:L2:B4",
      origin: "corpus-invocation",
      source,
      source_sha256: sourceSha256,
      provenance: { branch: "jp", page_fullname: "beta" },
    },
  ]);

  const summary = await exportPreviewCases({
    matrixDir,
    lanes: ["corpus-invocation"],
    limit: null,
    deduplicateSource: true,
    output,
  });

  assert.deepEqual(summary, {
    output,
    lane_count: 1,
    input_case_count: 2,
    case_count: 1,
    exact_source_duplicates_omitted: 1,
    existing_reference_sources_omitted: 0,
  });
  const record = JSON.parse((await fs.readFile(output, "utf8")).trim());
  assert.equal(record.case_id, "en:alpha:L1:B0");
  assert.equal(record.campaign_matrix.provenance.page_fullname, "alpha");
});

test("exports literal ListPages mentions with their preserving source context", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-literal-context-"),
  );
  const matrixDir = path.join(root, "matrix");
  const output = path.join(root, "cases.jsonl");
  await writeJsonl(path.join(matrixDir, "corpus-invocation-cases.jsonl"), [
    {
      id: "en:docs:L3:B20",
      origin: "corpus-invocation",
      source: "[[module ListPages]]",
      source_sha256: "isolated-source",
      execution_context: "literal",
      literal_owner: "inline-raw",
      context_replay_source: "@@[[module ListPages]]@@",
      context_replay_source_sha256: "context-source",
      provenance: { branch: "en", page_fullname: "docs" },
    },
    {
      id: "en:runtime:L8:B100",
      origin: "corpus-invocation",
      source: "[[module ListPages]][[/module]]",
      source_sha256: "runtime-source",
      execution_context: "executable",
      literal_owner: null,
      context_replay_source: null,
      context_replay_source_sha256: null,
      provenance: { branch: "en", page_fullname: "runtime" },
    },
  ]);

  const summary = await exportPreviewCases({
    matrixDir,
    lanes: ["corpus-literal-context"],
    limit: null,
    deduplicateSource: false,
    output,
  });

  assert.equal(summary.input_case_count, 1);
  assert.equal(summary.case_count, 1);
  const record = JSON.parse((await fs.readFile(output, "utf8")).trim());
  assert.equal(record.case_id, "en:docs:L3:B20:literal-context");
  assert.equal(record.source, "@@[[module ListPages]]@@");
  assert.equal(record.campaign_matrix.origin, "corpus-literal-context");
  assert.equal(record.campaign_matrix.provenance.invocation_id, "en:docs:L3:B20");
  assert.equal(record.campaign_matrix.provenance.literal_owner, "inline-raw");
});

test("omits syntax sources that already have frozen live references", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-preview-reference-filter-"),
  );
  const matrixDir = path.join(root, "matrix");
  const output = path.join(root, "cases.jsonl");
  const references = path.join(root, "references.jsonl");
  await writeJsonl(path.join(matrixDir, "corpus-invocation-cases.jsonl"), [
    {
      id: "en:existing:L1:B0",
      origin: "corpus-invocation",
      source: "EXISTING",
      source_sha256: "existing-source",
    },
    {
      id: "en:novel:L2:B10",
      origin: "corpus-invocation",
      source: "NOVEL",
      source_sha256: "novel-source",
    },
  ]);
  await writeJsonl(references, [
    {
      source_sha256: "existing-source",
    },
  ]);

  const summary = await exportPreviewCases({
    matrixDir,
    lanes: ["corpus-invocation"],
    limit: null,
    deduplicateSource: false,
    excludeReferencePaths: [references],
    output,
  });

  assert.equal(summary.existing_reference_sources_omitted, 1);
  assert.equal(summary.case_count, 1);
  const record = JSON.parse((await fs.readFile(output, "utf8")).trim());
  assert.equal(record.case_id, "en:novel:L2:B10");
});
