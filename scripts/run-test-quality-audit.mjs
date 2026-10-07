#!/usr/bin/env node

import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {dirname, extname, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {
  runValidationCommand,
  withDeepwellIntegrationStack,
} from "../install/local/wikidot-verification/src/deepwell-integration-stack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const ledgerPath = resolve(root, "docs/development/test-quality-audit.json");
const commandName = process.argv[2];
process.chdir(root);

function fail(message) {
  throw new Error(message);
}

function parseOptions(argv) {
  const options = {outputDir: null, owner: null, shard: null, mutationRun: null};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output-dir") options.outputDir = argv[++index] ?? null;
    else if (argument === "--owner") options.owner = argv[++index] ?? null;
    else if (argument === "--shard") options.shard = argv[++index] ?? null;
    else if (argument === "--mutation-run") options.mutationRun = argv[++index] ?? null;
    else fail(`unknown argument: ${argument}`);
  }
  if (!options.outputDir) fail("--output-dir <directory> is required");
  if (options.shard && !/^[1-9][0-9]*\/[1-9][0-9]*$/u.test(options.shard)) {
    fail("--shard must look like I/N, for example 1/4");
  }
  options.outputDir = resolve(root, options.outputDir);
  return options;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function repositoryPath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function walk(directory, predicate) {
  if (!existsSync(directory)) return [];
  const output = [];
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(path, predicate));
    else if (entry.isFile() && predicate(path)) output.push(path);
  }
  return output.sort();
}

function sourceLike(path) {
  return new Set([".rs", ".js", ".mjs", ".ts", ".svelte", ".py", ".sh"]).has(extname(path));
}

function dedicatedTestModule(path) {
  const normalized = repositoryPath(path);
  return /(?:^|\/)tests(?:\/|\.rs$)|\.(?:test|spec)\.[^.]+$/u.test(normalized);
}

function containsInlineRustTests(path) {
  return extname(path) === ".rs" && readFileSync(path, "utf8").includes("#[cfg(test)]");
}

function productionFiles() {
  return [
    ...walk(resolve(root, "deepwell/src"), (path) => sourceLike(path) && !dedicatedTestModule(path)),
    ...walk(resolve(root, "framerail/src"), sourceLike),
    ...walk(resolve(root, "install/local/wikidot-verification/src"), sourceLike),
    ...walk(resolve(root, "install/local/wikidot-verification/scripts"), sourceLike),
  ];
}

function testFiles() {
  const files = [
    ...walk(resolve(root, "deepwell/tests"), sourceLike),
    ...walk(resolve(root, "deepwell/src"), (path) => sourceLike(path) && (dedicatedTestModule(path) || containsInlineRustTests(path))),
    ...walk(resolve(root, "framerail/tests"), sourceLike),
    ...walk(resolve(root, "install/local/wikidot-verification/tests"), sourceLike),
  ];
  return [...new Set(files)].sort();
}

function relativeImports(path) {
  const text = readFileSync(path, "utf8");
  const results = new Set();
  const pattern = /(?:from\s*|import\s*\()\s*["'](\.{1,2}\/[^"']+)["']/gu;
  for (const match of text.matchAll(pattern)) {
    const base = resolve(dirname(path), match[1]);
    for (const candidate of [base, ...[".mjs", ".js", ".ts", ".svelte"].map((suffix) => `${base}${suffix}`)]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        results.add(repositoryPath(candidate));
        break;
      }
    }
  }
  return [...results].sort();
}

function nodeOwnerRecord(path) {
  const text = readFileSync(path, "utf8");
  return {
    path: repositoryPath(path),
    sha256: sha256File(path),
    imported_modules: relativeImports(path),
    browser_owner: /\b(?:playwright|chromium|firefox|webkit|page\.goto)\b/u.test(text),
    wrapper_suite: /(?:spawn|execFile|execFileSync|runValidationCommand)[\s\S]{0,400}\b(?:test|playwright|cargo)\b/u.test(text),
  };
}

async function cargoTargets() {
  const manifests = [
    "deepwell/Cargo.toml",
    "deepwell/relation-impl-derive/Cargo.toml",
  ];
  const targets = [];
  for (const manifest of manifests) {
    const {stdout} = await runValidationCommand("cargo", [
      "metadata", "--format-version", "1", "--no-deps", "--offline", "--locked",
      "--manifest-path", manifest,
    ], {capture: true, cwd: root});
    const metadata = JSON.parse(stdout);
    for (const pkg of metadata.packages) {
      for (const target of pkg.targets) {
        targets.push({
          package: pkg.name,
          name: target.name,
          kind: target.kind,
          crate_types: target.crate_types,
          src_path: repositoryPath(target.src_path),
        });
      }
    }
  }
  return [...new Map(targets.map((target) => [`${target.package}:${target.name}:${target.kind.join(",")}`, target])).values()];
}

async function toolVersion(command, args = ["--version"]) {
  try {
    const {stdout, stderr} = await runValidationCommand(command, args, {capture: true, cwd: root});
    return (stdout || stderr).trim().split("\n")[0];
  } catch (error) {
    return `unavailable: ${error.message}`;
  }
}

