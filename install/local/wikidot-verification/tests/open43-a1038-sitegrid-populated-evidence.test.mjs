import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const fixturePath = "install/local/wikidot-verification/fixtures/open43-a1038-sitegrid-populated.json";
const artifactPath = "install/local/wikidot-verification/artifacts/open43-a1038-sitegrid-populated-live.json";
const scriptPath = "install/local/wikidot-verification/scripts/capture_wikidot_sitegrid_populated.py";
const base = "43471ea5a4759e3cf855bf3a3ec5456d0901ce01";
const surfaces = ["open43-audit-case:A1038_SITEGRID_POPULATED", "catalog-feature:module-sitegrid"];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

function validateFixture(fixture) {
  assert.equal(fixture.schema, "wikijump.open43.a1038_sitegrid_populated_fixture.v1");
  assert.deepEqual(fixture.surface_ids, surfaces);
  assert.equal(fixture.integration_base, base);
  assert.deepEqual(fixture.endpoint, {
    origin: "http://sandbox-for-codex.wikidot.com",
    host: "sandbox-for-codex.wikidot.com",
    path: "/ajax-module-connector.php",
    method: "POST",
    fields: ["moduleName", "mode", "source", "title"],
    moduleName: "edit/PagePreviewModule",
    mode: "page",
    title: "wj-open43-sitegrid-populated-evidence-20260810",
  });
  assert.deepEqual(fixture.visible_site_identities, ["community", "scp-wiki"]);
  assert.deepEqual(fixture.missing_site_identities, ["wj-open43-sitegrid-missing-a-20260810", "wj-open43-sitegrid-missing-b-20260810"]);
  assert.equal(fixture.probes.length, 8);
  assert.equal(new Set(fixture.probes.map((probe) => probe.id)).size, 8);
  assert.equal(fixture.probes.filter((probe) => probe.class === "visible").length, 2);
  assert.equal(fixture.probes.filter((probe) => probe.class === "missing").length, 2);
  assert.equal(fixture.probes.filter((probe) => probe.class === "mixed").length, 2);
  assert.equal(fixture.probes.filter((probe) => probe.class === "repeat").length, 2);
  assert.equal(fixture.probes[6].source, fixture.probes[7].source);
  assert.notEqual(fixture.probes[0].source, fixture.probes[1].source);
  assert.notEqual(fixture.probes[2].source, fixture.probes[3].source);
  for (const probe of fixture.probes) {
    assert.ok(Buffer.byteLength(probe.source) <= fixture.budgets.maximum_source_bytes);
    assert.ok(probe.identities.every((identity) => probe.source.includes(identity)));
  }
  assert.deepEqual(fixture.budgets, {
    maximum_outbound_requests: 10,
    maximum_pagepreview_attempts: 8,
    maximum_retries: 1,
    minimum_interval_seconds: 4,
    maximum_source_bytes: 4096,
    maximum_request_body_bytes: 16384,
    maximum_aggregate_request_bytes: 98304,
    maximum_response_bytes: 393216,
    maximum_aggregate_response_bytes: 2097152,
    connect_timeout_seconds: 10,
    read_timeout_seconds: 15,
    wall_clock_seconds: 150,
    maximum_direct_asset_requests: 0,
    maximum_mutations: 0,
  });
  assert.deepEqual(fixture.forbidden_private_site_content.private_site_identities, []);
  assert.equal(fixture.forbidden_private_site_content.direct_site_or_asset_requests_allowed, false);
  assert.equal(new Set(fixture.establishable_rule_ids).size, 7);
}

function rejectSensitiveKeys(value, location = "$") {
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectSensitiveKeys(entry, `${location}[${index}]`));
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assert.doesNotMatch(key, /(password|passwd|cookie|authorization|session|token|secret|api_key|private_key|credential)/i, `sensitive key at ${location}.${key}`);
      rejectSensitiveKeys(entry, `${location}.${key}`);
    }
  }
}

