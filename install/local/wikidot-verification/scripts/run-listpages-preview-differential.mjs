#!/usr/bin/env node

import path from "node:path";

import {
  runListPagesPreviewDifferential,
  writePreviewDifferential,
} from "../src/listpages-preview-differential.mjs";

function nextValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${option}`);
  return value;
}

export function parseArgs(argv) {
  const args = {
    references: null,
    runtimeIdentity: null,
    runtimeProof: null,
    authoritative: false,
    rpcUrl: "http://127.0.0.1:12747/jsonrpc",
    site: "sandbox-for-codex",
    concurrency: 8,
    rpcTimeoutMs: 30_000,
    output: null,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--references") {
      args.references = path.resolve(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--runtime-identity") {
      args.runtimeIdentity = path.resolve(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--runtime-proof") {
      args.runtimeProof = path.resolve(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--authoritative") {
      args.authoritative = true;
    } else if (option === "--rpc-url") {
      args.rpcUrl = nextValue(argv, index, option);
      index += 1;
    } else if (option === "--site") {
      args.site = nextValue(argv, index, option);
      index += 1;
    } else if (option === "--concurrency") {
      args.concurrency = Number(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--rpc-timeout-ms") {
      args.rpcTimeoutMs = Number(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--output") {
      args.output = path.resolve(nextValue(argv, index, option));
      index += 1;
    } else if (option === "--help" || option === "-h") {
      return { help: true };
    } else {
      throw new Error(`unknown argument: ${option}`);
    }
  }
  if (!args.references) throw new Error("--references is required");
  if (!args.output) throw new Error("--output is required");
  if (
    !Number.isSafeInteger(args.rpcTimeoutMs) ||
    args.rpcTimeoutMs < 1 ||
    args.rpcTimeoutMs > 120_000
  ) {
    throw new Error(
      "--rpc-timeout-ms must be an integer from 1 through 120000",
    );
  }
  if (
    args.authoritative &&
    (!args.runtimeIdentity || !args.runtimeProof)
  ) {
    throw new Error(
      "--runtime-identity and --runtime-proof are required with --authoritative",
    );
  }
  return args;
}

function printHelp() {
  console.log("Usage: node install/local/wikidot-verification/scripts/run-listpages-preview-differential.mjs --references FILE --output FILE [--runtime-identity FILE --runtime-proof FILE --authoritative] [--rpc-url URL] [--site sandbox-for-codex] [--concurrency 8] [--rpc-timeout-ms 30000]");
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const verdict = await runListPagesPreviewDifferential({
    referencesPath: args.references,
    runtimeIdentityPath: args.runtimeIdentity,
    runtimeProofPath: args.runtimeProof,
    authoritative: args.authoritative,
    rpcUrl: args.rpcUrl,
    siteSlug: args.site,
    concurrency: args.concurrency,
    rpcTimeoutMs: args.rpcTimeoutMs,
  });
  await writePreviewDifferential(verdict, args.output);
  console.log(JSON.stringify({
    output: args.output,
    summary: verdict.summary,
  }));
  return verdict.summary.exit_code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
