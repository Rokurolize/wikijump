import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixturePath = path.join(
  root,
  "install/local/wikidot-verification/fixtures/mailform-dom-submit-evidence-fixture.json",
);
const artifactPath = path.join(
  root,
  "install/local/wikidot-verification/artifacts/mailform-dom-submit-live-20260810.json",
);
const scriptPath = path.join(
  root,
  "install/local/wikidot-verification/scripts/capture_wikidot_mailform_dom_submit.py",
);

const expectedSurfaces = [
  "open43-audit-case:A1037_MAILFORM_INITIAL_DOM_AND_SUBMIT",
  "catalog-feature:module-mailform",
];

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

test("fixture fixes the MailForm safety and control boundaries", async () => {
  const fixture = await readJson(fixturePath);
  assert.equal(fixture.lane_id, "evidence-a1037-mailform-dom-submit");
  assert.deepEqual(fixture.surface_ids, expectedSurfaces);
  assert.equal(fixture.run_id, "a1037-mailform-20260810-001");
  assert.equal(fixture.budgets.submit_attempt_maximum, 6);
  assert.equal(fixture.budgets.expected_delivery_maximum, 2);
  assert.equal(fixture.budgets.retry_allowed, false);
  assert.equal(fixture.safety.omitted_to_allowed, false);
  assert.equal(fixture.safety.uncontrolled_recipient_allowed, false);
  for (const controls of Object.values(fixture.control_matrix)) {
    assert.equal(controls.positive.length, 2);
    assert.equal(controls.negative.length, 2);
  }
});

test("frozen evidence is privacy-safe and cannot overclaim closure", async () => {
  const artifact = await readJson(artifactPath);
  assert.equal(artifact.schema, "wikijump.compat.mailform_dom_submit_evidence.v1");
  assert.equal(artifact.lane_id, "evidence-a1037-mailform-dom-submit");
  assert.deepEqual(artifact.surface_ids, expectedSurfaces);
  assert.equal(artifact.run_id, "a1037-mailform-20260810-001");
  assert.equal(artifact.status, "blocked");
  assert.equal(artifact.closure, "not_closed");
  assert.equal(artifact.fixture_sha256, await sha256(fixturePath));
  assert.equal(artifact.capture_script_sha256, await sha256(scriptPath));
  assert.match(artifact.dependency_identity.sandbox_account_helper_sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.dependency_identity.wikidot_py_revision, /^[0-9a-f]{40}$/);
  assert.equal(artifact.submit_attempt_count, 0);
  assert.equal(artifact.delivery_count, 0);
  assert.equal(artifact.unexpected_delivery_count, 0);
  assert.equal(artifact.mutation_attempt_count, 0);
  assert.equal(artifact.cleanup.status, "not_started");
  assert.deepEqual(artifact.claimed_rules, []);
  assert.deepEqual(artifact.observations.dom, []);
  assert.deepEqual(artifact.observations.mutation, []);
  assert.deepEqual(artifact.observations.delivery, []);
  assert.ok(artifact.public_authority.proved.includes("sandbox_account_credentials_present"));
  assert.ok(artifact.public_authority.missing.includes("run_id_only_recipient_sink_query"));
  assert.ok(artifact.public_authority.missing.includes("run_id_message_deletion"));
  assert.equal(artifact.privacy.addresses_persisted, 0);
  assert.equal(artifact.privacy.credentials_persisted, 0);
  assert.equal(artifact.privacy.raw_hidden_values_persisted, 0);
  assert.equal(artifact.privacy.mail_messages_persisted, 0);
  assert.equal(artifact.privacy.unrelated_content_persisted, 0);
  assert.equal(artifact.budgets.submit_attempt_maximum, 6);
  assert.equal(artifact.budgets.expected_delivery_maximum, 2);
  assert.equal(artifact.budgets.retry_count, 0);

  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /@[A-Za-z0-9.-]+/);
  assert.doesNotMatch(serialized, /cookie|password|authorization/i);
});
