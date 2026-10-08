import fs from "node:fs/promises";
import path from "node:path";
import {jsonHash, repositoryPath, sha256} from "./test-quality-inventory.mjs";
import {runAuditCommand} from "./audit-command.mjs";
import {withTaskOwnedDeepwellStack} from "./deepwell-test-stack.mjs";

export async function rustMutationInventory(root, owner, signal) {
  const result = await runAuditCommand("cargo", [
    "mutants", "--list", "--json", "--manifest-path", owner.manifest,
    ...owner.files.flatMap((file) => ["-f", path.posix.relative(path.posix.dirname(owner.manifest), file)]),
    "-F", owner.function,
  ], {cwd: root, capture: true, signal});
  return JSON.parse(result.stdout).map(({diff, ...mutant}) => ({id: sha256(diff), ...mutant}));
}

export function applyNodeMutation(source, descriptor) {
  const {start, end, original, replacement} = descriptor;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start ||
      source.slice(start, end) !== original || typeof replacement !== "string" || original === replacement) {
    throw new Error(`stale/invalid Node mutation span: ${descriptor.id}`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
}

async function restoreNodeSource(file, backup, changed) {
  if (await fs.readFile(file, "utf8") !== changed) throw new Error(`mutation source changed externally; original retained at ${backup}`);
  await fs.rename(backup, file);
}

export async function runNodeMutations(root, owner, output, signal) {
  if (owner.files.length !== 1 || !Array.isArray(owner.mutations) || !owner.mutations.length) {
    throw new Error("Node mutation owner requires one file and a reviewed mutation inventory");
  }
  const file = repositoryPath(root, owner.files[0]);
  const original = await fs.readFile(file, "utf8");
  if (sha256(original) !== owner.source_sha256) throw new Error("stale Node mutation owner source");
  const ids = new Set();
  for (const descriptor of owner.mutations) {
    if (!/^[a-z0-9-]+$/u.test(descriptor.id) || ids.has(descriptor.id)) throw new Error("invalid/duplicate Node mutation id");
    ids.add(descriptor.id);
    applyNodeMutation(original, descriptor);
  }
  await fs.mkdir(output, {mode: 0o700});
  const [command, ...args] = owner.command;
  const baseline = await runAuditCommand(command, args, {cwd: root, signal, processGroup: true, logPath: path.join(output, "baseline.log")});
  const baselineArtifact = {path: path.join(output, "baseline.log"), sha256: sha256(await fs.readFile(path.join(output, "baseline.log")))};
  baseline.log_sha256 = baselineArtifact.sha256;
  const receipt = {
    owner: owner.id, source_sha256: sha256(original), inventory: owner.mutations,
    inventory_sha256: jsonHash(owner.mutations), tool: `node ${process.version}`,
    owner_sha256: jsonHash(owner), command: owner.command, baselines: [baseline], outcomes: [], artifacts: [baselineArtifact],
  };
  const timeout = Math.max(1000, baseline.elapsed_ms * 5);
  for (const descriptor of owner.mutations) {
    signal?.throwIfAborted();
    const changed = applyNodeMutation(original, descriptor);
    // Source checks before each write prevent overwriting another editor.
    if (await fs.readFile(file, "utf8") !== original) throw new Error("source changed outside mutation runner");
    const backup = `${file}.audit-original-${process.pid}`;
    const temporary = `${file}.audit-mutant-${process.pid}`;
    const {mode} = await fs.stat(file);
    let applied = false;
    try {
      // Reserve restoration bytes before modifying source. Rename restores the
      // original even when the mutant process exhausts available disk space.
      await fs.writeFile(backup, original, {flag: "wx", mode});
      await fs.chmod(backup, mode);
      await fs.writeFile(temporary, changed, {flag: "wx", mode});
      await fs.rename(temporary, file);
      applied = true;
      const syntaxLog = path.join(output, `${descriptor.id}-syntax.log`);
      const syntax = await runAuditCommand(process.execPath, ["--check", file], {cwd: root, signal, processGroup: true, allowFailure: true, timeoutMs: timeout, logPath: syntaxLog});
      receipt.artifacts.push({path: syntaxLog, sha256: sha256(await fs.readFile(syntaxLog))});
      if (syntax.code !== 0) {
        receipt.outcomes.push({id: descriptor.id, outcome: "unviable", target: owner.command, log_sha256: receipt.artifacts.at(-1).sha256, syntax});
        continue;
      }
      const result = await runAuditCommand(command, args, {
        cwd: root, signal, processGroup: true, allowFailure: true, timeoutMs: timeout,
        logPath: path.join(output, `${descriptor.id}.log`),
      });
      const logFile = path.join(output, `${descriptor.id}.log`);
      const log = await fs.readFile(logFile);
      receipt.artifacts.push({path: logFile, sha256: sha256(log)});
      const assertionFailure = /ERR_ASSERTION|AssertionError|Error: expect\(/u.test(log.toString("utf8"));
      receipt.outcomes.push({id: descriptor.id,
        outcome: result.timedOut ? "timeout" : result.code === 0 ? "missed" : assertionFailure ? "caught" : "error",
        target: owner.command, log_sha256: sha256(log), timeout_ms: timeout, ...result});
    } finally {
      await fs.rm(temporary, {force: true});
      if (applied) {
        await restoreNodeSource(file, backup, changed);
      } else await fs.rm(backup, {force: true});
      receipt.source_restored = sha256(await fs.readFile(file)) === sha256(original);
      await writeJson(path.join(output, "receipt.json"), receipt);
    }
  }
  return receipt;
}

export async function normalizeRustRun(outcomes, inventory, directory, target) {
  const baseline = outcomes.outcomes.find((entry) => entry.scenario === "Baseline");
  if (baseline?.summary !== "Success") throw new Error("mutation target has no successful unmutated baseline");
  const baselineTest = baseline.phase_results.find((entry) => entry.phase === "Test");
  if (!baselineTest || baselineTest.process_status !== "Success") throw new Error("unmutated baseline did not execute tests");
  const byName = new Map(inventory.map((mutant) => [mutant.name, mutant]));
  const normalized = [];
  const summaries = {CaughtMutant: "caught", MissedMutant: "missed", Unviable: "unviable", Timeout: "timeout"};
  for (const entry of outcomes.outcomes) {
    if (entry.scenario === "Baseline") continue;
    const mutant = byName.get(entry.scenario?.Mutant?.name);
    if (!mutant || !summaries[entry.summary]) throw new Error("mutation outcome disagrees with frozen inventory");
    const diff = await fs.readFile(path.join(directory, entry.diff_path));
    if (sha256(diff) !== mutant.id) throw new Error("executed mutation diff disagrees with frozen bytes");
    normalized.push({id: mutant.id, outcome: summaries[entry.summary], target,
      log_sha256: sha256(await fs.readFile(path.join(directory, entry.log_path))),
      phases: entry.phase_results});
  }
  return {baseline: {code: 0, elapsed_ms: baselineTest.duration * 1000,
    command: baselineTest.argv, log_sha256: sha256(await fs.readFile(path.join(directory, baseline.log_path)))}, outcomes: normalized};
}

export async function runRustMutations(root, owner, output, signal) {
  const inventory = await rustMutationInventory(root, owner, signal);
  if (!inventory.length || jsonHash(inventory) !== owner.mutation_inventory_sha256) throw new Error(`stale/empty mutation inventory: ${owner.id}`);
  const originals = new Map(await Promise.all(owner.files.map(async (file) => [file, await fs.readFile(repositoryPath(root, file))])));
  const sourceHash = jsonHash([...originals].map(([file, bytes]) => [file, sha256(bytes)]));
  await fs.mkdir(output, {mode: 0o700});
  await writeJson(path.join(output, "inventory.json"), inventory);
  const version = await runAuditCommand("cargo", ["mutants", "--version"], {cwd: root, capture: true, signal});
  const receipt = {owner: owner.id, owner_sha256: jsonHash(owner), source_sha256: sourceHash,
    inventory, inventory_sha256: jsonHash(inventory), tool: version.stdout.trim(),
    command: ["cargo", "mutants"], baselines: [], outcomes: [], runs: [], artifacts: []};
  const assertRestored = async () => {
    for (const [file, bytes] of originals) {
      if (sha256(await fs.readFile(repositoryPath(root, file))) !== sha256(bytes)) throw new Error(`mutation runner did not restore source: ${file}`);
    }
  };
  const runTarget = async (target, index, env, mutant) => {
    const directory = path.join(output, `target-${index}${mutant ? `-${mutant.id}` : ""}`);
    await fs.mkdir(directory, {mode: 0o700});
    const regex = mutant ? `^${mutant.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$` : owner.function;
    const args = ["mutants", "--in-place", "--manifest-path", owner.manifest,
      ...owner.files.flatMap((file) => ["-f", path.posix.relative(path.posix.dirname(owner.manifest), file)]),
      "-F", regex, "--baseline", "run", "--output", directory,
      ...["--offline", "--locked", ...target.cargo_args].flatMap((arg) => ["-C", arg]),
      "--", "--", "--test-threads=1"];
    try {
      const result = await runAuditCommand("cargo", args, {cwd: root, env, signal, allowFailure: true, logPath: path.join(directory, "runner.log")});
      const raw = JSON.parse(await fs.readFile(path.join(directory, "mutants.out", "outcomes.json"), "utf8"));
      const normalized = await normalizeRustRun(raw, mutant ? [mutant] : inventory, path.join(directory, "mutants.out"), target);
      for (const entry of raw.outcomes) for (const relative of [entry.log_path, entry.diff_path].filter(Boolean)) {
        const artifactPath = path.join(directory, "mutants.out", relative);
        receipt.artifacts.push({path: artifactPath, sha256: sha256(await fs.readFile(artifactPath))});
      }
      receipt.artifacts.push({path: path.join(directory, "mutants.out", "outcomes.json"), sha256: sha256(await fs.readFile(path.join(directory, "mutants.out", "outcomes.json")))});
      const expectedCount = mutant ? 1 : inventory.length;
      if (normalized.outcomes.length !== expectedCount) throw new Error("mutation batch did not execute its entire inventory");
      receipt.baselines.push(normalized.baseline);
      receipt.runs.push({target, command: ["cargo", ...args], ...result, ...normalized});
      for (const outcome of normalized.outcomes) {
        const existing = receipt.outcomes.find((entry) => entry.id === outcome.id);
        if (!existing) receipt.outcomes.push(outcome);
        else if (outcome.outcome === "caught") Object.assign(existing, outcome);
      }
      await writeJson(path.join(output, "receipt.json"), receipt);
    } finally {
      // This check runs inside the stack callback: restoration precedes removal.
      await assertRestored();
      receipt.source_restored = true;
      await writeJson(path.join(output, "receipt.json"), receipt);
    }
  };
  for (let index = 0; index < owner.targets.length; index += 1) {
    const target = owner.targets[index];
    if (!owner.stack) await runTarget(target, index, process.env);
    else if (owner.state_isolation === "disposable-per-variant") {
      for (const mutant of inventory) await withTaskOwnedDeepwellStack(({env}) => runTarget(target, index, env, mutant), {signal});
    } else throw new Error("integration mutation owner requires disposable state per variant; DB rollback does not reset Valkey/S3");
  }
  await assertRestored();
  return receipt;
}
