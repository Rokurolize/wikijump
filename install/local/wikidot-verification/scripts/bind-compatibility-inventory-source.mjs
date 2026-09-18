#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { publishBytesNoReplace } from "../src/atomic-no-replace.mjs";

const SCHEMA = "wikijump.compatibility_inventory_source_binding.v1";
const INVENTORY_SCHEMA = "wikijump.compatibility_surface_inventory.v3";
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../../..");
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

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function usage() {
  return "usage: bind-compatibility-inventory-source.mjs [--root REPOSITORY] --inventory PATH --revision COMMIT --output PATH\n";
}

function parseArgs(argv) {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!["--root", "--inventory", "--revision", "--output"].includes(flag) || !value || value.startsWith("--")) {
      throw new Error(usage().trim());
    }
    if (Object.hasOwn(args, flag)) throw new Error(usage().trim());
    args[flag] = value;
  }
  if (!args["--inventory"] || !args["--revision"] || !args["--output"]) throw new Error(usage().trim());
  return {
    root: path.resolve(args["--root"] ?? REPOSITORY_ROOT),
    inventory: path.resolve(args["--inventory"]),
    revision: args["--revision"],
    output: path.resolve(args["--output"]),
  };
}

function gitObject(root, revision) {
  try {
    return execFileSync(
      GIT,
      ["--no-replace-objects", "-C", root, "rev-parse", "--verify", revision],
      { encoding: "utf8", env: GIT_ENV, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    throw new Error(`cannot resolve Git object: ${revision}`);
  }
}

function readSpecs(root, specs) {
  const unique = [...new Set(specs)];
  const child = spawnSync(
    GIT,
    ["--no-replace-objects", "-C", root, "cat-file", "--batch"],
    {
      input: `${unique.join("\n")}\n`,
      env: GIT_ENV,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (child.status !== 0 || child.error) {
    throw new Error(`cannot read source binding inputs: ${child.error?.message ?? child.stderr.toString("utf8").trim()}`);
  }
  const result = new Map();
  let offset = 0;
  for (const spec of unique) {
    const newline = child.stdout.indexOf(0x0a, offset);
    if (newline < 0) throw new Error(`source binding batch ended before ${spec}`);
    const header = child.stdout.subarray(offset, newline).toString("utf8");
    if (header === `${spec} missing`) throw new Error(`source binding input is missing: ${spec}`);
    const match = /^([0-9a-f]{40}) blob (\d+)$/u.exec(header);
    if (!match) throw new Error(`source binding input is not a blob: ${spec}`);
    const size = Number(match[2]);
    const start = newline + 1;
    const end = start + size;
    if (!Number.isSafeInteger(size) || end >= child.stdout.length || child.stdout[end] !== 0x0a) {
      throw new Error(`source binding input is truncated: ${spec}`);
    }
    result.set(spec, Buffer.from(child.stdout.subarray(start, end)));
    offset = end + 1;
  }
  if (offset !== child.stdout.length) throw new Error("source binding batch has trailing bytes");
  return result;
}

function sourceInputSetSha256(registries) {
  return sha256(
    JSON.stringify(registries.map(({ path: registryPath, sha256: digest }) => [registryPath, digest])),
  );
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const inventoryBytes = await fs.readFile(args.inventory);
  const inventory = JSON.parse(inventoryBytes);
  if (
    inventory.schema !== INVENTORY_SCHEMA ||
    !Array.isArray(inventory.provenance?.registries) ||
    !/^[0-9a-f]{64}$/u.test(inventory.provenance?.wikijump?.source_input_set_sha256 ?? "")
  ) {
    throw new Error("inventory is not a source-bindable v3 compatibility inventory");
  }
  const registries = inventory.provenance.registries;
  if (
    registries.some(({ path: registryPath, sha256: digest }) =>
      typeof registryPath !== "string" ||
      registryPath === "" ||
      path.isAbsolute(registryPath) ||
      registryPath.split("/").includes("..") ||
      !/^[0-9a-f]{64}$/u.test(digest ?? "")
    ) ||
    new Set(registries.map(({ path: registryPath }) => registryPath)).size !== registries.length
  ) {
    throw new Error("inventory registry provenance is invalid");
  }
  if (sourceInputSetSha256(registries) !== inventory.provenance.wikijump.source_input_set_sha256) {
    throw new Error("inventory source input set digest is stale");
  }
  if (!/^[0-9a-f]{40}$/u.test(args.revision)) throw new Error("revision must be an exact 40-character commit");
  const commit = gitObject(args.root, `${args.revision}^{commit}`);
  if (commit !== args.revision) throw new Error("revision does not resolve to itself");
  const tree = gitObject(args.root, `${commit}^{tree}`);
  const inventoryRelative = path.relative(args.root, args.inventory).split(path.sep).join("/");
  if (inventoryRelative.startsWith("../") || inventoryRelative === ".." || path.isAbsolute(inventoryRelative)) {
    throw new Error("inventory must be inside the repository");
  }
  const specs = [
    `${commit}:${inventoryRelative}`,
    ...registries.map(({ path: registryPath }) => `${commit}:${registryPath}`),
  ];
  const blobs = readSpecs(args.root, specs);
  if (sha256(blobs.get(`${commit}:${inventoryRelative}`)) !== sha256(inventoryBytes)) {
    throw new Error("selected commit does not contain the selected inventory bytes");
  }
  for (const { path: registryPath, sha256: digest } of registries) {
    if (sha256(blobs.get(`${commit}:${registryPath}`)) !== digest) {
      throw new Error(`selected commit registry digest drift: ${registryPath}`);
    }
  }
  const receipt = {
    schema: SCHEMA,
    status: "pass",
    inventory: {
      path: inventoryRelative,
      sha256: sha256(inventoryBytes),
      source_input_set_sha256: inventory.provenance.wikijump.source_input_set_sha256,
    },
    wikijump: { commit, tree },
  };
  if (await publishBytesNoReplace(args.output, `${JSON.stringify(receipt, null, 2)}\n`) !== "created") {
    throw new Error(`source binding output already exists: ${args.output}`);
  }
  process.stdout.write(`${JSON.stringify({ status: "pass", output: args.output, commit, tree })}\n`);
}

main().catch((error) => {
  process.stderr.write(`compatibility inventory source binding failed: ${error.message}\n`);
  process.exitCode = 1;
});
