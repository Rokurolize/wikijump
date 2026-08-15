import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  candidateCaseSet,
  parseCandidateCaseArgs,
  readPrivateCandidateCaseInput,
} from "../src/candidate-case-command.mjs";
import { createFramerailRouteActionCandidateCaseSet } from "../src/framerail-route-action-candidate-case-set.mjs";
import { validateTemporalRunContract } from "../scripts/capture-framerail-route-action-temporal.mjs";

const hash = (character) => character.repeat(64);
const commit = (character) => character.repeat(40);

test("candidate case registry exposes the real Open43 settings browser adapter", async () => {
  const caseSet = await candidateCaseSet("open43-settings-browser");
  assert.equal(caseSet.id, "open43-settings-browser");
  assert.equal(caseSet.caseIds.length, 9);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("candidate case registry exposes the executable B610 shell case", async () => {
  const caseSet = await candidateCaseSet("open43-b610-shell");
  assert.equal(caseSet.id, "open43-b610-shell");
  assert.deepEqual(caseSet.caseIds, ["B610_SHELL_PUBLIC_CONTRACT"]);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("candidate case registry exposes both exact issue 822 page-tag intervals", async () => {
  const caseSet = await candidateCaseSet("open43-settings-page-tags");
  assert.equal(caseSet.id, "open43-settings-page-tags");
  assert.deepEqual(caseSet.caseIds, ["B822_PAGE_TAGS_INITIAL", "B822_PAGE_TAGS_SETTLED"]);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("candidate case registry exposes the executable issue 775 adapter", async () => {
  const caseSet = await candidateCaseSet("open43-issue775-edit");
  assert.equal(caseSet.id, "open43-issue775-edit");
  assert.deepEqual(caseSet.caseIds, ["A775_ACTOR_NAVIGATION_BROWSER"]);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("candidate case registry exposes the executable issue 777 adapter", async () => {
  const caseSet = await candidateCaseSet("open43-issue777-print");
  assert.equal(caseSet.id, "open43-issue777-print");
  assert.deepEqual(caseSet.caseIds, ["A777_BROWSER_PRINT_LIFECYCLE"]);
});

test("candidate case registry exposes the executable issue 1029 Join adapter", async () => {
  const caseSet = await candidateCaseSet("open43-issue1029-join");
  assert.equal(caseSet.id, "open43-issue1029-join");
  assert.deepEqual(caseSet.caseIds, ["A1029_EXACT_BROWSER_TRANSITIONS"]);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("candidate case registry exposes all issue #1372 temporal intervals from its existing contract", async () => {
  const caseSet = await candidateCaseSet("framerail-route-action-browser");
  assert.equal(caseSet.id, "framerail-route-action-browser");
  assert.equal(caseSet.caseIds.length, 84);
  assert.equal(new Set(caseSet.caseIds).size, 84);
  assert.equal(caseSet.caseIds.includes("DENIAL_DENIAL_CONTROL_CREATE"), true);
  assert.equal(caseSet.caseIds.includes("SUCCESS_SUCCESS_PANE_WATCHERS"), true);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("issue #1372 candidate case set invokes the temporal seam and maps all 84 records", async (t) => {
  const contractPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/framerail-route-action-browser/run-contract.json");
  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/capture-framerail-route-action-temporal.mjs");
  const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
  const scriptSha256 = createHash("sha256").update(await fs.readFile(scriptPath)).digest("hex");
  const candidateCommit = commit("1");
  const candidateTree = commit("2");
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framerail-candidate-case-"));
  t.after(() => fs.rm(outputRoot, {recursive: true, force: true}));
  const urls = Object.fromEntries(["denial", "failure", "success"].map((scenario) => [scenario, {missing_page: "https://scpaiueouiuiuiui.wikijump.localhost:18443/missing", saved_page: "https://scpaiueouiuiuiui.wikijump.localhost:18443/saved"}]));
  let temporalArgs;
  const caseSet = await createFramerailRouteActionCandidateCaseSet({
    temporalRunner: async (args) => {
      temporalArgs = args;
      const evidence = validateTemporalRunContract(contract).scenarios.flatMap((scenario) => validateTemporalRunContract(contract).subjects.flatMap((subject) => scenario.intervals.map((interval) => ({
        actor_class: "permitted",
        capture_errors: [],
        dom_sha256: hash("a"),
        interval,
        scenario: scenario.id,
        screenshot_sha256: hash("b"),
        source_revision: candidateCommit,
        subject_id: subject.id,
      }))));
      const temporalOutput = args.outputDir;
      await fs.mkdir(temporalOutput, {recursive: true});
      await fs.writeFile(path.join(temporalOutput, "records.json"), JSON.stringify({
        status: "captured",
        source_revision: candidateCommit,
        source_tree: candidateTree,
        evidence,
        capture: {
          source_identity: {wikijump_commit: candidateCommit, wikijump_tree: candidateTree},
          runtime_source_identity: {wikijump_commit: candidateCommit, wikijump_tree: candidateTree},
          browser_identity: {executable: {path: "/tmp/browser", sha256: hash("c")}, version: "fixture"},
          fixture_identity: {path: "/tmp/fixture.json", sha256: hash("d")},
          failure_control_identity: {path: "/tmp/failure.json", sha256: hash("e")},
          runtime_identity: {path: "/tmp/runtime.json", sha256: hash("f")},
          run_contract_identity: {path: contractPath, sha256: createHash("sha256").update(await fs.readFile(contractPath)).digest("hex")},
          capture_script_identity: {path: scriptPath, sha256: scriptSha256},
          request_gate_config: path.join(temporalOutput, "request-gate-config.json"),
        },
        cleanup_observed: {browser_sessions_closed: 3, egress_proxies_closed: true, request_gate_flushed: true, capture_lock_released: true, storage_states_removed: true},
      }), {flag: "wx"});
      return 0;
    },
  });
  const run = caseSet.prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity: {candidate: {wikijump_commit: candidateCommit, wikijump_tree: candidateTree, endpoint: {scheme: "https", host: "scpaiueouiuiuiui.wikijump.localhost", port: 18443}}},
    privateInputSha256: hash("0"),
    outputDir: outputRoot,
    privateInput: {temporal_capture: {
      browser_executable: "/tmp/browser",
      browser_identity: {sha256: hash("c"), version: "fixture"},
      fixture_identity: "/tmp/fixture.json",
      fixture_identity_sha256: hash("d"),
      failure_control_identity: "/tmp/failure.json",
      failure_control_identity_sha256: hash("e"),
      runtime_identity: "/tmp/runtime.json",
      runtime_identity_sha256: hash("f"),
      actor_classes: {denial: "denied", failure: "denied", success: "permitted"},
      storage_states: {denial: "/tmp/denial.json", failure: "/tmp/failure-state.json", success: "/tmp/success.json"},
      urls,
      runtime_bindings: [],
    }},
    signal: null,
    resources: {},
  });
  const rows = await run.execute();
  assert.equal(rows.length, 84);
  assert.equal(temporalArgs.outputDir, path.join(outputRoot, "framerail-route-action-temporal"));
  assert.equal(run.verifyCase(rows[0].case_id, rows[0].observations).verified, true);
  assert.equal((await run.cleanup()).public_absence_verified, true);
});

const contractPath1372 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/framerail-route-action-browser/run-contract.json");
const scriptPath1372 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/capture-framerail-route-action-temporal.mjs");

async function issue1372EvidenceRows(candidateCommitValue) {
  const contract = JSON.parse(await fs.readFile(contractPath1372, "utf8"));
  const {scenarios, subjects} = validateTemporalRunContract(contract);
  return scenarios.flatMap((scenario) => subjects.flatMap((subject) => scenario.intervals.map((interval) => ({
    actor_class: "permitted",
    capture_errors: [],
    dom_sha256: hash("a"),
    interval,
    scenario: scenario.id,
    screenshot_sha256: hash("b"),
    source_revision: candidateCommitValue,
    subject_id: subject.id,
  }))));
}

async function issue1372PrepareRun({evidenceBuilder = (rows) => rows, candidateCommitValue = commit("1"), candidateTreeValue = commit("2")} = {}) {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framerail-candidate-seam-"));
  const contractSha256 = createHash("sha256").update(await fs.readFile(contractPath1372)).digest("hex");
  const scriptSha256 = createHash("sha256").update(await fs.readFile(scriptPath1372)).digest("hex");
  const urls = Object.fromEntries(["denial", "failure", "success"].map((scenario) => [scenario, {
    missing_page: `https://scpaiueouiuiuiui.wikijump.localhost:18443/${scenario}-missing`,
    saved_page: `https://scpaiueouiuiuiui.wikijump.localhost:18443/${scenario}-saved`,
  }]));
  const caseSet = await createFramerailRouteActionCandidateCaseSet({
    temporalRunner: async (args) => {
      const temporalOutput = args.outputDir;
      await fs.mkdir(temporalOutput, {recursive: true});
      const evidence = await evidenceBuilder(await issue1372EvidenceRows(candidateCommitValue));
      await fs.writeFile(path.join(temporalOutput, "records.json"), JSON.stringify({
        status: "captured",
        source_revision: candidateCommitValue,
        source_tree: candidateTreeValue,
        evidence,
        capture: {
          source_identity: {wikijump_commit: candidateCommitValue, wikijump_tree: candidateTreeValue},
          runtime_source_identity: {wikijump_commit: candidateCommitValue, wikijump_tree: candidateTreeValue},
          browser_identity: {executable: {path: "/tmp/browser", sha256: hash("c")}, version: "fixture"},
          fixture_identity: {path: "/tmp/fixture.json", sha256: hash("d")},
          failure_control_identity: {path: "/tmp/failure.json", sha256: hash("e")},
          runtime_identity: {path: "/tmp/runtime.json", sha256: hash("f")},
          run_contract_identity: {path: contractPath1372, sha256: contractSha256},
          capture_script_identity: {path: scriptPath1372, sha256: scriptSha256},
          request_gate_config: path.join(temporalOutput, "request-gate-config.json"),
        },
        cleanup_observed: {browser_sessions_closed: 3, egress_proxies_closed: true, request_gate_flushed: true, capture_lock_released: true, storage_states_removed: true},
      }), {flag: "wx"});
      return 0;
    },
  });
  const run = caseSet.prepareRun({
    runId: "candidate-case-1372-fake-boundary",
    candidateIdentity: {candidate: {wikijump_commit: candidateCommitValue, wikijump_tree: candidateTreeValue, endpoint: {scheme: "https", host: "scpaiueouiuiuiui.wikijump.localhost", port: 18443}}},
    privateInputSha256: hash("0"),
    outputDir: outputRoot,
    privateInput: {temporal_capture: {
      browser_executable: "/tmp/browser",
      browser_identity: {sha256: hash("c"), version: "fixture"},
      fixture_identity: "/tmp/fixture.json",
      fixture_identity_sha256: hash("d"),
      failure_control_identity: "/tmp/failure.json",
      failure_control_identity_sha256: hash("e"),
      runtime_identity: "/tmp/runtime.json",
      runtime_identity_sha256: hash("f"),
      actor_classes: {denial: "denied", failure: "denied", success: "permitted"},
      storage_states: {denial: "/tmp/denial.json", failure: "/tmp/failure-state.json", success: "/tmp/success.json"},
      urls,
      runtime_bindings: [],
    }},
    signal: null,
    resources: {},
  });
  return {caseSet, run, outputRoot};
}

test("issue #1372 candidate seam maps and verifies every registered temporal row exactly once", async (t) => {
  const {caseSet, run, outputRoot} = await issue1372PrepareRun();
  t.after(() => fs.rm(outputRoot, {recursive: true, force: true}));
  assert.equal(caseSet.caseIds.length, 84);
  assert.equal(new Set(caseSet.caseIds).size, 84);
  assert.equal(run.plan.case_ids.length, 84);
  assert.equal(new Set(run.plan.case_ids).size, 84);

  const rows = await run.execute();
  assert.equal(rows.length, 84);
  assert.deepEqual([...rows.map(({case_id: caseId}) => caseId)].sort(), [...caseSet.caseIds].sort());
  const pairs = rows.map(({observations}) => `${observations.scenario}:${observations.subject_id}:${observations.interval}`);
  assert.equal(new Set(pairs).size, 84);

  for (const row of rows) assert.equal(run.verifyCase(row.case_id, row.observations).verified, true);
  const proof = await run.cleanup();
  assert.equal(proof.public_absence_verified, true);
  assert.equal(run.verifyCleanup(proof).public_absence_verified, true);
});

test("issue #1372 candidate seam rejects duplicate, unregistered, and missing evidence rows", async (t) => {
  const boundaries = [
    ["duplicate", (rows) => [rows[0], ...rows], /duplicates/u],
    ["unregistered", (rows) => [...rows, {...rows[0], subject_id: "pane:unknown"}], /unregistered/u],
    ["missing", (rows) => rows.slice(1), /missing/u],
    ["not-an-array", () => null, /must be an array/u],
  ];
  for (const [label, build, error] of boundaries) {
    await t.test(label, async () => {
      const {run, outputRoot} = await issue1372PrepareRun({evidenceBuilder: build});
      t.after(() => fs.rm(outputRoot, {recursive: true, force: true}));
      await assert.rejects(run.execute(), error);
    });
  }
});

test("issue #1372 candidate seam verifyCase rejects drifted observations", async (t) => {
  const {run, outputRoot} = await issue1372PrepareRun();
  t.after(() => fs.rm(outputRoot, {recursive: true, force: true}));
  const rows = await run.execute();
  const first = rows[0];
  const good = first.observations;
  assert.throws(() => run.verifyCase(first.case_id, {...good, source_revision: commit("9")}), /not exact/u);
  assert.throws(() => run.verifyCase(first.case_id, {...good, dom_sha256: "not-a-sha"}), /not exact/u);
  assert.throws(() => run.verifyCase(first.case_id, {...good, capture_errors: ["drift"]}), /not exact/u);
  const other = rows[rows.length - 1];
  assert.throws(() => run.verifyCase(first.case_id, other.observations), /not exact/u);
});

test("issue #1372 candidate seam verifyCleanup requires the public absence proof", async (t) => {
  const {run, outputRoot} = await issue1372PrepareRun();
  t.after(() => fs.rm(outputRoot, {recursive: true, force: true}));
  assert.throws(() => run.verifyCleanup({}), /did not prove owned-resource cleanup/u);
  assert.throws(() => run.verifyCleanup({public_absence_verified: false}), /did not prove owned-resource cleanup/u);
});

test("candidate case registry exposes the real #1026 user identity adapter", async () => {
  const caseSet = await candidateCaseSet("open43-q1026-user-identity");
  assert.equal(caseSet.id, "open43-q1026-user-identity");
  assert.deepEqual(caseSet.caseIds, ["Q1026_EXACT_CANDIDATE_PREVIEW_SAVED_IDENTITY"]);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("candidate case registry exposes an executable FTML marker contract", async () => {
  const caseSet = await candidateCaseSet("ftml-marker-contract");
  assert.equal(caseSet.id, "ftml-marker-contract");
  assert.deepEqual(caseSet.caseIds, ["F1380_FTML_MARKER_CONTRACT"]);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("candidate case command accepts only the fixed explicit attachment options", () => {
  assert.deepEqual(
    parseCandidateCaseArgs([
      "--",
      "--case-set",
      "open43-media-files",
      "--candidate-identity",
      "candidate.json",
      "--private-input",
      "private.json",
      "--output-dir",
      "evidence",
      "--run-id",
      "candidate-run-0123456789ab",
    ]),
    {
      "case-set": "open43-media-files",
      "candidate-identity": "candidate.json",
      "private-input": "private.json",
      "output-dir": "evidence",
      "run-id": "candidate-run-0123456789ab",
    },
  );
  assert.throws(
    () => parseCandidateCaseArgs(["--case-set", "open43-media-files"]),
    /missing --candidate-identity/u,
  );
  assert.throws(
    () => parseCandidateCaseArgs(["--plan", "dynamic.json"]),
    /unknown or duplicate option/u,
  );
  assert.throws(
    () => parseCandidateCaseArgs([
      "--case-set", "open43-media-files",
      "--candidate-identity", "candidate.json",
      "--private-input", "private.json",
      "--output-dir", "evidence",
      "--run-id", "candidate-case-0123456789ab",
    ]),
    /invalid --run-id/u,
  );
});

test("private candidate input is hashed from one private non-linked file read", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-case-private-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "private.json");
  await fs.writeFile(file, '{"secret":"private"}\n', { mode: 0o600 });
  const input = await readPrivateCandidateCaseInput(file);
  assert.deepEqual(input.value, { secret: "private" });
  assert.match(input.sha256, /^[0-9a-f]{64}$/u);

  const publicFile = path.join(root, "public.json");
  await fs.writeFile(publicFile, "{}\n", { mode: 0o644 });
  await assert.rejects(
    readPrivateCandidateCaseInput(publicFile),
    /private regular file/u,
  );

  const link = path.join(root, "private-link.json");
  await fs.symlink(file, link);
  await assert.rejects(
    readPrivateCandidateCaseInput(link),
    /private regular file/u,
  );
});
