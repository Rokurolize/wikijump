import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../fixtures/membership-invitation-consumption-evidence-fixture.json", import.meta.url);
const artifactUrl = new URL("../artifacts/membership-invitation-consumption-live-20260810.json", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function assertSha256(value) {
  assert.match(value, /^[0-9a-f]{64}$/u);
}

function assertNoPrivateMaterial(value) {
  const forbiddenKeys = /(?:username|email|password|cookie|session|csrf|authorization|invitation_url|raw_credential|mailbox|message_body|message_subject)/iu;
  const forbiddenValues = /(?:WIKIDOT_SESSION_ID|wikidot_token7|https?:\/\/[^\s]*invitation[^\s]*[?&=]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/iu;
  function visit(current) {
    if (Array.isArray(current)) {
      current.forEach(visit);
    } else if (current && typeof current === "object") {
      for (const [key, item] of Object.entries(current)) {
        assert.doesNotMatch(key, forbiddenKeys);
        visit(item);
      }
    } else if (typeof current === "string") {
      assert.doesNotMatch(current, forbiddenValues);
    }
  }
  visit(value);
}

test("A1033 invitation evidence freezes either complete controls or a zero-mutation blocker", async () => {
  const fixture = await readJson(fixtureUrl);
  const artifact = await readJson(artifactUrl);

  assert.equal(artifact.schema, "wikidot.live.a1033.membership-invitation-consumption.v1");
  assert.equal(artifact.lane_id, fixture.lane_id);
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.equal(artifact.run_id, fixture.run_id);
  assert.equal(artifact.public_site, fixture.site);
  assert.equal(artifact.closure, "not_closed");
  assert.ok(["evidence_captured", "blocked", "cleanup_failed"].includes(artifact.status));
  assert.deepEqual(artifact.actor_labels, fixture.actors);
  assertSha256(artifact.fixture_sha256);
  assertSha256(artifact.script_sha256);
  assertSha256(artifact.pinned_dependency_identity.requirements_sha256);
  assertSha256(artifact.pinned_dependency_identity.static_no_token_artifact_sha256);
  assertNoPrivateMaterial(artifact);

  assert.deepEqual(artifact.attempt_budget, fixture.attempt_budget);
  assert.ok(artifact.actual_counts.administrator_invitation_creations <= fixture.attempt_budget.administrator_invitation_creations);
  assert.ok(artifact.actual_counts.deliveries <= fixture.attempt_budget.deliveries);
  assert.equal(artifact.actual_counts.resends, 0);

  for (const [ruleId, controls] of Object.entries(artifact.claimed_rules)) {
    assert.deepEqual(controls.positive, fixture.rule_controls[ruleId].positive);
    assert.deepEqual(controls.negative, fixture.rule_controls[ruleId].negative);
    assert.equal(controls.positive.length, 2);
    assert.equal(controls.negative.length, 2);
    for (const controlId of [...controls.positive, ...controls.negative]) {
      const observation = artifact.controls.find(({control_id}) => control_id === controlId);
      assert.ok(observation, `missing observation ${controlId}`);
      assert.equal(typeof observation.actor_label, "string");
      assert.equal(typeof observation.public_operation_class, "string");
      assertSha256(observation.request_fingerprint);
      assert.equal(typeof observation.response_status, "string");
      assert.ok(observation.public_readback);
    }
  }

  if (artifact.status === "blocked") {
    assert.deepEqual(artifact.claimed_rules, {});
    assert.deepEqual(artifact.controls, []);
    assert.equal(artifact.mutation_attempt_count, 0);
    assert.equal(artifact.actual_counts.administrator_invitation_creations, 0);
    assert.equal(artifact.actual_counts.deliveries, 0);
    assert.equal(artifact.cleanup_status, "not_started");
    assert.ok(artifact.public_authority_missing.length > 0);
    assert.equal(artifact.preflight.mutation_capable_request_sent, false);
    assert.equal(artifact.preflight.live_invitation_created, false);
    assert.deepEqual(artifact.cleanup_receipt.remaining_run_owned_state, []);
  } else {
    assert.equal(Object.keys(artifact.claimed_rules).length, Object.keys(fixture.rule_controls).length);
    assert.equal(artifact.public_authority_missing.length, 0);
    assert.equal(artifact.pre_run_baseline.publicly_read, true);
    assert.equal(artifact.cleanup_receipt.publicly_read, true);
  }
});
