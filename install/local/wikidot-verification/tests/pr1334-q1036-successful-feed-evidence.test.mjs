import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixturePath = path.join(root, "install/local/wikidot-verification/fixtures/pr1334-q1036-successful-feed-adapter.json");
const artifactPath = path.join(root, "install/local/wikidot-verification/artifacts/pr1334-q1036-successful-feed-adapter-20260810.json");
const capturePath = path.join(root, "install/local/wikidot-verification/scripts/capture_pr1334_q1036_successful_feed.py");
const baseCommit = "898e57da57c964893380a44e8b9b7765f274351c";
const hashPattern = /^[0-9a-f]{64}$/u;
const privateAddressPattern = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.169\.254|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?|\b(?:fc|fd|fe80)[0-9a-f:]*)/iu;
const secretKeyPattern = /(?:authorization|cookie|set-cookie|password|raw_secret|raw_token|secret_value|control_header_value)/iu;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      visit(key, item);
      walk(item, visit);
    }
  }
}

function validatePublicUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:");
  assert.equal(url.port, "");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.doesNotMatch(url.hostname, privateAddressPattern);
}

function validateFixture(fixture) {
  assert.equal(fixture.schema, "wikijump.pr1334.q1036_successful_feed_adapter_cases.v1");
  assert.equal(fixture.base_commit, baseCommit);
  assert.equal(fixture.feature_id, "catalog-feature:module-feed");
  assert.equal(fixture.audit_case_id, "Q1036_SUCCESSFUL_FEED_ADAPTER");
  assert.equal(fixture.public_seams.wikidot_preview.method, "POST");
  validatePublicUrl(fixture.public_seams.wikidot_preview.url);
  assert.equal(fixture.public_seams.wikidot_preview.module_name, "edit/PagePreviewModule");
  assert.match(fixture.authority.specification_sha256, hashPattern);
  assert.match(fixture.authority.existing_observation_sha256, hashPattern);
  assert.ok(fixture.required_cases.length >= 14);
  assert.ok(fixture.budgets.maximum_preview_requests <= 18);
  assert.ok(fixture.budgets.maximum_provider_requests <= 12);
  assert.ok(fixture.budgets.maximum_total_requests <= 30);
  assert.ok(fixture.budgets.maximum_provider_mutations <= 4);
  assert.equal(fixture.budgets.maximum_feed_bytes, 65536);
  assert.equal(fixture.budgets.oversize_control_bytes, 65537);
  assert.ok(fixture.budgets.maximum_cache_window_seconds <= 90);
  assert.ok(fixture.budgets.maximum_wall_clock_seconds <= 240);
  assert.equal(fixture.safety.required_port, 443);
  for (const [key, value] of Object.entries(fixture.safety)) if (key !== "required_port") assert.equal(value, true, key);
}

function validateArtifact(fixture, artifact) {
  assert.equal(artifact.schema, "wikijump.pr1334.q1036_successful_feed_adapter_live.v1");
  assert.equal(artifact.disposition, "blocked");
  assert.equal(artifact.base_commit, baseCommit);
  assert.equal(artifact.feature_id, fixture.feature_id);
  assert.equal(artifact.audit_case_id, fixture.audit_case_id);
  assert.equal(artifact.fixture.path, path.relative(root, fixturePath));
  assert.equal(artifact.fixture.sha256, sha256(fs.readFileSync(fixturePath)));
  assert.equal(artifact.capture_script.path, path.relative(root, capturePath));
  assert.equal(artifact.capture_script.sha256, sha256(fs.readFileSync(capturePath)));
  assert.ok(fixture.blocked_reason_codes.includes(artifact.blocker.reason));
  assert.equal(artifact.blocker.stage, "safe_producer_gate");
  assert.deepEqual(artifact.public_seams, fixture.public_seams);
  assert.equal(artifact.authority.existing_observation_sha256, fixture.authority.existing_observation_sha256);
  assert.equal(artifact.authority.existing_observation_scope, fixture.authority.existing_observation_scope);
  assert.equal(artifact.provider_setup.attempted, false);
  assert.equal(artifact.wikidot_preview.attempted, false);
  assert.equal(artifact.wikidot_preview.reason, "producer_gate_failed_before_preview");
  assert.equal(artifact.provider_requests.length, 0);
  assert.equal(artifact.preview_requests.length, 0);
  assert.equal(artifact.request_counts.total, 0);
  assert.equal(artifact.request_counts.provider, 0);
  assert.equal(artifact.request_counts.preview, 0);
  assert.equal(artifact.request_counts.provider_mutations, 0);
  assert.equal(artifact.payload_counts.aggregate_retained_bytes, 0);
  assert.equal(artifact.unsafe_requests, 0);
  assert.equal(artifact.cleanup.status, "not_needed");
  assert.equal(artifact.cleanup.mutation_count, 0);
  assert.equal(artifact.server_fetch_vs_rendered_output.provider_input, null);
  assert.equal(artifact.server_fetch_vs_rendered_output.provider_receipt, null);
  assert.equal(artifact.server_fetch_vs_rendered_output.amc_envelope, null);
  assert.equal(artifact.server_fetch_vs_rendered_output.rendered_output, null);
  assert.equal(artifact.secret_scan.performed, true);
  assert.equal(artifact.secret_scan.in_memory_credential_values_loaded, 0);
  assert.equal(artifact.secret_scan.matches, 0);
  assert.deepEqual(artifact.observed_cases, []);
  assert.deepEqual(artifact.promotable_rules, []);
  assert.equal(artifact.remaining_gap, "A safe run-owned public HTTPS feed producer with request receipts and verified cleanup authority is still required before successful Feed rendering can be observed.");
  assert.deepEqual(artifact.budgets, fixture.budgets);
  assert.deepEqual(artifact.safety, fixture.safety);

  walk(artifact, (key, value) => {
    assert.doesNotMatch(key, secretKeyPattern);
    if (typeof value === "string") {
      assert.doesNotMatch(value, privateAddressPattern);
      assert.doesNotMatch(value, /(?:Authorization:|Cookie:|Set-Cookie:|Bearer\s|ghp_|github_pat_)/iu);
    }
  });
}

test("Q1036 Feed evidence is complete or exactly blocked before an unsafe producer request", () => {
  assert.ok(fs.existsSync(artifactPath), "artifact_missing");
  const fixture = readJson(fixturePath);
  const artifact = readJson(artifactPath);
  validateFixture(fixture);
  validateArtifact(fixture, artifact);

  const unsafe = structuredClone(artifact);
  unsafe.provider_requests.push({url: "https://127.0.0.1/feed.xml"});
  assert.throws(() => validateArtifact(fixture, unsafe));

  const overclaim = structuredClone(artifact);
  overclaim.promotable_rules.push("successful Feed rendering");
  assert.throws(() => validateArtifact(fixture, overclaim));

  const mutated = structuredClone(artifact);
  mutated.request_counts.provider_mutations = 1;
  assert.throws(() => validateArtifact(fixture, mutated));
});
