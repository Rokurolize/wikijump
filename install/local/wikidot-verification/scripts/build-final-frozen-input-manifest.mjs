#!/usr/bin/env node

import path from "node:path";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {sealJsonNoReplace} from "../src/standing-browser-parity-util.mjs";
import {validateFinalFrozenInputManifest} from "../src/final-frozen-receipt-contract.mjs";

const REPEATED = new Set(["lockfile", "verifier", "fixture", "tool", "denominator"]);
const SINGLE = new Set(["standards-review", "spec-review", "images", "output"]);

export function buildFinalFrozenInputManifest(args) {
  const manifest = {
    lockfiles: args.lockfile,
    verifier: args.verifier,
    fixtures: args.fixture,
    tools: args.tool,
    denominator: args.denominator,
    reviews: {standards: args["standards-review"], spec: args["spec-review"]},
    images: args.images,
  };
  validateFinalFrozenInputManifest(manifest);
  return manifest;
}

export function parseArgs(argv) {
  const args = Object.fromEntries([...REPEATED].map((name) => [name, []]));
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    if ((!REPEATED.has(name) && !SINGLE.has(name)) || (SINGLE.has(name) && Object.hasOwn(args, name))) {
      throw new Error(`unknown or duplicate option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    const resolved = path.resolve(value);
    if (REPEATED.has(name)) args[name].push(resolved);
    else args[name] = resolved;
    index += 1;
  }
  for (const name of REPEATED) if (args[name].length === 0) throw new Error(`--${name} is required`);
  for (const name of SINGLE) if (!args[name]) throw new Error(`--${name} is required`);
  return args;
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: build-final-frozen-input-manifest.mjs --lockfile FILE --verifier FILE --fixture FILE --tool FILE --denominator FILE --standards-review FILE --spec-review FILE --images FILE --output FILE (repeat list options as needed)");
    return 0;
  }
  const manifest = buildFinalFrozenInputManifest(args);
  const sealed = await sealJsonNoReplace(args.output, manifest);
  console.log(JSON.stringify({status: "pass", output: sealed.path, sha256: sealed.sha256}));
  return 0;
}

await runCliIfMain(import.meta.url, main);