async function toolVersions() {
  return {
    node: process.version,
    cargo: await toolVersion("cargo"),
    rustc: await toolVersion("rustc"),
    cargo_llvm_cov: await toolVersion("cargo", ["llvm-cov", "--version"]),
    cargo_mutants: await toolVersion("cargo", ["mutants", "--version"]),
    pnpm: await toolVersion("pnpm"),
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadLedger() {
  return JSON.parse(readFileSync(ledgerPath, "utf8"));
}

async function inventory(outputDir) {
  const production = productionFiles().map((path) => ({path: repositoryPath(path), sha256: sha256File(path)}));
  const tests = testFiles().map(nodeOwnerRecord);
  const targets = await cargoTargets();
  const report = {
    schema: 1,
    generated_at: new Date().toISOString(),
    tool_versions: await toolVersions(),
    production,
    executable_owners: tests,
    cargo_targets: targets,
    deepwell_binaries: targets.filter((target) => target.kind.includes("bin")),
    proc_macros: targets.filter((target) => target.kind.includes("proc-macro")),
  };
  writeJson(resolve(outputDir, "inventory.json"), report);
  process.stdout.write(`Inventoried ${production.length} production files and ${tests.length} executable test owners.\n`);
}

async function runCoverageCommand(command, args, {env, capture = false} = {}) {
  return runValidationCommand(command, args, {env, capture, cwd: root});
}

async function coverage(outputDir) {
  mkdirSync(outputDir, {recursive: true});
  const report = {
    schema: 1,
    generated_at: new Date().toISOString(),
    tool_versions: await toolVersions(),
    rust_branch_instrumentation: "unsupported on the repository stable toolchain; line/function/region coverage plus mutation is retained instead",
    commands: [],
    instrumentation_limitations: [],
  };

  const record = async (name, command, args, options = {}) => {
    report.commands.push({name, command: [command, ...args]});
    return runCoverageCommand(command, args, options);
  };

  await record("deepwell-unit", "cargo", [
    "llvm-cov", "--lib", "--json", "--output-path", resolve(outputDir, "deepwell-unit.json"),
    "--offline", "--locked", "--manifest-path", "deepwell/Cargo.toml",
  ]);

  await withDeepwellIntegrationStack(async ({env, cargo}) => {
    await record("deepwell-integration", cargo, [
      "llvm-cov", "--tests", "--json", "--output-path", resolve(outputDir, "deepwell-integration.json"),
      "--offline", "--locked", "--manifest-path", "deepwell/Cargo.toml", "--", "--test-threads", "1",
    ], {env});
    await record("deepwell-combined", cargo, [
      "llvm-cov", "--lib", "--tests", "--json", "--output-path", resolve(outputDir, "deepwell-combined.json"),
      "--offline", "--locked", "--manifest-path", "deepwell/Cargo.toml", "--", "--test-threads", "1",
    ], {env});
  });

  await record("relation-proc-macro", "cargo", [
    "llvm-cov", "--json", "--output-path", resolve(outputDir, "relation-proc-macro.json"),
    "--offline", "--locked", "--manifest-path", "deepwell/relation-impl-derive/Cargo.toml",
  ]);

  const framerailCoverage = resolve(outputDir, "framerail-v8");
  mkdirSync(framerailCoverage, {recursive: true});
  await record("framerail-v8", "scripts/run-framerail-unit-tests.sh", [], {
    env: {...process.env, NODE_V8_COVERAGE: framerailCoverage},
  });

  const verifierCoverage = resolve(outputDir, "wikidot-verification-v8");
  mkdirSync(verifierCoverage, {recursive: true});
  try {
    await record("wikidot-verification-v8", "pnpm", ["--dir", "install/local/wikidot-verification", "run", "test:ci"], {
      env: {...process.env, NODE_V8_COVERAGE: verifierCoverage},
      capture: true,
    });
  } catch (error) {
    report.instrumentation_limitations.push({
      owner: "wikidot-verification subprocess suites",
      limitation: "NODE_V8_COVERAGE changes frozen subprocess environments; preserve the uninstrumented behavior and audit those owners independently",
      observed_error: String(error.message).slice(0, 1000),
    });
    await record("wikidot-verification-uninstrumented-control", "pnpm", ["--dir", "install/local/wikidot-verification", "run", "test:ci"]);
  }

  writeJson(resolve(outputDir, "coverage-summary.json"), report);
}

async function listedMutationCount(owner) {
  const {stdout} = await runValidationCommand("cargo", [
    "mutants", "--list", "--manifest-path", "deepwell/Cargo.toml",
    "-f", owner.mutation.file, "-F", owner.mutation.function,
  ], {capture: true, cwd: root});
  return stdout.split("\n").filter((line) => line.trim() !== "").length;
}

async function mutate(outputDir, ownerId, shard, mutationRun) {
  if (!ownerId) fail("mutate requires --owner <id>");
  const owner = loadLedger().owners.find((row) => row.id === ownerId);
  if (!owner) fail(`unknown audit owner: ${ownerId}`);
  if (!owner.mutation) fail(`owner ${ownerId} has no mutation descriptor`);
  const sourcePath = resolve(root, owner.source.path);
  const originalHash = sha256File(sourcePath);
  if (originalHash !== owner.source.sha256) fail(`owner source hash is stale before mutation: ${owner.source.path}`);
  const count = await listedMutationCount(owner);
  if (count !== owner.mutation.inventory_count) {
    fail(`mutation inventory mismatch for ${ownerId}: expected ${owner.mutation.inventory_count}, got ${count}`);
  }

  mkdirSync(outputDir, {recursive: true});
  const runs = mutationRun
    ? owner.mutation.runs.filter((run) => run.id === mutationRun)
    : owner.mutation.runs;
  if (mutationRun && runs.length === 0) fail(`unknown mutation run ${mutationRun} for ${ownerId}`);
  const outcomes = [];
  try {
    for (const run of runs) {
      const runOutput = resolve(outputDir, run.id);
      await withDeepwellIntegrationStack(async ({env}) => {
        await runValidationCommand("cargo", [
          "mutants", "--in-place", "--manifest-path", "deepwell/Cargo.toml",
          "-f", owner.mutation.file, "-F", owner.mutation.function,
          "--baseline", "run", "--output", runOutput,
          ...(shard ? ["--shard", shard] : []),
          ...run.cargo_mutants_args,
        ], {env, cwd: root});
      });
      outcomes.push({id: run.id, output: repositoryPath(runOutput), status: "completed"});
    }
  } finally {
    const restoredHash = sha256File(sourcePath);
    if (restoredHash !== originalHash) {
      fail(`mutation runner did not restore ${owner.source.path}; expected ${originalHash}, got ${restoredHash}`);
    }
  }
  writeJson(resolve(outputDir, "mutation-summary.json"), {
    schema: 1,
    owner: ownerId,
    inventory_count: count,
    shard,
    mutation_run: mutationRun,
    outcomes,
  });
}

function verifyIdentity(identity, label) {
  const path = resolve(root, identity.path);
  if (!existsSync(path)) fail(`${label} is missing: ${identity.path}`);
  const actual = sha256File(path);
  if (actual !== identity.sha256) fail(`${label} hash is stale: ${identity.path}`);
}

async function verify(outputDir, ownerId) {
  const ledger = loadLedger();
  for (const lockfile of ledger.lockfiles) verifyIdentity(lockfile, "lockfile");
  const owners = ownerId ? ledger.owners.filter((owner) => owner.id === ownerId) : ledger.owners;
  if (ownerId && owners.length === 0) fail(`unknown audit owner: ${ownerId}`);
  if (owners.length === 0) fail("audit ledger has no owners");

  for (const owner of owners) {
    verifyIdentity(owner.source, `source for ${owner.id}`);
    if (!Array.isArray(owner.tests) || owner.tests.length === 0) fail(`owner ${owner.id} has no tests`);
    for (const test of owner.tests) {
      verifyIdentity(test, `test for ${owner.id}`);
      const text = readFileSync(resolve(root, test.path), "utf8");
      for (const anchor of test.anchors ?? []) {
        if (!text.includes(anchor)) fail(`owner ${owner.id} has invalid test anchor ${JSON.stringify(anchor)} in ${test.path}`);
      }
    }
    if (owner.status === "accepted" && owner.acceptance_gaps?.length) {
      fail(`accepted owner ${owner.id} still has unresolved acceptance gaps`);
    }
    if (owner.mutation) {
      const count = await listedMutationCount(owner);
      if (count !== owner.mutation.inventory_count) {
        fail(`mutation inventory mismatch for ${owner.id}: expected ${owner.mutation.inventory_count}, got ${count}`);
      }
    }
  }

  mkdirSync(outputDir, {recursive: true});
  const result = {
    schema: 1,
    verified_at: new Date().toISOString(),
    tool_versions: await toolVersions(),
    owners: owners.map(({id}) => id),
  };
  writeJson(resolve(outputDir, "verification.json"), result);
  process.stdout.write(`Verified ${owners.length} audit owner(s).\n`);
}

async function main() {
  if (!["inventory", "coverage", "mutate", "verify"].includes(commandName)) {
    process.stderr.write("Usage: node scripts/run-test-quality-audit.mjs inventory|coverage|mutate|verify --output-dir <directory> [--owner <id>] [--shard I/N] [--mutation-run <id>]\n");
    process.exitCode = 2;
    return;
  }
  const {outputDir, owner, shard, mutationRun} = parseOptions(process.argv.slice(3));
  if (commandName === "inventory") await inventory(outputDir);
  else if (commandName === "coverage") await coverage(outputDir);
  else if (commandName === "mutate") await mutate(outputDir, owner, shard, mutationRun);
  else await verify(outputDir, owner);
}

main().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
});
