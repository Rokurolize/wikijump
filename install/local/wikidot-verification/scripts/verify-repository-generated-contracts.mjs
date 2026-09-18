#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { verifyTrackedContractConsistency } from "../src/repository-generated-contracts.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../../..");
const INVENTORY = "docs/development/compatibility-surface-inventory.json";
const SEMANTICS = "docs/development/compatibility-surface-semantics.json";
const DEEPWELL = "docs/development/deepwell-jsonrpc-contract-manifest.json";
const WWS = "docs/development/wws-route-registration-denominator.json";
const GIT = "/usr/bin/git";
const GIT_ENV = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

function usage() {
  return `Usage: node ${path.basename(process.argv[1])} [--root REPOSITORY] [--full]\n\n` +
    "Default verification is repository-only and safe for GitHub Actions. --full additionally regenerates the compatibility inventory from the exact local HEAD and compares its bytes.";
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  let full = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--full") full = true;
    else if (argument === "--root") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`missing --root value\n${usage()}`);
      root = path.resolve(value);
    } else throw new Error(`unknown option: ${argument}\n${usage()}`);
  }
  return { root, full, help: false };
}

function run(root, relativeScript, args) {
  const result = spawnSync(process.execPath, [path.join(root, relativeScript), ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${relativeScript} failed with exit ${result.status ?? "unknown"}`);
  }
  if (result.stdout) process.stdout.write(result.stdout);
}

async function readJson(root, relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
}

function exactHeadCommit(root) {
  const result = spawnSync(
    GIT,
    ["--no-replace-objects", "-C", root, "rev-parse", "--verify", "HEAD^{commit}"],
    {
      encoding: "utf8",
      env: GIT_ENV,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const commit = result.stdout?.trim() ?? "";
  if (result.status !== 0 || !/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error("cannot resolve exact local HEAD commit");
  }
  return commit;
}

async function verifyFullInventory(root) {
  const temporary = `.compatibility-surface-inventory.verify-${process.pid}.json`;
  const temporaryPath = path.join(root, temporary);
  try {
    await fs.rm(temporaryPath, { force: true });
    const sourceRevision = exactHeadCommit(root);
    run(root, "install/local/wikidot-verification/scripts/build-compatibility-surface-inventory.mjs", [
      "--root", root,
      "--output", temporaryPath,
      "--source-revision", sourceRevision,
    ]);
    const [tracked, regenerated] = await Promise.all([
      fs.readFile(path.join(root, INVENTORY)),
      fs.readFile(temporaryPath),
    ]);
    if (!tracked.equals(regenerated)) throw new Error(`${INVENTORY} is stale; regenerate it from the exact current source identity`);
    process.stdout.write(`verified full compatibility inventory bytes at ${sourceRevision}: ${INVENTORY}\n`);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return void process.stdout.write(`${usage()}\n`);
  const root = await fs.realpath(options.root);
  run(root, "install/local/wikidot-verification/scripts/build-deepwell-jsonrpc-contract-manifest.mjs", ["--root", root, "--verify"]);
  run(root, "install/local/wikidot-verification/scripts/build-wws-route-registration-denominator.mjs", ["--root", root, "--verify"]);
  const summary = verifyTrackedContractConsistency({
    inventory: await readJson(root, INVENTORY),
    semantics: await readJson(root, SEMANTICS),
    deepwellManifest: await readJson(root, DEEPWELL),
    wwsDenominator: await readJson(root, WWS),
  });
  process.stdout.write(`verified repository generated-contract consistency: ${JSON.stringify(summary)}\n`);
  if (options.full) await verifyFullInventory(root);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
