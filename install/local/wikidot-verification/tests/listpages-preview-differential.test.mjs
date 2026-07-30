import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  runListPagesPreviewDifferential,
  writePreviewDifferential,
} from "../src/listpages-preview-differential.mjs";
import { sha256 } from "../src/syntax-differential.mjs";

function reference(caseId, source, rawHtml) {
  return {
    schema: "wikijump_syntax_differential.wikidot_reference.v1",
    syntax_case: {
      schema: "wikijump_syntax_differential.syntax_case.v1",
      case_id: caseId,
      source,
      title: caseId,
      wikidot_observation_tier: "page-preview",
      local_execution_tier: "wikijump-runtime",
    },
    source_sha256: sha256(source),
    captured_at: "2026-07-27T00:00:00+00:00",
    provenance: {
      site: "sandbox-for-codex",
      site_domain: "sandbox-for-codex.wikidot.com",
      module: "edit/PagePreviewModule",
      wikidot_py_version: "4.4.1",
      wikidot_py_commit: "4af7c8eaec00a3e7a29fe502234e0aeeef968233",
      requirements_sha256: "c".repeat(64),
      authenticated: false,
      mutated: false,
    },
    raw_html: rawHtml,
    raw_html_sha256: sha256(rawHtml),
  };
}

async function writeReferences(filePath, rows) {
  await fs.writeFile(filePath, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

class FakeRpc {
  constructor(previews) {
    this.previews = previews;
  }

  async call(method, params) {
    if (method === "site_get") return { site_id: 7, slug: params.site };
    if (method === "wikidot_page_preview") {
      const value = this.previews.get(params.wikitext);
      if (value instanceof Error) throw value;
      return { body: value, styles: [] };
    }
    throw new Error(`unexpected method ${method}`);
  }
}

class BoundedConcurrencyFakeRpc extends FakeRpc {
  constructor(previews) {
    super(previews);
    this.active = 0;
    this.maximumActive = 0;
  }

  async call(method, params) {
    if (method !== "wikidot_page_preview") {
      return super.call(method, params);
    }
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      const delay = Number(params.wikitext.split(":")[0]);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return { body: this.previews.get(params.wikitext), styles: [] };
    } finally {
      this.active -= 1;
    }
  }
}

test("preview differential records matches and mismatches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-preview-diff-"));
  const referencesPath = path.join(root, "references.jsonl");
  await writeReferences(referencesPath, [
    reference("match", "**x**", "<p>x</p>"),
    reference("mismatch", "**y**", "<p>live</p>"),
  ]);
  const verdict = await runListPagesPreviewDifferential({
    referencesPath,
    rpcUrl: "http://127.0.0.1:1/jsonrpc",
    siteSlug: "sandbox-for-codex",
    rpcClient: new FakeRpc(new Map([
      ["**x**", "<p>x</p>"],
      ["**y**", "<p>local</p>"],
    ])),
  });

  assert.equal(verdict.summary.counts.match, 1);
  assert.equal(verdict.summary.counts.mismatch, 1);
  assert.equal(verdict.summary.exit_code, 1);
  const mismatch = verdict.cases.find((row) => row.case_id === "mismatch");
  assert.equal(mismatch.comparison.checks.visible_text.live, "live");
  assert.equal(mismatch.comparison.checks.visible_text.local, "local");
});

test("preview differential records local errors and writes a verdict", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-preview-diff-error-"));
  const referencesPath = path.join(root, "references.jsonl");
  const output = path.join(root, "verdict.json");
  await writeReferences(referencesPath, [reference("boom", "source", "<p>live</p>")]);
  const verdict = await runListPagesPreviewDifferential({
    referencesPath,
    rpcUrl: "http://127.0.0.1:1/jsonrpc",
    siteSlug: "sandbox-for-codex",
    rpcClient: new FakeRpc(new Map([["source", new Error("boom")]])),
  });
  assert.equal(verdict.summary.counts["local-error"], 1);
  await writePreviewDifferential(verdict, output);
  assert.equal(JSON.parse(await fs.readFile(output, "utf8")).summary.counts["local-error"], 1);
});

test("preview differential bounds concurrency and preserves reference order", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-preview-diff-pool-"));
  const referencesPath = path.join(root, "references.jsonl");
  const rows = [
    reference("slow-first", "30:first", "<p>first</p>"),
    reference("fast-second", "1:second", "<p>second</p>"),
    reference("middle-third", "10:third", "<p>third</p>"),
    reference("fast-fourth", "1:fourth", "<p>fourth</p>"),
  ];
  await writeReferences(referencesPath, rows);
  const rpcClient = new BoundedConcurrencyFakeRpc(
    new Map(rows.map((row) => [row.syntax_case.source, row.raw_html])),
  );

  const verdict = await runListPagesPreviewDifferential({
    referencesPath,
    rpcUrl: "http://127.0.0.1:1/jsonrpc",
    siteSlug: "sandbox-for-codex",
    rpcClient,
    concurrency: 2,
  });

  assert.equal(rpcClient.maximumActive, 2);
  assert.deepEqual(
    verdict.cases.map(({ case_id }) => case_id),
    rows.map(({ syntax_case }) => syntax_case.case_id),
  );
  assert.equal(verdict.summary.counts.match, rows.length);
});

test("preview differential rejects unsafe concurrency values", async () => {
  await assert.rejects(
    runListPagesPreviewDifferential({
      referencesPath: "/does/not/matter.jsonl",
      rpcUrl: "http://127.0.0.1:1/jsonrpc",
      siteSlug: "sandbox-for-codex",
      rpcClient: new FakeRpc(new Map()),
      concurrency: 0,
    }),
    /concurrency must be an integer from 1 through 32/,
  );
});
