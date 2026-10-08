#!/usr/bin/env node
// Offline, read-only review utility for immutable cargo-mutants outcome JSON.
// Nothing here approves survivors: the result reports their exact identities.
import {createHash} from "node:crypto";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";

import {reconcileMutationRuns} from "./test-quality-mutation-reconciliation.mjs";

function main(args) {
  const initial = [];
  const replay = [];
  let output;
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value) throw new Error(`missing value for ${args[i]}`);
    if (args[i] === "--initial") initial.push(value);
    else if (args[i] === "--replay") replay.push(value);
    else if (args[i] === "--output" && !output) output = value;
    else throw new Error(`unrecognized or duplicate option ${args[i]}`);
  }
  if (!output || initial.length === 0) {
    throw new Error("usage: --initial DIR [--initial DIR ...] [--replay DIR ...] --output REPORT.json");
  }
  const sourceFiles = [];
  const readRun = (directory, role) => {
    const root = resolve(directory);
    const file = [resolve(root, "outcomes.json"), resolve(root, "mutants.out/outcomes.json")]
      .find(existsSync);
    if (!file) throw new Error(`${role} lacks an outcomes.json: ${root}`);
    const bytes = readFileSync(file);
    sourceFiles.push({role, path: file, sha256: createHash("sha256").update(bytes).digest("hex")});
    return JSON.parse(bytes.toString("utf8"));
  };
  const report = reconcileMutationRuns({
    baselineRuns: initial.map((dir) => readRun(dir, "initial")),
    replays: replay.map((dir) => readRun(dir, "replay")),
  });
  const result = {...report, source_files: sourceFiles};
  const path = resolve(output);
  if (existsSync(path)) throw new Error(`refusing to overwrite existing reconciliation output: ${path}`);
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, {flag: "wx"});
  process.stdout.write(`Reconciled ${result.frozen_mutants} distinct mutants: ${JSON.stringify(result.reconciled)}; ${result.unresolved_survivors.length} survivors remain for review.\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
