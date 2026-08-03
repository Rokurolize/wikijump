#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const verifierRoot = path.resolve(scriptDirectory, "..");
const defaultOutputRoot = path.join(verifierRoot, "fixtures", "listpages-late-evidence");
const defaultManifest = path.join(
  verifierRoot,
  "artifacts",
  "listpages-late-evidence-manifest.json",
);
const htmlContextFiles = [
  "identity.json",
  "scp-wiki-anonymous.jsonl",
  "fondazionescp-scp-245-live-source.wikidot.txt",
  "fondazionescp-scp-245-saved-page.html",
  "fondazionescp-scp-245-html-frame.html",
];

const families = [
  ["primary", "category-name", [986]],
  ["primary", "exact-metadata", [987]],
  ["primary", "linked-variable-phase", [988]],
  ["primary", "section-grammar", [985]],
  ["primary", "tag-selector", [989]],
  ["primary", "tag-selector-extended", [989]],
  ["primary", "unknown-variable", [984]],
  ["continuation", "author-grammar", [998]],
  ["continuation", "boolean-structure", [1002]],
  ["continuation", "date-alias", [996]],
  ["continuation", "date-scalar-grammar", [997]],
  ["continuation", "generated-heading", [1010]],
  ["continuation", "line-head", [1008]],
  ["continuation", "noncomparison-operator", [990]],
  ["continuation", "numeric-head-grammar", [1005]],
  ["continuation", "offset-boundary", [999]],
  ["continuation", "offset-i63", [999]],
  ["continuation", "offset-threshold", [999]],
  ["continuation", "pager-dom", [1004]],
  ["continuation", "pagetype", [993]],
  ["continuation", "parent-selector", [992]],
  ["continuation", "perpage-zero", [1000]],
  ["continuation", "range-grammar", [1001]],
  ["continuation", "rating-votes-grammar", [994]],
  ["continuation", "reverse-grammar", [1003]],
  ["continuation", "rss-grammar", [1007]],
  ["continuation", "score-alias", [995]],
  ["continuation", "selector-head-grammar", [1006]],
  ["continuation", "unquoted-comparison", [991]],
  ["continuation", "zero-line-block", [1009]],
  ["continuation", "zero-line-dom", [1009]],
];

