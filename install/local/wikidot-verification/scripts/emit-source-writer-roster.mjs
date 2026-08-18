#!/usr/bin/env node

import path from "node:path";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {sealJsonNoReplace} from "../src/standing-browser-parity-util.mjs";
import {validateSourceWriterRoster} from "../src/final-frozen-receipt-contract.mjs";
import {sourceIdentity} from "./emit-final-frozen-receipt.mjs";

export function buildSourceWriterRoster({source, lanes}) {
  if (!Array.isArray(lanes) || lanes.length === 0 || lanes.some((lane) => typeof lane !== "string" || lane === "")) {
    throw new Error("source writer roster requires one or more lane names");
  }
  if (new Set(lanes).size !== lanes.length) throw new Error("source writer roster lane names must be unique");
  const roster = {
    schema: "wikijump.phase4.source_writer_roster.v1",
    status: "pass",
    wikijump_commit: source.wikijump_commit,
    wikijump_tree: source.wikijump_tree,
    lanes: lanes.map((name) => ({name, state: "stopped"})),
  };
  validateSourceWriterRoster(roster, source);
  return roster;
}

export function parseArgs(argv) {
  const args = {lane: []};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    if (!["source-root", "lane", "output"].includes(name) || (name !== "lane" && Object.hasOwn(args, name))) {
      throw new Error(`unknown or duplicate option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (name === "lane") args.lane.push(value);
    else args[name] = path.resolve(value);
  }
  for (const name of ["source-root", "output"]) if (!args[name]) throw new Error(`--${name} is required`);
  if (args.lane.length === 0) throw new Error("--lane is required");
  return args;
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: emit-source-writer-roster.mjs --source-root DIR --lane NAME [--lane NAME ...] --output FILE");
    return 0;
  }
  const source = await sourceIdentity(args["source-root"]);
  const roster = buildSourceWriterRoster({source, lanes: args.lane});
  const sealed = await sealJsonNoReplace(args.output, roster);
  console.log(JSON.stringify({schema: roster.schema, status: roster.status, output: sealed.path, sha256: sealed.sha256}));
  return 0;
}

await runCliIfMain(import.meta.url, main);
