import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const base = "43471ea5a4759e3cf855bf3a3ec5456d0901ce01";
const surfaces = [
  "open43-audit-case:Q810_ACTIVE_GLOBAL_ROTATION",
  "catalog-feature:module-featuredsite",
];
const fixturePath = "install/local/wikidot-verification/fixtures/open43-q810-featuredsite-global-rotation.json";
const artifactPath = "install/local/wikidot-verification/artifacts/open43-q810-featuredsite-global-rotation-live.json";
const scriptPath = "install/local/wikidot-verification/scripts/capture_wikidot_featuredsite_global_rotation.py";
const requirementsPath = "install/local/wikidot-verification/requirements.txt";
const producerOffsets = [0, 4, 8, 12, 32, 36, 56, 60];
const negativeOffsets = [64, 68];
const sensitiveKey = /^(?:password|passwd|cookie|authorization|session[_-]?(?:id|token)|access[_-]?token|api[_-]?key|client[_-]?secret|private[_-]?key|credential)$/i;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function walk(value, visit, path = "$") {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assert.equal(sensitiveKey.test(key), false, `sensitive key at ${path}.${key}`);
      walk(item, visit, `${path}.${key}`);
    }
  }
}

function expectedForm(fixture, source) {
  const seam = fixture.producer_seam;
  return new URLSearchParams([
    ["wikidot_token7", String(seam.anonymous_wikidot_token7)],
    ["moduleName", seam.module_name],
    ["mode", seam.mode],
    ["source", source],
    ["title", seam.title],
  ]).toString();
}

function validateFixture(fixture) {
  assert.equal(fixture.schema, "wikijump.open43.q810_featuredsite_global_rotation_fixture.v1");
  assert.deepEqual(fixture.surface_ids, surfaces);
  assert.equal(fixture.integration_base, base);
  assert.deepEqual(fixture.producer_observation_offsets_seconds, producerOffsets);
  assert.equal(fixture.optional_public_producer_page, null);
  assert.deepEqual(
    {
      scheme: fixture.producer_seam.scheme,
      host: fixture.producer_seam.host,
      path: fixture.producer_seam.path,
      method: fixture.producer_seam.method,
      authenticated: fixture.producer_seam.authenticated,
      module_name: fixture.producer_seam.module_name,
      mode: fixture.producer_seam.mode,
      source: fixture.producer_seam.source,
      title: fixture.producer_seam.title,
    },
    {
      scheme: "http",
      host: "sandbox-for-codex.wikidot.com",
      path: "/ajax-module-connector.php",
      method: "POST",
      authenticated: false,
      module_name: "edit/PagePreviewModule",
      mode: "page",
      source: "[[module FeaturedSite]]\ncommunity.wikidot.com\n[[/module]]",
      title: "Open43 Q810 FeaturedSite global rotation evidence",
    },
  );
  assert.equal(fixture.producer_seam.request_form_bytes_utf8, expectedForm(fixture, fixture.producer_seam.source));
  assert.equal(fixture.negative_controls.length, 2);
  assert.deepEqual(fixture.negative_controls.map((item) => item.scheduled_offset_seconds), negativeOffsets);
  assert.equal(new Set(fixture.negative_controls.map((item) => item.body_identity)).size, 2);
  for (const control of fixture.negative_controls) {
    assert.match(control.body_identity, /^wj-open43-featuredsite-missing-[ab]-20260810$/);
    assert.equal(control.source, `[[module FeaturedSite]]\n${control.body_identity}\n[[/module]]`);
  }
  assert.deepEqual(fixture.budgets, {
    maximum_outbound_requests: 10,
    producer_attempts: 8,
    negative_control_attempts: 2,
    retries: 0,
    redirects_followed: 0,
    minimum_interval_seconds: 4,
    maximum_request_body_bytes: 4096,
    maximum_aggregate_request_bytes: 40960,
    maximum_response_bytes: 262144,
    maximum_aggregate_response_bytes: 2097152,
    connect_timeout_seconds: 10,
    read_timeout_seconds: 15,
    maximum_schedule_lateness_seconds: 3,
    wall_clock_seconds: 150,
    direct_asset_requests: 0,
    mutations: 0,
    private_content_reads: 0,
  });
  assert.deepEqual(fixture.policies.allowed_hosts, ["sandbox-for-codex.wikidot.com"]);
  for (const key of [
    "no_cache_busters",
    "no_assets",
    "no_mutations",
    "no_private_site_data",
    "no_expected_featured_site_identities",
    "local_wikijump_is_not_oracle",
    "producer_is_not_leaf_owned",
  ]) assert.equal(fixture.policies[key], true, key);
  walk(fixture, () => {});
}