test("frozen SiteGrid evidence obeys the bounded public-read contract", () => {
  const fixture = readJson(fixturePath);
  validateFixture(fixture);
  if (!fs.existsSync(path.join(root, artifactPath))) {
    throw new Error(`EVIDENCE_ARTIFACT_MISSING:${artifactPath}`);
  }
  const artifactBytes = fs.readFileSync(path.join(root, artifactPath));
  const artifact = JSON.parse(artifactBytes.toString("utf8"));
  assert.equal(artifact.schema, "wikijump.open43.a1038_sitegrid_populated_live_evidence.v1");
  assert.ok(["captured", "blocked"].includes(artifact.acquisition_status));
  assert.ok(["evidence_ready", "non_closure"].includes(artifact.case_disposition));
  assert.notEqual(artifact.case_disposition, "closed");
  assert.deepEqual(artifact.surface_ids, surfaces);
  assert.equal(artifact.base_commit, base);
  assert.equal(artifact.script_sha256, sha256(fs.readFileSync(path.join(root, scriptPath))));
  assert.equal(artifact.fixture_sha256, sha256(fs.readFileSync(path.join(root, fixturePath))));
  assert.deepEqual(artifact.endpoint_identity, fixture.endpoint);
  assert.deepEqual(artifact.visible_site_identities, fixture.visible_site_identities);
  assert.deepEqual(artifact.missing_or_denied_site_identities, fixture.missing_site_identities);
  assert.equal(new Set(artifact.visible_site_identities).size, 2);
  assert.equal(new Set(artifact.missing_or_denied_site_identities).size, 2);
  assert.equal(artifact.mutations_attempted, 0);
  assert.equal(artifact.mutations_completed, 0);
  assert.equal(artifact.cleanup, "not_applicable_read_only");
  assert.equal(artifact.privacy.private_site_identifiers_collected, 0);
  assert.equal(artifact.privacy.private_site_content_collected, 0);
  assert.equal(artifact.privacy.direct_asset_requests, 0);
  assert.equal(artifact.privacy.normalization, "none");
  rejectSensitiveKeys(fixture);
  rejectSensitiveKeys(artifact);

  const counters = artifact.counters;
  assert.ok(counters.actual_requests <= fixture.budgets.maximum_outbound_requests);
  assert.ok(counters.pagepreview_attempts <= fixture.budgets.maximum_pagepreview_attempts);
  assert.ok(counters.retries <= fixture.budgets.maximum_retries);
  assert.ok(counters.request_bytes <= fixture.budgets.maximum_aggregate_request_bytes);
  assert.ok(counters.response_bytes <= fixture.budgets.maximum_aggregate_response_bytes);
  assert.ok(counters.elapsed_seconds <= fixture.budgets.wall_clock_seconds);
  assert.equal(counters.actual_requests, counters.pagepreview_attempts + counters.retries);
  assert.ok(artifact.attempted_routes.every((route) => route.method === "POST" && route.host === fixture.endpoint.host && route.path === fixture.endpoint.path));
  assert.ok(artifact.attempted_routes.every((route) => route.request_bytes <= fixture.budgets.maximum_request_body_bytes));

  const observationIds = new Set(Object.keys(artifact.observations));
  for (const [id, observation] of Object.entries(artifact.observations)) {
    assert.equal(id, observation.probe_id);
    assert.equal(observation.request_endpoint, "http://sandbox-for-codex.wikidot.com/ajax-module-connector.php");
    assert.ok(observation.response_byte_count <= fixture.budgets.maximum_response_bytes);
    if (!observation.rejected_oversize) {
      assert.equal(observation.normalization, "none");
      assert.equal(sha256(observation.selected_fragment), observation.selected_fragment_sha256);
      assert.match(observation.response_sha256, /^[0-9a-f]{64}$/);
      assert.ok(Array.isArray(observation.card_order));
      assert.ok(Array.isArray(observation.relevant_links));
      assert.ok(Array.isArray(observation.inert_image_descriptors));
    }
  }
  assert.deepEqual(Object.keys(artifact.claims).sort(), [...fixture.establishable_rule_ids].sort());
  for (const [ruleId, claim] of Object.entries(artifact.claims)) {
    assert.ok(["established", "blocked", "unobserved", "not_applicable"].includes(claim.status), ruleId);
    assert.ok(Array.isArray(claim.positive_observation_ids));
    assert.ok(Array.isArray(claim.negative_observation_ids));
    if (claim.status === "established") {
      assert.equal(claim.positive_observation_ids.length, 2);
      assert.equal(claim.negative_observation_ids.length, 2);
      assert.equal(new Set(claim.positive_observation_ids).size, 2);
      assert.equal(new Set(claim.negative_observation_ids).size, 2);
      assert.ok(claim.positive_observation_ids.every((id) => observationIds.has(id)));
      assert.ok(claim.negative_observation_ids.every((id) => observationIds.has(id)));
      assert.ok(claim.positive_observation_ids.every((id) => !claim.negative_observation_ids.includes(id)));
      const positiveInputs = claim.positive_observation_ids.map((id) => JSON.stringify(artifact.observations[id].input_identities));
      const negativeInputs = claim.negative_observation_ids.map((id) => JSON.stringify(artifact.observations[id].input_identities));
      assert.equal(new Set(positiveInputs).size, 2);
      assert.equal(new Set(negativeInputs).size, 2);
      assert.ok(claim.positive_observation_ids.every((id) => Object.values(artifact.observations[id].identity_mentioned).some(Boolean)));
      assert.ok(claim.negative_observation_ids.every((id) => Object.values(artifact.observations[id].identity_mentioned).every((mentioned) => !mentioned)));
    } else {
      assert.equal(typeof claim.missing_authority, "string");
      assert.ok(claim.missing_authority.length > 0);
    }
  }
  assert.notEqual(artifact.claims.private_site_non_disclosure.status, "established");
  assert.notEqual(artifact.claims.hovertip_interaction.status, "established");
  assert.notEqual(artifact.claims.limit_behavior.status, "established");
  assert.equal(artifact.acquisition_status === "blocked", counters.actual_requests === 0);
});
