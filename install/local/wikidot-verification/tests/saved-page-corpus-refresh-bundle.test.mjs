import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSavedPageCorpusRefreshBundle,
  parseSavedPageReferenceJsonl,
} from "../src/saved-page-corpus-refresh-bundle.mjs";
import {sha256Hex} from "../src/canonical-json.mjs";
import {parseArgs} from "../scripts/build-saved-page-corpus-refresh-bundle.mjs";
import {writePage} from "./support/corpus-import-manifest-fixture.mjs";

const CASE_ID = "scp-7446-stray-open-include";
const FULLNAME = "scp-7446";
const ENTITY_ID = "74467446-7446-4744-8744-674467446744";

function reference({
  caseId = CASE_ID,
  fullname = FULLNAME,
  site = "scp-wiki",
  source = "frozen live source",
  title = "Live SCP-7446-D",
} = {}) {
  const selectedHtml = '<div class="anom-bar-container">live</div>';
  return {
    schema: "wikijump_syntax_differential.wikidot_saved_page_reference.v1",
    case: {
      schema: "wikijump_syntax_differential.saved_page_plan.v1",
      case_id: caseId,
      site,
      slug: fullname,
      selector: ".anom-bar-container",
      expected: {
        required_class_tokens: ["anom-bar-container"],
        forbidden_literals: ["[[include"],
      },
    },
    captured_at: "2026-07-26T23:00:00+00:00",
    actor: {authenticated: false},
    site: {
      unix_name: site,
      domain: site === "scp-wiki" ? "scp-wiki.wikidot.com" : `${site}.wikidot.com`,
    },
    page: {
      slug: fullname,
      identity: 1449082486,
      title,
      revision_identity: 1517016889,
      revision_number: 15,
      source_wikitext: source,
      source_sha256: sha256Hex(source),
    },
    selected_html: selectedHtml,
    selected_html_sha256: sha256Hex(selectedHtml),
    provenance: {
      transport: "anonymous-https",
      mutated: false,
      wikidot_py_version: "4.4.1",
      wikidot_py_commit: "1".repeat(40),
      requirements_sha256: "2".repeat(64),
      requirements_lock_sha256: "3".repeat(64),
    },
  };
}

function fixture({baseSource = "stale corpus source", liveSource = "frozen live source"} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "saved-page-refresh-"));
  const corpusRoot = path.join(root, "corpus");
  const referencesPath = path.join(root, "references.jsonl");
  const outputDir = path.join(root, "bundle");
  writePage(corpusRoot, "en", FULLNAME, {
    entityId: ENTITY_ID,
    source: baseSource,
    meta: {
      title: "Stale title",
      title_shown: "Stale title",
      revisions: 12,
      tags: ["scp", "decommissioned"],
    },
  });
  fs.writeFileSync(referencesPath, `${JSON.stringify(reference({source: liveSource}))}\n`);
  return {root, corpusRoot, referencesPath, outputDir};
}

test("buildSavedPageCorpusRefreshBundle preserves corpus identity and emits a source-bound manifest receipt", () => {
  const value = fixture();
  const receipt = buildSavedPageCorpusRefreshBundle({
    referencesPath: value.referencesPath,
    caseIds: [CASE_ID],
    corpusRoot: value.corpusRoot,
    branch: "en",
    outputDir: value.outputDir,
  });

  const pageDir = path.join(value.outputDir, "pages", FULLNAME);
  const outputMeta = JSON.parse(fs.readFileSync(path.join(pageDir, "meta.json"), "utf8"));
  const manifest = fs.readFileSync(path.join(value.outputDir, "import-manifest.jsonl"), "utf8");
  const manifestRow = JSON.parse(manifest.trim());
  const summaryBytes = fs.readFileSync(path.join(value.outputDir, "import-summary.json"));
  const receiptBytes = fs.readFileSync(path.join(value.outputDir, "receipt.json"));

  assert.equal(fs.readFileSync(path.join(pageDir, "source.wikidot.txt"), "utf8"), "frozen live source");
  assert.equal(fs.readFileSync(path.join(pageDir, "entity_id.txt"), "utf8"), `${ENTITY_ID}\n`);
  assert.deepEqual(outputMeta.tags, ["scp", "decommissioned"]);
  assert.equal(outputMeta.title, "Live SCP-7446-D");
  assert.equal(outputMeta.title_shown, "Live SCP-7446-D");
  assert.equal(outputMeta.revisions, 15);
  assert.equal(outputMeta.page_identity, 1449082486);
  assert.equal(outputMeta.revision_identity, 1517016889);
  assert.equal(outputMeta.capture_method, "wikidot_saved_page_reference.v1");
  assert.equal(outputMeta.source_browser_visibility, "browser_visible");
  assert.equal(manifestRow.source_site, "scp-wiki");
  assert.equal(manifestRow.source_branch, "en");
  assert.equal(manifestRow.source_entity_id, ENTITY_ID);
  assert.equal(manifestRow.source_sha256, sha256Hex("frozen live source"));
  assert.equal(manifestRow.revisions, 15);
  assert.equal(receipt.cases[0].drift_classification, "source-drift");
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.cases[0].live.revision_identity, 1517016889);
  assert.equal(receipt.cases[0].input.corpus_source_sha256, sha256Hex("stale corpus source"));
  assert.equal(receipt.generated.import_manifest.sha256, sha256Hex(manifest));
  assert.equal(receipt.generated.import_summary.sha256, sha256Hex(summaryBytes));
  assert.deepEqual(JSON.parse(receiptBytes), receipt);
});