function parseArgs(argv) {
  const args = {
    check: false,
    htmlOnly: false,
    primaryRoot: null,
    continuationRoot: null,
    outputRoot: defaultOutputRoot,
    manifest: defaultManifest,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--check") {
      args.check = true;
    } else if (option === "--html-only") {
      args.htmlOnly = true;
    } else if (option === "--primary-root") {
      args.primaryRoot = path.resolve(argv[++index]);
    } else if (option === "--continuation-root") {
      args.continuationRoot = path.resolve(argv[++index]);
    } else if (option === "--output-root") {
      args.outputRoot = path.resolve(argv[++index]);
    } else if (option === "--manifest") {
      args.manifest = path.resolve(argv[++index]);
    } else {
      throw new Error(`unknown argument: ${option}`);
    }
  }
  if (!args.check && !args.primaryRoot) {
    throw new Error("--primary-root is required when importing");
  }
  if (!args.check && !args.htmlOnly && !args.continuationRoot) {
    throw new Error("--primary-root and --continuation-root are required when importing");
  }
  return args;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseJsonl(bytes, filePath) {
  const text = bytes.toString("utf8");
  assert.ok(text.endsWith("\n"), `${filePath} must end with a newline`);
  return text
    .trim()
    .split("\n")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

async function readPair(root, family) {
  const casesPath = path.join(root, `${family}-cases.jsonl`);
  const livePath = path.join(root, `${family}-live.jsonl`);
  const [casesBytes, liveBytes] = await Promise.all([
    fs.readFile(casesPath),
    fs.readFile(livePath),
  ]);
  const cases = parseJsonl(casesBytes, casesPath);
  const live = parseJsonl(liveBytes, livePath);
  assert.equal(cases.length, live.length, `${family} case/reference count differs`);
  assert.deepEqual(
    cases.map(({ case_id: caseId }) => caseId),
    live.map(({ syntax_case: syntaxCase }) => syntaxCase.case_id),
    `${family} case/reference IDs differ`,
  );
  for (const reference of live) {
    assert.equal(
      reference.schema,
      "wikijump_syntax_differential.wikidot_reference.v1",
    );
    assert.equal(reference.provenance.authenticated, false);
    assert.equal(reference.provenance.mutated, false);
  }
  return { casesBytes, liveBytes, count: cases.length };
}

async function readHtmlContext(outputRoot) {
  const contextRoot = path.join(outputRoot, "html-preview-context");
  const files = {};
  for (const filename of htmlContextFiles) {
    const bytes = await fs.readFile(path.join(contextRoot, filename));
    files[filename] = {
      path: `install/local/wikidot-verification/fixtures/listpages-late-evidence/html-preview-context/${filename}`,
      sha256: sha256(bytes),
      bytes,
    };
  }
  const preview = parseJsonl(
    files["scp-wiki-anonymous.jsonl"].bytes,
    files["scp-wiki-anonymous.jsonl"].path,
  );
  for (const reference of preview) {
    assert.equal(reference.site, "scp-wiki");
    assert.equal(reference.actor, "anonymous");
    assert.equal(reference.authenticated, false);
  }
  return {
    issue: 983,
    preview_case_count: preview.length,
    files: Object.fromEntries(
      Object.entries(files).map(([filename, { path: filePath, sha256: hash }]) => [
        filename,
        { path: filePath, sha256: hash },
      ]),
    ),
  };
}

async function buildManifest(outputRoot) {
  const entries = [];
  for (const [source, family, issues] of families) {
    const pair = await readPair(outputRoot, family);
    entries.push({
      family,
      issues,
      source_capture: source,
      case_count: pair.count,
      cases: {
        path: `install/local/wikidot-verification/fixtures/listpages-late-evidence/${family}-cases.jsonl`,
        sha256: sha256(pair.casesBytes),
      },
      live_references: {
        path: `install/local/wikidot-verification/fixtures/listpages-late-evidence/${family}-live.jsonl`,
        sha256: sha256(pair.liveBytes),
      },
    });
  }
  const htmlPreviewContext = await readHtmlContext(outputRoot);
  return {
    schema: "wikijump.listpages_late_evidence_manifest.v1",
    authority:
      "Frozen live Wikidot PagePreview and saved-page references for issues #983-#1010.",
    family_count: entries.length + 1,
    case_count:
      entries.reduce((total, entry) => total + entry.case_count, 0) +
      htmlPreviewContext.preview_case_count,
    html_preview_context: htmlPreviewContext,
    entries,
  };
}

async function importHtmlContext(args) {
  const sourceRoot = path.join(args.primaryRoot, "html-preview-context");
  const outputRoot = path.join(args.outputRoot, "html-preview-context");
  await fs.mkdir(outputRoot, { recursive: true });
  for (const filename of htmlContextFiles) {
    await fs.copyFile(
      path.join(sourceRoot, filename),
      path.join(outputRoot, filename),
      fs.constants.COPYFILE_EXCL,
    );
  }
}

async function importPairs(args) {
  await fs.mkdir(args.outputRoot, { recursive: true });
  for (const [source, family] of families) {
    const sourceRoot =
      source === "primary" ? args.primaryRoot : args.continuationRoot;
    const pair = await readPair(sourceRoot, family);
    await Promise.all([
      fs.writeFile(
        path.join(args.outputRoot, `${family}-cases.jsonl`),
        pair.casesBytes,
        { flag: "wx", mode: 0o644 },
      ),
      fs.writeFile(
        path.join(args.outputRoot, `${family}-live.jsonl`),
        pair.liveBytes,
        { flag: "wx", mode: 0o644 },
      ),
    ]);
  }
  await importHtmlContext(args);
  const manifest = await buildManifest(args.outputRoot);
  await fs.mkdir(path.dirname(args.manifest), { recursive: true });
  await fs.writeFile(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  return manifest;
}

async function importHtmlOnly(args) {
  await importHtmlContext(args);
  const manifest = await buildManifest(args.outputRoot);
  await fs.mkdir(path.dirname(args.manifest), { recursive: true });
  await fs.writeFile(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  return manifest;
}

async function checkPairs(args) {
  const expected = await buildManifest(args.outputRoot);
  const actual = JSON.parse(await fs.readFile(args.manifest, "utf8"));
  assert.deepEqual(actual, expected, "late ListPages evidence manifest is stale");
  return actual;
}

const args = parseArgs(process.argv);
const manifest = args.check
  ? await checkPairs(args)
  : args.htmlOnly
    ? await importHtmlOnly(args)
    : await importPairs(args);
console.log(
  JSON.stringify({
    mode: args.check ? "check" : args.htmlOnly ? "html-only" : "import",
    family_count: manifest.family_count,
    case_count: manifest.case_count,
    manifest: args.manifest,
  }),
);
