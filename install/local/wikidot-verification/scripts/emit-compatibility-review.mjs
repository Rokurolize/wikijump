#!/usr/bin/env node

import path from "node:path";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {sealJsonNoReplace} from "../src/standing-browser-parity-util.mjs";
import {validateCompatibilityReview} from "../src/final-frozen-receipt-contract.mjs";
import {sourceIdentity} from "./emit-final-frozen-receipt.mjs";

export function buildCompatibilityReview({axis, source, attestation}) {
  if (!new Set(["standards", "spec"]).has(axis)) {
    throw new Error("review axis must be standards or spec");
  }
  if (attestation !== "zero-findings-reviewed") {
    throw new Error("review requires the explicit zero-findings-reviewed attestation");
  }
  const review = {
    schema: "wikijump.compatibility_review.v1",
    axis,
    status: "pass",
    wikijump_commit: source.wikijump_commit,
    wikijump_tree: source.wikijump_tree,
    findings: [],
  };
  validateCompatibilityReview(review, axis, source);
  return review;
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    if (!["source-root", "axis", "attestation", "output"].includes(name) || Object.hasOwn(args, name)) {
      throw new Error(`unknown or duplicate option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    args[name] = name === "source-root" || name === "output" ? path.resolve(value) : value;
    index += 1;
  }
  for (const name of ["source-root", "axis", "attestation", "output"]) {
    if (!args[name]) throw new Error(`--${name} is required`);
  }
  return args;
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: emit-compatibility-review.mjs --source-root DIR --axis standards|spec --attestation zero-findings-reviewed --output FILE");
    return 0;
  }
  const source = await sourceIdentity(args["source-root"]);
  const review = buildCompatibilityReview({axis: args.axis, source, attestation: args.attestation});
  const sealed = await sealJsonNoReplace(args.output, review);
  console.log(JSON.stringify({schema: review.schema, status: review.status, axis: review.axis, output: sealed.path, sha256: sealed.sha256}));
  return 0;
}

await runCliIfMain(import.meta.url, main);
