#!/usr/bin/env node

import {execFile as execFileCallback, spawn} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {sealJsonNoReplace} from "../src/standing-browser-parity-util.mjs";

const execFile = promisify(execFileCallback);
const SOURCE_FILES = Object.freeze([
  "scripts/preflight.sh",
  "scripts/run-test-no-external-network.sh",
  "install/local/wikidot-verification/scripts/run-deepwell-integration-validation.mjs",
]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--repository", "--base", "--output"].includes(flag) || !value || value.startsWith("--")) {
      fail(`invalid option: ${flag ?? "<missing>"}`);
    }
    const key = flag.slice(2);
    if (Object.hasOwn(args, key)) fail(`duplicate option: ${flag}`);
    args[key] = value;
  }
  for (const key of ["repository", "base", "output"]) if (!args[key]) fail(`--${key} is required`);
  return {
    repository: path.resolve(args.repository),
    base: args.base,
    output: path.resolve(args.output),
  };
}

async function git(repository, ...args) {
  const {stdout} = await execFile("git", ["-C", repository, ...args], {encoding: "utf8"});
  return stdout.trim();
}

async function sha256File(file) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function runPreflight(repository, base) {
  await new Promise((resolve, reject) => {
    const child = spawn("bash", ["scripts/preflight.sh", "--base", base, "--final"], {
      cwd: repository,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`final preflight failed with ${signal ? `signal ${signal}` : `status ${code}`}`));
    });
  });
}

export async function runConsolidatedValidation({repository, base, output}) {
  const status = await git(repository, "status", "--porcelain=v1", "--untracked-files=all");
  if (status !== "") fail("consolidated validation requires a clean checkout");
  const commit = await git(repository, "rev-parse", "HEAD^{commit}");
  const tree = await git(repository, "rev-parse", "HEAD^{tree}");
  const baseCommit = await git(repository, "rev-parse", `${base}^{commit}`);
  await runPreflight(repository, baseCommit);
  const source_sha256 = {};
  for (const relative of SOURCE_FILES) {
    source_sha256[relative] = await sha256File(path.join(repository, relative));
  }
  const receipt = {
    schema: "wikijump.consolidated_validation_receipt.v1",
    status: "pass",
    completed_at: new Date().toISOString(),
    wikijump_commit: commit,
    wikijump_tree: tree,
    base_commit: baseCommit,
    preflight: {
      mode: "final",
      source_sha256,
    },
  };
  const sealed = await sealJsonNoReplace(output, receipt);
  return {receipt, sealed};
}

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  const {receipt, sealed} = await runConsolidatedValidation(args);
  stdout(JSON.stringify({schema: receipt.schema, status: receipt.status, output: sealed.path, sha256: sealed.sha256}));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    return 1;
  },
});
