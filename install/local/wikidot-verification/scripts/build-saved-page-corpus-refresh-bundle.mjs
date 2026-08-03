#!/usr/bin/env node

import path from "node:path";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {stableStringify} from "../src/canonical-json.mjs";
import {buildSavedPageCorpusRefreshBundle} from "../src/saved-page-corpus-refresh-bundle.mjs";

export function usage() {
  return "Usage: build-saved-page-corpus-refresh-bundle.mjs --references <saved-pages.jsonl> --case-id <id> [--case-id <id>...] --corpus-root <path> --branch <branch> --output-dir <path> [--allow-no-drift]";
}

function nextValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseArgs(argv) {
  const args = {
    references: null,
    caseIds: [],
    corpusRoot: null,
    branch: null,
    outputDir: null,
    allowNoDrift: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--references") args.references = nextValue(argv, index++, option);
    else if (option === "--case-id") args.caseIds.push(nextValue(argv, index++, option));
    else if (option === "--corpus-root") args.corpusRoot = nextValue(argv, index++, option);
    else if (option === "--branch") args.branch = nextValue(argv, index++, option);
    else if (option === "--output-dir") args.outputDir = nextValue(argv, index++, option);
    else if (option === "--allow-no-drift") args.allowNoDrift = true;
    else if (option === "--help" || option === "-h") return {help: true};
    else throw new Error(`unknown option: ${option}`);
  }
  for (const option of ["references", "corpusRoot", "branch", "outputDir"]) {
    if (!args[option]) {
      throw new Error(`--${option.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`);
    }
  }
  if (args.caseIds.length === 0) throw new Error("at least one --case-id is required");
  return args;
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const receipt = buildSavedPageCorpusRefreshBundle({
    referencesPath: path.resolve(args.references),
    caseIds: args.caseIds,
    corpusRoot: path.resolve(args.corpusRoot),
    branch: args.branch,
    outputDir: path.resolve(args.outputDir),
    allowNoDrift: args.allowNoDrift,
  });
  console.log(stableStringify({
    cases: receipt.cases.length,
    manifest_sha256: receipt.generated.import_manifest.sha256,
    status: "pass",
  }));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error);
    return 2;
  },
});
