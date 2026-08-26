#!/usr/bin/env node

import path from "node:path";

import {
  candidateCaseUsage,
  parseCandidateCaseArgs,
  runCandidateCaseCommand,
} from "../src/candidate-case-command.mjs";
import { withCandidateGlobalLease } from "../src/candidate-global-lease.mjs";
import { canonicalJson } from "../src/standing-browser-parity-util.mjs";

async function main(argv = process.argv.slice(2)) {
  const args = parseCandidateCaseArgs(argv);
  if (args.help) return void process.stdout.write(`${candidateCaseUsage()}\n`);
  const outputDir = path.resolve(args["output-dir"]);
  const result = await withCandidateGlobalLease(
    {runId: args["run-id"], evidenceDirectory: path.dirname(outputDir)},
    () => runCandidateCaseCommand(args),
  );
  process.stdout.write(canonicalJson(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
