import fs from "node:fs";
import path from "node:path";

import {
  buildCorpusImportManifest,
  buildManifestSummary,
  formatJsonl,
} from "./corpus-import-manifest.mjs";
import {codePointCompare, sha256Hex, stableStringify} from "./canonical-json.mjs";
import {
  selectSavedPageReferences,
  validateSavedPageReference,
} from "./saved-page-runtime-differential.mjs";

export const CORPUS_REFRESH_RECEIPT_SCHEMA =
  "wikijump_syntax_differential.saved_page_corpus_refresh_bundle.v1";

const CAPTURE_METHOD = "wikidot_saved_page_reference.v1";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeNew(filePath, contents) {
  fs.writeFileSync(filePath, contents, {flag: "wx"});
}

function assertSafeFullname(fullname) {
  if (
    typeof fullname !== "string" ||
    fullname.length === 0 ||
    fullname === "." ||
    fullname === ".." ||
    fullname.includes("/") ||
    fullname.includes("\\") ||
    fullname.includes("\0")
  ) {
    throw new Error(`saved-page fullname is unsafe: ${String(fullname)}`);
  }
}

function assertSafeBranch(branch) {
  if (
    typeof branch !== "string" ||
    branch.length === 0 ||
    branch === "." ||
    branch === ".." ||
    branch.includes("/") ||
    branch.includes("\\") ||
    branch.includes("\0")
  ) {
    throw new Error("corpus branch must be one safe path component");
  }
}

