import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {reconcileMutationRuns} from "../../../../scripts/test-quality-mutation-reconciliation.mjs";

const mutant = (name, summary) => ({scenario: {Mutant: {name}}, summary});
const run = (...outcomes) => ({outcomes: [
  {scenario: "Baseline", summary: "Success"}, ...outcomes,
]});

test("frozen shard denominator survives targeted replay without double-counting", () => {
  const report = reconcileMutationRuns({
    baselineRuns: [run(mutant("a", "CaughtMutant"), mutant("b", "MissedMutant")),
      run(mutant("c", "UnviableMutant"), mutant("d", "Timeout"))],
    replays: [run(mutant("b", "CaughtMutant")), run(mutant("d", "MissedMutant"))],
  });
  assert.equal(report.frozen_mutants, 4);
  assert.deepEqual(report.baseline, {caught: 1, missed: 1, unviable: 1, timeout: 1});
  assert.deepEqual(report.reconciled, {caught: 2, missed: 1, unviable: 1, timeout: 0});
  assert.deepEqual(report.unresolved_survivors, ["d"]);
  assert.equal(report.transitions.length, 2);
});

test("reconciler rejects duplicate initial shard assignments", () => {
  assert.throws(() => reconcileMutationRuns({
    baselineRuns: [run(mutant("same", "MissedMutant")), run(mutant("same", "CaughtMutant"))],
  }), /duplicate frozen mutation/u);
});

test("reconciler rejects unexpected targeted mutants", () => {
  assert.throws(() => reconcileMutationRuns({
    baselineRuns: [run(mutant("one", "MissedMutant"))],
    replays: [run(mutant("different", "CaughtMutant"))],
  }), /unreviewed mutation/u);
});

test("reconciler rejects silent regressions of already-caught mutations", () => {
  assert.throws(() => reconcileMutationRuns({
    baselineRuns: [run(mutant("one", "CaughtMutant"))],
    replays: [run(mutant("one", "MissedMutant"))],
  }), /regresses a caught mutation/u);
});

test("reconciler rejects missing and malformed records", () => {
  assert.throws(() => reconcileMutationRuns({baselineRuns: []}), /at least one/u);
  assert.throws(() => reconcileMutationRuns({baselineRuns: [{}]}), /no outcomes array/u);
  assert.throws(() => reconcileMutationRuns({baselineRuns: [run()]}), /no mutation outcomes/u);
  assert.throws(() => reconcileMutationRuns({baselineRuns: [run(mutant("x", "unknown"))]}), /invalid mutation/u);
});

test("reconciliation CLI seals outcome identities and refuses to overwrite a report", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "wj-mutation-reconcile-"));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const initial = join(directory, "initial");
  const replay = join(directory, "replay");
  mkdirSync(initial);
  mkdirSync(replay);
  writeFileSync(join(initial, "outcomes.json"), JSON.stringify(run(mutant("one", "MissedMutant"))));
  writeFileSync(join(replay, "outcomes.json"), JSON.stringify(run(mutant("one", "CaughtMutant"))));
  const output = join(directory, "reconciled.json");
  const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/reconcile-test-quality-mutants.mjs");
  const argv = [script, "--initial", initial, "--replay", replay, "--output", output];
  const first = spawnSync(process.execPath, argv, {encoding: "utf8"});
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(report.reconciled.caught, 1);
  assert.equal(report.source_files.length, 2);
  assert.match(report.source_files[0].sha256, /^[0-9a-f]{64}$/u);
  const second = spawnSync(process.execPath, argv, {encoding: "utf8"});
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /refusing to overwrite/u);

  const verify = () => spawnSync(process.execPath, [script, "--verify-report", output], {encoding: "utf8"});
  const valid = verify();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Verified 1 unique mutants/u);

  const brokenReport = structuredClone(report);
  brokenReport.reconciled.caught = 0;
  writeFileSync(output, JSON.stringify(brokenReport));
  const alteredReport = verify();
  assert.notEqual(alteredReport.status, 0);
  assert.match(alteredReport.stderr, /report differs/u);

  writeFileSync(output, JSON.stringify(report));
  writeFileSync(join(replay, "outcomes.json"), JSON.stringify(run(mutant("one", "MissedMutant"))));
  const alteredInput = verify();
  assert.notEqual(alteredInput.status, 0);
  assert.match(alteredInput.stderr, /input hash changed/u);
});
