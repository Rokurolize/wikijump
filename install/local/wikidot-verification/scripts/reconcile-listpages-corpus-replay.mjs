#!/usr/bin/env node

import path from "node:path";

import {
  reconcileListPagesCorpusReplay,
  writeListPagesCorpusReplayReconciliation,
} from "../src/listpages-corpus-replay-reconciliation.mjs";

function nextValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${option}`);
  }
  return value;
}

export function parseArgs(argv) {
  const args = {
    invocations: null,
    classifications: [],
    output: null,
    authoritative: false,
    campaignScope: null,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--invocations") {
      args.invocations = path.resolve(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--classification") {
      args.classifications.push(
        path.resolve(nextValue(argv, index, option)),
      );
      index += 1;
    } else if (option === "--output") {
      args.output = path.resolve(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--authoritative") {
      args.authoritative = true;
    } else if (option === "--campaign-scope") {
      args.campaignScope = path.resolve(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--help" || option === "-h") {
      return { help: true };
    } else {
      throw new Error(`unknown argument: ${option}`);
    }
  }
  if (!args.invocations) throw new Error("--invocations is required");
  if (args.classifications.length === 0) {
    throw new Error("--classification is required");
  }
  if (!args.output) throw new Error("--output is required");
  if (args.authoritative && !args.campaignScope) {
    throw new Error("--campaign-scope is required with --authoritative");
  }
  return args;
}

function printHelp() {
  console.log(
    "Usage: node install/local/wikidot-verification/scripts/reconcile-listpages-corpus-replay.mjs --invocations FILE --classification FILE [--classification FILE ...] --output FILE [--authoritative --campaign-scope FILE]",
  );
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const reconciliation = await reconcileListPagesCorpusReplay({
    invocationsPath: args.invocations,
    classificationPaths: args.classifications,
    authoritative: args.authoritative,
    campaignScopePath: args.campaignScope,
  });
  await writeListPagesCorpusReplayReconciliation(
    reconciliation,
    args.output,
  );
  console.log(
    JSON.stringify({
      output: args.output,
      summary: reconciliation.summary,
    }),
  );
  return reconciliation.summary.exit_code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