function assertPositiveSafeInteger(value, name, caseId) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${caseId}: ${name} must be a positive safe integer`);
  }
}

function validatePublicScpWikiReference(reference) {
  validateSavedPageReference(reference);
  const caseId = reference.case?.case_id;
  if (typeof caseId !== "string" || caseId.length === 0) {
    throw new Error("saved-page case_id must be a non-empty string");
  }
  if (
    reference.site?.unix_name !== "scp-wiki" ||
    reference.site?.domain !== "scp-wiki.wikidot.com" ||
    reference.case?.site !== "scp-wiki"
  ) {
    throw new Error(`${caseId}: saved-page reference must be for public scp-wiki`);
  }
  if (
    reference.page?.slug !== reference.case?.slug ||
    typeof reference.page.source_wikitext !== "string"
  ) {
    throw new Error(`${caseId}: saved-page source is missing or belongs to another page`);
  }
  if (typeof reference.page.title !== "string" || reference.page.title.length === 0) {
    throw new Error(`${caseId}: saved-page title must be a non-empty string`);
  }
  if (typeof reference.captured_at !== "string" || Number.isNaN(Date.parse(reference.captured_at))) {
    throw new Error(`${caseId}: saved-page capture time is invalid`);
  }
  assertPositiveSafeInteger(reference.page.identity, "page identity", caseId);
  assertPositiveSafeInteger(reference.page.revision_identity, "revision identity", caseId);
  assertPositiveSafeInteger(reference.page.revision_number, "revision number", caseId);
  assertSafeFullname(reference.page.slug);
  return reference;
}

function assertUniqueReferences(references) {
  const caseIds = new Set();
  const fullnames = new Set();
  for (const reference of references) {
    const caseId = reference.case.case_id;
    const fullname = reference.page.slug;
    if (caseIds.has(caseId)) {
      throw new Error(`duplicate saved-page case_id: ${caseId}`);
    }
    if (fullnames.has(fullname)) {
      throw new Error(`duplicate saved-page fullname: ${fullname}`);
    }
    caseIds.add(caseId);
    fullnames.add(fullname);
  }
}

export function parseSavedPageReferenceJsonl(contents) {
  if (typeof contents !== "string") {
    throw new Error("saved-page references must be UTF-8 JSONL text");
  }
  const references = contents
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`saved-page reference line ${index + 1} is invalid JSON`, {cause: error});
      }
    })
    .map(validatePublicScpWikiReference);
  if (references.length === 0) {
    throw new Error("saved-page reference JSONL must contain at least one reference");
  }
  assertUniqueReferences(references);
  return references;
}

function refreshedMeta(baseMeta, reference, sourceBytes, sourceSha256) {
  return {
    ...baseMeta,
    capture_method: CAPTURE_METHOD,
    captured_at: reference.captured_at,
    page_identity: reference.page.identity,
    revision_identity: reference.page.revision_identity,
    revision_number: reference.page.revision_number,
    wikidot_py_version: reference.provenance.wikidot_py_version,
    wikidot_py_commit: reference.provenance.wikidot_py_commit,
    requirements_sha256: reference.provenance.requirements_sha256,
    requirements_lock_sha256: reference.provenance.requirements_lock_sha256,
    source_browser_visibility: "browser_visible",
    source_browser_status: 200,
    source_visibility_reason: "anonymous_saved_page_reference",
    source_bytes: sourceBytes,
    source_sha256: sourceSha256,
    title: reference.page.title,
    title_shown: reference.page.title,
    revisions: reference.page.revision_number,
  };
}

function caseReceipt({
  reference,
  referenceSha256,
  baseRow,
  baseEntityBytes,
  sourceBytes,
  metaBytes,
}) {
  const sourceSha256 = sha256Hex(sourceBytes);
  const baseSourceSha256 = baseRow.source_sha256;
  return {
    case_id: reference.case.case_id,
    fullname: reference.page.slug,
    input: {
      reference_sha256: referenceSha256,
      corpus_source_sha256: baseSourceSha256,
      corpus_meta_sha256: baseRow.meta_sha256,
      corpus_entity_sha256: sha256Hex(baseEntityBytes),
    },
    live: {
      page_identity: reference.page.identity,
      revision_identity: reference.page.revision_identity,
      revision_number: reference.page.revision_number,
      source_sha256: reference.page.source_sha256,
      title: reference.page.title,
      captured_at: reference.captured_at,
    },
    drift_classification:
      sourceSha256 === baseSourceSha256 ? "no-source-drift" : "source-drift",
    output: {
      source_path: `pages/${reference.page.slug}/source.wikidot.txt`,
      source_bytes: sourceBytes.length,
      source_sha256: sourceSha256,
      meta_path: `pages/${reference.page.slug}/meta.json`,
      meta_sha256: sha256Hex(metaBytes),
      entity_path: `pages/${reference.page.slug}/entity_id.txt`,
      entity_sha256: sha256Hex(baseEntityBytes),
    },
  };
}

export function buildSavedPageCorpusRefreshBundle({
  referencesPath,
  caseIds,
  corpusRoot,
  branch,
  outputDir,
  allowNoDrift = false,
}) {
  if (!Array.isArray(caseIds) || caseIds.length === 0) {
    throw new Error("at least one --case-id selection is required");
  }
  assertSafeBranch(branch);

  const referencesBytes = fs.readFileSync(referencesPath);
  const allReferences = parseSavedPageReferenceJsonl(referencesBytes.toString("utf8"));
  const references = selectSavedPageReferences(allReferences, caseIds);
  const fullnames = references.map((reference) => reference.page.slug);
  const baseRows = buildCorpusImportManifest({
    corpusRoot,
    branch,
    sourceSite: "scp-wiki",
    sourceBranch: branch,
    fullnames,
  });
  const baseByFullname = new Map(baseRows.map((row) => [row.fullname, row]));
  const planned = references.map((reference) => {
    const baseRow = baseByFullname.get(reference.page.slug);
    if (!baseRow) {
      throw new Error(`${reference.case.case_id}: corpus page is missing`);
    }
    const sourceBytes = Buffer.from(reference.page.source_wikitext, "utf8");
    if (sha256Hex(sourceBytes) !== reference.page.source_sha256) {
      throw new Error(`${reference.case.case_id}: frozen source identity changed`);
    }
    const pageDir = path.join(corpusRoot, branch, "pages", reference.page.slug);
    const baseMeta = readJson(path.join(pageDir, "meta.json"));
    const baseEntityBytes = fs.readFileSync(path.join(pageDir, "entity_id.txt"));
    const metaBytes = Buffer.from(
      `${stableStringify(refreshedMeta(
        baseMeta,
        reference,
        sourceBytes.length,
        reference.page.source_sha256,
      ))}\n`,
      "utf8",
    );
    const receiptCase = caseReceipt({
      reference,
      referenceSha256: sha256Hex(`${stableStringify(reference)}\n`),
      baseRow,
      baseEntityBytes,
      sourceBytes,
      metaBytes,
    });
    if (!allowNoDrift && receiptCase.drift_classification === "no-source-drift") {
      throw new Error(
        `${reference.case.case_id}: frozen source does not drift from the corpus; use --allow-no-drift only for an intentional metadata refresh`,
      );
    }
    return {reference, sourceBytes, metaBytes, baseEntityBytes, receiptCase};
  });

  const absoluteOutputDir = path.resolve(outputDir);
  fs.mkdirSync(path.dirname(absoluteOutputDir), {recursive: true});
  fs.mkdirSync(absoluteOutputDir);
  try {
    fs.mkdirSync(path.join(absoluteOutputDir, "pages"));
    for (const item of planned.sort((left, right) =>
      codePointCompare(left.reference.page.slug, right.reference.page.slug))) {
      const pageDir = path.join(absoluteOutputDir, "pages", item.reference.page.slug);
      fs.mkdirSync(pageDir);
      writeNew(path.join(pageDir, "source.wikidot.txt"), item.sourceBytes);
      writeNew(path.join(pageDir, "meta.json"), item.metaBytes);
      writeNew(path.join(pageDir, "entity_id.txt"), item.baseEntityBytes);
    }

    const manifestRows = buildCorpusImportManifest({
      sourceBundleRoot: absoluteOutputDir,
      sourceSite: "scp-wiki",
      sourceBranch: branch,
    });
    const manifest = formatJsonl(manifestRows);
    const summary = buildManifestSummary(manifestRows, manifest);
    const summaryBytes = `${stableStringify(summary)}\n`;
    writeNew(path.join(absoluteOutputDir, "import-manifest.jsonl"), manifest);
    writeNew(path.join(absoluteOutputDir, "import-summary.json"), summaryBytes);

    const receipt = {
      schema: CORPUS_REFRESH_RECEIPT_SCHEMA,
      status: "pass",
      source_site: "scp-wiki",
      source_branch: branch,
      inputs: {
        saved_page_references_sha256: sha256Hex(referencesBytes),
        selected_case_ids_sha256: sha256Hex(`${stableStringify(caseIds)}\n`),
      },
      cases: planned
        .map((item) => item.receiptCase)
        .sort((left, right) => codePointCompare(left.case_id, right.case_id)),
      generated: {
        import_manifest: {
          path: "import-manifest.jsonl",
          sha256: sha256Hex(manifest),
        },
        import_summary: {
          path: "import-summary.json",
          sha256: sha256Hex(summaryBytes),
        },
      },
    };
    writeNew(
      path.join(absoluteOutputDir, "receipt.json"),
      `${stableStringify(receipt)}\n`,
    );
    return receipt;
  } catch (error) {
    fs.rmSync(absoluteOutputDir, {recursive: true, force: true});
    throw error;
  }
}