function validateArtifact(fixture, artifact) {
  assert.equal(artifact.schema, "wikijump.open43.q810_featuredsite_global_rotation_live_evidence.v1");
  assert.ok(["captured", "blocked"].includes(artifact.acquisition_status));
  assert.ok(["evidence_ready", "non_closure"].includes(artifact.case_disposition));
  assert.deepEqual(artifact.surface_ids, surfaces);
  assert.equal(artifact.integration_base, base);
  assert.equal(artifact.fixture_sha256, sha256(readFileSync(fixturePath)));
  assert.equal(artifact.capture_script_sha256, sha256(readFileSync(scriptPath)));
  assert.equal(artifact.dependency.wikidot_py_commit, fixture.dependency.wikidot_py_commit);
  assert.equal(artifact.dependency.wikidot_py_version, fixture.dependency.wikidot_py_version);
  assert.equal(artifact.dependency.requirements_path, requirementsPath);
  assert.equal(artifact.dependency.requirements_sha256, sha256(readFileSync(requirementsPath)));
  assert.deepEqual(artifact.producer_seam, fixture.producer_seam);
  assert.deepEqual(artifact.schedule, {
    producer_offsets_seconds: producerOffsets,
    negative_control_offsets_seconds: negativeOffsets,
  });
  const producerForm = expectedForm(fixture, fixture.producer_seam.source);
  assert.equal(artifact.producer_request_sha256, sha256(producerForm));
  assert.equal(artifact.counters.retries, 0);
  assert.equal(artifact.counters.redirects_followed, 0);
  assert.equal(artifact.counters.asset_requests, 0);
  assert.equal(artifact.counters.mutations_attempted, 0);
  assert.equal(artifact.counters.private_content_reads, 0);
  assert.equal(artifact.cleanup, "not_applicable_read_only");
  assert.equal(artifact.producer_owned_by_leaf, false);
  assert.equal(artifact.hard_coded_local_producer_recommendation, null);
  for (const value of Object.values(artifact.unestablished)) assert.equal(value, "not_established");
  walk(artifact, (value, path) => {
    if (typeof value === "string") {
      assert.equal(/(?:localhost|wikijump\.localhost|wjfiles\.localhost)/i.test(value), false, `local value at ${path}`);
    }
  });

  if (artifact.acquisition_status === "blocked") {
    assert.equal(artifact.case_disposition, "non_closure");
    assert.equal(artifact.global_rotation_authority, "not_established");
    assert.deepEqual(artifact.observations, []);
    assert.equal(artifact.counters.actual_requests, 0);
    assert.equal(artifact.counters.producer_attempts, 0);
    assert.equal(artifact.counters.negative_control_attempts, 0);
    assert.ok(artifact.blockers.length > 0);
    return;
  }

  assert.equal(artifact.observations.length, 10);
  assert.equal(artifact.counters.actual_requests, 10);
  assert.equal(artifact.counters.producer_attempts, 8);
  assert.equal(artifact.counters.negative_control_attempts, 2);
  assert.ok(artifact.counters.request_bytes <= fixture.budgets.maximum_aggregate_request_bytes);
  assert.ok(artifact.counters.response_bytes <= fixture.budgets.maximum_aggregate_response_bytes);
  assert.ok(artifact.wall_clock_elapsed_seconds <= fixture.budgets.wall_clock_seconds);
  const producers = artifact.observations.slice(0, 8);
  const negatives = artifact.observations.slice(8);
  assert.deepEqual(producers.map((item) => item.probe_id), producerOffsets.map((_, index) => `producer-${index}`));
  assert.deepEqual(producers.map((item) => item.scheduled_offset_seconds), producerOffsets);
  assert.deepEqual(negatives.map((item) => item.probe_id), fixture.negative_controls.map((item) => item.probe_id));
  assert.deepEqual(negatives.map((item) => item.scheduled_offset_seconds), negativeOffsets);
  assert.deepEqual(artifact.negative_control_observation_ids, negatives.map((item) => item.probe_id));
  const producerHashes = new Set(producers.map((item) => item.request_body_sha256));
  assert.deepEqual([...producerHashes], [artifact.producer_request_sha256]);
  for (let index = 1; index < artifact.observations.length; index += 1) {
    const interval = artifact.observations[index].actual_monotonic_offset_seconds - artifact.observations[index - 1].actual_monotonic_offset_seconds;
    assert.ok(interval >= fixture.budgets.minimum_interval_seconds - 0.001, `interval ${index} is too short`);
  }
  for (const observation of artifact.observations) {
    assert.ok(observation.request_body_bytes <= fixture.budgets.maximum_request_body_bytes);
    assert.ok(observation.response_bytes <= fixture.budgets.maximum_response_bytes);
    assert.equal(observation.redirect_refused && artifact.counters.redirects_followed !== 0, false);
    assert.deepEqual(Object.keys(observation.selected_headers), ["date", "etag", "last-modified", "cache-control", "age"]);
  }

  const observationIds = new Set(artifact.observations.map((item) => item.probe_id));
  assert.equal(observationIds.size, 10);
  for (const claim of artifact.claims) {
    assert.ok(fixture.rule_ids.includes(claim.rule_id));
    assert.ok(["established", "blocked", "unobserved", "not_applicable"].includes(claim.status));
    if (claim.status === "established") {
      assert.equal(claim.positive_observation_ids.length, 4);
      assert.equal(claim.negative_observation_ids.length, 2);
      assert.equal(new Set(claim.positive_observation_ids).size, 4);
      assert.equal(new Set(claim.negative_observation_ids).size, 2);
      for (const id of [...claim.positive_observation_ids, ...claim.negative_observation_ids]) assert.ok(observationIds.has(id));
    } else {
      assert.deepEqual(claim.positive_observation_ids, []);
      assert.deepEqual(claim.negative_observation_ids, []);
    }
  }
  assert.equal(new Set(artifact.claims.map((item) => item.rule_id)).size, fixture.rule_ids.length);
  assert.equal(artifact.claims.length, fixture.rule_ids.length);
  const rotation = artifact.claims.find((item) => item.rule_id === "global_rotation");
  assert.ok(rotation);
  if (artifact.global_rotation_authority === "established") {
    assert.equal(artifact.case_disposition, "evidence_ready");
    assert.equal(rotation.status, "established");
    assert.deepEqual(rotation.positive_observation_ids, artifact.positive_rotation_observation_ids);
    assert.deepEqual(rotation.negative_observation_ids, artifact.negative_control_observation_ids);
    const selected = rotation.positive_observation_ids.map((id) => artifact.observations.find((item) => item.probe_id === id));
    const counts = new Map();
    for (const observation of selected) counts.set(observation.selected_card_identity, (counts.get(observation.selected_card_identity) ?? 0) + 1);
    assert.equal(counts.size, 2);
    assert.deepEqual([...counts.values()].sort(), [2, 2]);
    const selectedIdentities = new Set(counts.keys());
    for (const negative of negatives) assert.equal(selectedIdentities.has(negative.selected_card_identity), false);
    assert.ok(artifact.maximum_schedule_lateness_seconds <= fixture.budgets.maximum_schedule_lateness_seconds);
  } else {
    assert.equal(artifact.global_rotation_authority, "not_established");
    assert.equal(artifact.case_disposition, "non_closure");
    assert.equal(rotation.status, "blocked");
    assert.deepEqual(artifact.positive_rotation_observation_ids, []);
    assert.ok(artifact.blockers.length > 0);
  }
}

test("frozen FeaturedSite global rotation evidence satisfies the bounded contract", () => {
  const fixture = readJson(fixturePath);
  validateFixture(fixture);
  if (!existsSync(artifactPath)) {
    throw new Error(`EVIDENCE_ARTIFACT_MISSING:${artifactPath}`);
  }
  validateArtifact(fixture, readJson(artifactPath));
});
