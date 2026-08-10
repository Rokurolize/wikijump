import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixturePath = path.join(root, "install/local/wikidot-verification/fixtures/pr1334-anonymousnotificationsunsubscribe-valid-token.json");
const artifactPath = path.join(root, "install/local/wikidot-verification/artifacts/pr1334-anonymousnotificationsunsubscribe-valid-token-20260810.json");
const scriptPath = path.join(root, "install/local/wikidot-verification/scripts/capture_pr1334_anonymousnotificationsunsubscribe_token.py");
const baseCommit = "898e57da57c964893380a44e8b9b7765f274351c";
const hashPattern = /^[0-9a-f]{64}$/u;
const blockedReasons = new Set([
  "missing_public_subscription_create",
  "missing_public_token_issuance",
  "missing_exact_run_owned_mail_sink",
  "missing_public_unsubscribe_cleanup",
  "missing_authentic_expiration_control",
  "issued_url_not_https",
  "delivered_action_not_observable_without_browser",
  "pinned_client_unavailable",
  "response_budget_exceeded"
]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateFixture(fixture) {
  assert.equal(fixture.schema, "wikijump.pr1334.anonymousnotificationsunsubscribe_token_cases.v1");
  assert.equal(fixture.base_commit, baseCommit);
  assert.equal(fixture.surface_id, "catalog-feature:module-anonymousnotificationsunsubscribe");
  assert.equal(fixture.feature_id, "module-anonymousnotificationsunsubscribe");
  assert.deepEqual(fixture.case_ids, ["T_VALID", "T_CONSUMED_REPLAY", "T_EXPIRED", "MALFORMED_INVALID", "WELL_FORMED_WRONG", "NO_TOKEN"]);
  assert.deepEqual(new Set(fixture.required_authorities), new Set([
    "public_subscription_create",
    "public_token_issuance",
    "exact_run_owned_mail_sink",
    "public_unsubscribe_cleanup",
    "authentic_expiration_control",
    "issued_https_url",
    "delivered_action"
  ]));
  assert.ok(fixture.blocked_reason_precedence.every((reason) => blockedReasons.has(reason)));
  assert.ok(fixture.budgets.maximum_http_requests <= 36);
  assert.ok(fixture.budgets.maximum_state_changing_wikidot_requests <= 6);
  assert.ok(fixture.budgets.maximum_exact_messages_read <= 2);
  assert.ok(fixture.budgets.maximum_issued_tokens <= 2);
  assert.ok(fixture.budgets.maximum_mail_polls <= 6);
  assert.ok(fixture.budgets.maximum_mail_wait_seconds <= 60);
  assert.ok(fixture.budgets.maximum_expiry_wait_seconds <= 60);
  assert.ok(fixture.budgets.maximum_body_bytes <= 262144);
  assert.ok(fixture.budgets.maximum_aggregate_retained_bytes <= 2097152);
  assert.ok(fixture.budgets.maximum_redirects <= 2);
  assert.ok(fixture.budgets.maximum_wall_clock_seconds <= 180);
  assert.equal(fixture.safety.authority_gate_before_mutation, true);
  assert.equal(fixture.safety.raw_token_persistence_allowed, false);
  assert.equal(fixture.safety.mailbox_enumeration_allowed, false);
  for (const record of Object.values(fixture.authority).filter((value) => value && typeof value === "object")) {
    if (record.sha256) assert.match(record.sha256, hashPattern);
  }
}

function validateArtifact(fixture, artifact) {
  assert.equal(artifact.schema, "wikijump.pr1334.anonymousnotificationsunsubscribe_token_live.v1");
  assert.equal(artifact.base_commit, baseCommit);
  assert.equal(artifact.surface_id, fixture.surface_id);
  assert.equal(artifact.feature_id, fixture.feature_id);
  assert.ok(["observed", "blocked"].includes(artifact.disposition));
  assert.equal(artifact.capture_script.path, path.relative(root, scriptPath));
  assert.equal(artifact.capture_script.sha256, sha256(fs.readFileSync(scriptPath)));
  assert.equal(artifact.fixture.path, path.relative(root, fixturePath));
  assert.equal(artifact.fixture.sha256, sha256(fs.readFileSync(fixturePath)));
  assert.deepEqual(artifact.authority_gate.required, fixture.required_authorities);
  assert.equal(artifact.authority_gate.checked_before_mutation, true);
  assert.equal(artifact.secret_scan.performed_before_output_open, true);
  assert.equal(artifact.secret_scan.matches, 0);
  assert.equal(artifact.privacy.raw_tokens_persisted, 0);
  assert.equal(artifact.privacy.raw_issued_urls_persisted, 0);
  assert.equal(artifact.no_token_evidence.claim_boundary, "missing-token rendering only; not evidence for valid-token behavior");
  assert.equal(artifact.no_token_evidence.sha256, fixture.authority.no_token_evidence.sha256);
  assert.equal(artifact.token_state_matrix.length, fixture.case_ids.length);
  assert.deepEqual(artifact.token_state_matrix.map(({case_id}) => case_id), fixture.case_ids);
  assert.deepEqual(artifact.budgets, fixture.budgets);
  for (const [key, actual] of Object.entries(artifact.counts)) {
    if (!key.startsWith("wall_clock")) assert.ok(Number.isInteger(actual) && actual >= 0, key);
  }

  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
  assert.doesNotMatch(serialized, /(?:authorization|set-cookie|csrf)[\s_:-]*(?:value|header)?\s*[=:]\s*["'][^"']+/iu);
  assert.doesNotMatch(serialized, /(?:session|cookie)[\s_:-]*(?:id|value)?\s*[=:]\s*["'][^"']+/iu);
  assert.doesNotMatch(serialized, /[?&](?:token|key|code)=[^&"'}\s]+/iu);
  assert.doesNotMatch(serialized, /"(?:token|issued_url)"\s*:/iu);
  assert.doesNotMatch(serialized, /"(?:implemented|promotable|closed)"\s*:\s*true/iu);

  if (artifact.disposition === "blocked") {
    assert.equal(artifact.authority_gate.passed, false);
    assert.ok(blockedReasons.has(artifact.authority_gate.blocked_reason));
    assert.equal(artifact.authority_gate.blocked_reason, fixture.blocked_reason_precedence[0]);
    assert.equal(artifact.counts.http_requests, 0);
    assert.equal(artifact.counts.state_changing_wikidot_requests, 0);
    assert.equal(artifact.counts.exact_messages_read, 0);
    assert.equal(artifact.counts.issued_tokens, 0);
    assert.equal(artifact.counts.mail_polls, 0);
    assert.equal(artifact.counts.aggregate_retained_body_bytes, 0);
    assert.equal(artifact.mutated, false);
    assert.deepEqual(artifact.cleanup, {status: "not_needed", pre_run_state_used: false, run_owned_state_created: false});
    assert.equal(artifact.privacy.real_subscriptions_collected, 0);
    assert.equal(artifact.privacy.mailbox_messages_collected, 0);
    for (const state of artifact.token_state_matrix) {
      assert.equal(state.status, "not_observed");
      assert.equal(state.reason, artifact.authority_gate.blocked_reason);
    }
  } else {
    assert.equal(artifact.authority_gate.passed, true);
    assert.equal(artifact.authority_gate.blocked_reason, null);
    assert.ok(artifact.authority_gate.required.every((name) => artifact.authority_gate.available[name] === true));
    assert.equal(artifact.counts.issued_tokens, 2);
    assert.ok(artifact.counts.exact_messages_read >= 2);
    assert.ok(artifact.counts.exact_messages_read <= fixture.budgets.maximum_exact_messages_read);
    assert.ok(artifact.counts.http_requests <= fixture.budgets.maximum_http_requests);
    assert.ok(artifact.counts.state_changing_wikidot_requests <= fixture.budgets.maximum_state_changing_wikidot_requests);
    assert.ok(artifact.counts.mail_polls <= fixture.budgets.maximum_mail_polls);
    assert.ok(artifact.counts.aggregate_retained_body_bytes <= fixture.budgets.maximum_aggregate_retained_bytes);
    assert.equal(artifact.cleanup.status, "restored");
    assert.equal(artifact.cleanup.pre_post_state_equivalent, true);
    assert.equal(artifact.authentic_expiration.proven, true);
    for (const state of artifact.token_state_matrix) {
      assert.equal(state.status, "observed");
      assert.match(state.raw_body_sha256, hashPattern);
    }
    for (const reference of artifact.token_references) {
      assert.match(reference.token_sha256, hashPattern);
      assert.match(reference.issued_url_sha256, hashPattern);
      assert.ok(reference.redacted_url.includes("{TOKEN}"));
    }
  }
}

test("unsubscribe token residual is complete evidence or an exact pre-mutation block", () => {
  assert.ok(fs.existsSync(artifactPath), "artifact_missing");
  assert.ok(fs.existsSync(scriptPath), "capture_script_missing");
  const fixture = readJson(fixturePath);
  const artifact = readJson(artifactPath);
  validateFixture(fixture);
  validateArtifact(fixture, artifact);

  const unsafe = structuredClone(artifact);
  unsafe.counts.state_changing_wikidot_requests = 1;
  assert.throws(() => validateArtifact(fixture, unsafe));

  const overclaim = structuredClone(artifact);
  overclaim.token_state_matrix[0].status = "observed";
  assert.throws(() => validateArtifact(fixture, overclaim));

  const leaked = structuredClone(artifact);
  leaked.observation = "https://example.invalid/unsubscribe?token=raw-value";
  assert.throws(() => validateArtifact(fixture, leaked));
});