test("buildSavedPageCorpusRefreshBundle fails closed on non-drift unless explicitly allowed", () => {
  const rejected = fixture({baseSource: "same", liveSource: "same"});
  assert.throws(
    () => buildSavedPageCorpusRefreshBundle({
      referencesPath: rejected.referencesPath,
      caseIds: [CASE_ID],
      corpusRoot: rejected.corpusRoot,
      branch: "en",
      outputDir: rejected.outputDir,
    }),
    /does not drift from the corpus/,
  );
  assert.equal(fs.existsSync(rejected.outputDir), false);

  const allowed = fixture({baseSource: "same", liveSource: "same"});
  const receipt = buildSavedPageCorpusRefreshBundle({
    referencesPath: allowed.referencesPath,
    caseIds: [CASE_ID],
    corpusRoot: allowed.corpusRoot,
    branch: "en",
    outputDir: allowed.outputDir,
    allowNoDrift: true,
  });
  assert.equal(receipt.cases[0].drift_classification, "no-source-drift");
});

test("saved-page corpus refresh references reject duplicates, wrong sites, and mismatched source identities", () => {
  const valid = reference();
  assert.throws(
    () => parseSavedPageReferenceJsonl(`${JSON.stringify(valid)}\n${JSON.stringify(valid)}\n`),
    /duplicate saved-page case_id/,
  );
  assert.throws(
    () => parseSavedPageReferenceJsonl(`${JSON.stringify(reference({site: "scp-jp"}))}\n`),
    /must be for public scp-wiki/,
  );
  const mismatched = structuredClone(valid);
  mismatched.page.source_sha256 = "0".repeat(64);
  assert.throws(
    () => parseSavedPageReferenceJsonl(`${JSON.stringify(mismatched)}\n`),
    /source text does not match its identity/,
  );
});

test("buildSavedPageCorpusRefreshBundle rejects duplicate selections and missing corpus pages", () => {
  const value = fixture();
  assert.throws(
    () => buildSavedPageCorpusRefreshBundle({
      referencesPath: value.referencesPath,
      caseIds: [],
      corpusRoot: value.corpusRoot,
      branch: "en",
      outputDir: value.outputDir,
    }),
    /at least one --case-id selection is required/,
  );
  assert.throws(
    () => buildSavedPageCorpusRefreshBundle({
      referencesPath: value.referencesPath,
      caseIds: [CASE_ID, CASE_ID],
      corpusRoot: value.corpusRoot,
      branch: "en",
      outputDir: value.outputDir,
    }),
    /case filters must be unique/,
  );
  assert.throws(
    () => buildSavedPageCorpusRefreshBundle({
      referencesPath: value.referencesPath,
      caseIds: ["unknown-case"],
      corpusRoot: value.corpusRoot,
      branch: "en",
      outputDir: value.outputDir,
    }),
    /case filters are absent from the references: unknown-case/,
  );
  assert.throws(
    () => buildSavedPageCorpusRefreshBundle({
      referencesPath: value.referencesPath,
      caseIds: [CASE_ID],
      corpusRoot: value.corpusRoot,
      branch: "missing",
      outputDir: value.outputDir,
    }),
    /ENOENT/,
  );
});

test("buildSavedPageCorpusRefreshBundle never replaces an existing output directory", () => {
  const value = fixture();
  fs.mkdirSync(value.outputDir);
  fs.writeFileSync(path.join(value.outputDir, "keep.txt"), "keep");
  assert.throws(
    () => buildSavedPageCorpusRefreshBundle({
      referencesPath: value.referencesPath,
      caseIds: [CASE_ID],
      corpusRoot: value.corpusRoot,
      branch: "en",
      outputDir: value.outputDir,
    }),
    /EEXIST/,
  );
  assert.equal(fs.readFileSync(path.join(value.outputDir, "keep.txt"), "utf8"), "keep");
});

test("saved-page corpus refresh CLI accepts repeated explicit case selections", () => {
  const args = parseArgs([
    "--references", "references.jsonl",
    "--case-id", CASE_ID,
    "--case-id", "fragment-scp-9988-2-stray-open-include",
    "--corpus-root", "corpus",
    "--branch", "en",
    "--output-dir", "bundle",
    "--allow-no-drift",
  ]);
  assert.deepEqual(args.caseIds, [
    CASE_ID,
    "fragment-scp-9988-2-stray-open-include",
  ]);
  assert.equal(args.allowNoDrift, true);
  assert.throws(
    () => parseArgs([
      "--references", "references.jsonl",
      "--corpus-root", "corpus",
      "--branch", "en",
      "--output-dir", "bundle",
    ]),
    /at least one --case-id is required/,
  );
});
