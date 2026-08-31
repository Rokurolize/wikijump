import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const receiptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "artifacts",
  "issue1367-comments-hideform-browser-live-20260815-r7.json",
);
const hashPattern = /^[0-9a-f]{64}$/u;
const expectedPairs = [
  "A:hideform-omitted",
  "A:hideform-false",
  "A:hideform-true",
  "A:hideform-yes",
  "E:hideform-omitted",
  "E:hideform-false",
  "E:hideform-true",
  "E:hideform-yes",
].sort();
const expectedHashes = {
  contract: "b61c75ea7156074d30be5ed343207be62e8df813c18574dd08836f7369c4bdec",
  cases: "8957cf6daf9ab152d24592bad02b7d23dc101cda1ea68396e7e7113ec52ad440",
  captureScript: "97f42e7ceb0af72a01a6b8f91b8d27083cefb3a1484358af7887120c8bfc7850",
  run: "a6468e52a5affbc0020d4e88a987c329a6f3abcc3a28a6f5c7d97e48c880f679",
  observations: "00fd9aa624792d3653dae2421578feabf5bc371ef2683a0d5224256b7ab7bdcf",
  settingNetwork: "eebe2741777a9206d63f4645e88a68f2c0df0bf69c16e0576a802a6bdb844aac",
  cleanup: "a3a6b9c4653f457b0f4eaf098ce85380ae05bb7ae9123b1669287f33bda7862c",
  cleanupProof: "2afe9aecb7eff26f1bbe634696489c080a2612707e00ee38ed7442526605dd39",
};

function collectPaths(value, key = "", output = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectPaths(child, key, output);
  } else if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      if (typeof child === "string" && childKey !== "field_path" && (childKey === "path" || /(?:_path|_dir|_root)$/u.test(childKey))) output.push(child);
      else collectPaths(child, childKey, output);
    }
  }
  return output;
}

test("issue #1367 receipt is a self-contained record of the completed r7 run", async () => {
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));

  assert.equal(receipt.schema, "wikijump.issue1367.comments_hideform_browser_live_receipt.v1");
  assert.equal(receipt.issue, 1367);
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.source_identity.commit, "e93b5b7459b371f043d877d04d6dec7356a9929e");
  assert.equal(receipt.source_identity.tree, "5c90982073fe54f6c74909de9ea75e35a44cc017");
  assert.equal(receipt.source_identity.run_id, "run-issue1367-ae-20260815-r7");
  assert.deepEqual(
    receipt.actors.map(({label, class: actorClass, roles}) => ({label, class: actorClass, roles})),
    [
      {label: "A", class: "authenticated-member-admin-permitted", roles: ["member", "admin"]},
      {label: "E", class: "authenticated-non-member-denied", roles: []},
    ],
  );
  assert.equal(receipt.actors.length, 2);
  assert.deepEqual(receipt.observations.map(({actor, case_id}) => actor + ":" + case_id).sort(), expectedPairs);
  assert.equal(receipt.observations.length, 8);
  assert.deepEqual(receipt.temporal_control.required_intervals, ["domcontentloaded", "settled"]);
  assert.equal(receipt.observations.reduce((count, observation) => count + Object.keys(observation.transition).length, 0), 16);
  for (const observation of receipt.observations) {
    assert.deepEqual(Object.keys(observation.transition).sort(), ["domcontentloaded", "settled"]);
  }

  assert.equal(receipt.fixture.fullname, "run-owned:codex-comments-hideform-1367-r7");
  assert.deepEqual(
    [
      receipt.cleanup.created_fixture_removed,
      receipt.cleanup.page_absent_after_removal,
      receipt.cleanup.setting_restored_exactly,
      receipt.cleanup.browser_profile_removed,
    ],
    [true, true, true, true],
  );
  assert.deepEqual([receipt.cleanup.public_status_before_cleanup, receipt.cleanup.public_status_after_cleanup], [200, 404]);

  assert.deepEqual(
    {
      contract: receipt.source_identity.contract_sha256,
      cases: receipt.source_identity.cases_sha256,
      captureScript: receipt.source_identity.capture_script_sha256,
      run: receipt.evidence.run_json.sha256,
      observations: receipt.evidence.observations_json.sha256,
      settingNetwork: receipt.run_owned.setting_mutation_artifact.sha256,
      cleanup: receipt.cleanup.cleanup_json.sha256,
      cleanupProof: receipt.cleanup.cleanup_proof_json.sha256,
    },
    expectedHashes,
  );
  for (const value of Object.values(expectedHashes)) assert.match(value, hashPattern);
  for (const evidence of Object.values(receipt.setting.raw)) assert.match(evidence.sha256, hashPattern);
  for (const observation of receipt.observations) assert.match(observation.network_sha256, hashPattern);

  const retainedPaths = collectPaths(receipt);
  assert.ok(retainedPaths.length >= 20);
  for (const retainedPath of retainedPaths) assert.equal(path.isAbsolute(retainedPath), true, retainedPath);

  assert.deepEqual(receipt.external_blockers, []);
  assert.equal(receipt.secret_scan.credential_value_matches, 9);
  assert.deepEqual(receipt.secret_scan.sensitive_value_matches, {
    email: 0,
    password: 0,
    session: 0,
    csrf: 0,
    edit_lock: 0,
  });
  assert.equal(receipt.secret_scan.raw_values_persisted, false);
  assert.equal(receipt.secret_scan.classified_matches[0].data_class, "public_username_text");
  assert.equal(receipt.secret_scan.classified_matches[0].count, 9);
  assert.equal("username" in receipt.actors[0], false);
  assert.equal("password" in receipt.actors[0], false);
});
