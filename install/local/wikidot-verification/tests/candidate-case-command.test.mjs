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

test("candidate case registry exposes the executable issue 775 adapter", async () => {
  const caseSet = await candidateCaseSet("open43-issue775-edit");
  assert.equal(caseSet.id, "open43-issue775-edit");
  assert.deepEqual(caseSet.caseIds, ["A775_ACTOR_NAVIGATION_BROWSER"]);
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
    ]),
    {
      "case-set": "open43-media-files",
      "candidate-identity": "candidate.json",
      "private-input": "private.json",
      "output-dir": "evidence",
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
