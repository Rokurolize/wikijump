import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../fixtures/membership-application-review-evidence-fixture.json", import.meta.url);
const artifactUrl = new URL("../artifacts/membership-application-review-live-20260810.json", import.meta.url);
const scriptUrl = new URL("../scripts/capture_wikidot_membership_application_review.py", import.meta.url);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function readJson(url, label) {
  let bytes;
  try {
    bytes = await readFile(url);
  } catch (error) {
    assert.fail(`${label} must exist: ${error.code ?? error.message}`);
  }
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

test("blocked membership application evidence records zero mutation and exact authority gaps", async () => {
  const fixture = await readJson(fixtureUrl, "fixture");
  const script = await readFile(scriptUrl);
  const artifact = await readJson(artifactUrl, "frozen artifact");

  assert.equal(fixture.value.schema, "wikijump.wikidot_membership_application_review_fixture.v1");
  assert.equal(artifact.value.schema, "wikijump.wikidot_membership_application_review_evidence.v1");
  assert.equal(artifact.value.lane_id, fixture.value.lane_id);
  assert.deepEqual(artifact.value.surface_ids, fixture.value.surface_ids);
  assert.equal(artifact.value.run_id, fixture.value.run_id);
  assert.equal(artifact.value.site.unix_name, fixture.value.site.unix_name);
  assert.equal(artifact.value.capture_identity.fixture_sha256, sha256(fixture.bytes));
  assert.equal(artifact.value.capture_identity.script_sha256, sha256(script));

  assert.equal(artifact.value.status, "blocked");
  assert.equal(artifact.value.closure, "not_closed");
  assert.equal(artifact.value.mutation_attempt_count, 0);
  assert.equal(artifact.value.cleanup_status, "not_started");
  assert.deepEqual(artifact.value.claimed_rules, []);
  assert.deepEqual(artifact.value.dom_reads, []);
  assert.deepEqual(artifact.value.mutation_actions, []);
  assert.deepEqual(artifact.value.public_readbacks, []);
  assert.equal(artifact.value.cleanup_receipt.mutations_started, false);
  assert.equal(artifact.value.cleanup_receipt.live_state_debt_created, false);

  assert.deepEqual(
    artifact.value.public_authority_missing.map(({ id }) => id),
    fixture.value.required_authorities,
  );
  for (const gap of artifact.value.public_authority_missing) {
    assert.equal(typeof gap.observation, "string");
    assert.ok(gap.observation.length > 0);
    assert.ok(Array.isArray(gap.evidence_sources) && gap.evidence_sources.length > 0);
  }

  for (const [ruleId, controls] of Object.entries(fixture.value.control_matrix)) {
    assert.equal(controls.positive.length, 2, `${ruleId} needs exactly two positive controls`);
    assert.equal(controls.negative.length, 2, `${ruleId} needs exactly two negative controls`);
    assert.equal(new Set(controls.positive).size, 2, `${ruleId} positive controls must be distinct`);
    assert.equal(new Set(controls.negative).size, 2, `${ruleId} negative controls must be distinct`);
  }

  assert.ok(artifact.value.remaining_gaps.includes("R1_ELIGIBILITY_DOM"));
  assert.ok(artifact.value.remaining_gaps.includes("R2_SUBMISSION_AND_DEDUPLICATION"));
  assert.ok(artifact.value.remaining_gaps.includes("R3_REVIEW_AUTHORITY"));
  assert.ok(artifact.value.remaining_gaps.includes("R4_SINGLE_RESOLUTION_AND_STALE_REPLAY"));
  assert.ok(artifact.value.remaining_gaps.includes("R5_TARGETED_PUBLIC_POST_STATE"));

  const serialized = artifact.bytes.toString("utf8");
  const forbiddenKeys = [
    "password",
    "cookie",
    "session_token",
    "csrf",
    "authorization",
    "application_text",
    "email_address",
  ];
  for (const key of forbiddenKeys) {
    assert.equal(serialized.includes(`\"${key}\"`), false, `artifact must not contain ${key}`);
  }
});
