import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixturePath = "install/local/wikidot-verification/fixtures/open43-a1038-themepreviewer-active.json";
const artifactPath = "install/local/wikidot-verification/artifacts/open43-a1038-themepreviewer-active-live.json";
const scriptPath = "install/local/wikidot-verification/scripts/capture_wikidot_themepreviewer_active.py";
const requirementsPath = "install/local/wikidot-verification/requirements.txt";
const base = "43471ea5a4759e3cf855bf3a3ec5456d0901ce01";
const surfaces = [
  "open43-audit-case:A1038_THEMEPREVIEWER_ACTIVE",
  "catalog-feature:module-themepreviewer",
];
const fixtureSchema = "wikijump.open43.a1038_themepreviewer_active_fixture.v1";
const artifactSchema = "wikijump.open43.a1038_themepreviewer_active_live_evidence.v1";
const sensitiveKey = /^(?:password|passwd|cookie|authorization|session|token|secret|api_key|private_key|credential)$/i;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inspectKeys(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectKeys(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assert.doesNotMatch(key, sensitiveKey, `sensitive JSON key at ${path}.${key}`);
      inspectKeys(item, `${path}.${key}`);
    }
  }
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("fixture freezes the exact zero-asset acquisition contract", async () => {
  const fixture = await loadJson(fixturePath);
  assert.equal(fixture.schema, fixtureSchema);
  assert.deepEqual(fixture.surface_ids, surfaces);
  assert.equal(fixture.integration_base, base);
  assert.deepEqual(fixture.endpoint, {
    host: "sandbox-for-codex.wikidot.com",
    path: "/ajax-module-connector.php",
    method: "POST",
    redirect_policy: "same-response-only",
  });
  assert.deepEqual(fixture.initial_request.query, {});
  assert.deepEqual(fixture.initial_request.payload, {
    moduleName: "edit/PagePreviewModule",
    mode: "page",
    source: "[[module ThemePreviewer]]",
    title: fixture.title,
  });
  assert.equal(fixture.active_request.query_parameter, "theme_url");
  assert.equal(fixture.active_request.query_value_source, "positive_theme_urls");
  assert.deepEqual(fixture.active_request.payload, {
    moduleName: "edit/PagePreviewModule",
    mode: "page",
    source: '[[module ThemePreviewer noUi="true"]]',
    title: fixture.title,
  });
  assert.deepEqual(fixture.positive_theme_urls, []);
  assert.equal(fixture.pre_capture_blocker.code, "TWO_PROVENANCE_BACKED_PUBLIC_THEME_URLS_UNAVAILABLE");
  assert.ok(fixture.negative_query_controls.length >= 2);
  assert.equal(new Set(fixture.negative_query_controls.map(({ observation_id }) => observation_id)).size, fixture.negative_query_controls.length);
  assert.deepEqual(fixture.budgets, {
    outbound_attempts: 12,
    pagepreview_post_attempts: 6,
    mutation_attempts: 1,
    restore_attempts: 1,
    mutation_readback_restore_requests: 4,
    retries: 1,
    minimum_attempt_interval_seconds: 4,
    source_bytes_per_probe: 2048,
    encoded_request_body_per_attempt: 8192,
    aggregate_encoded_request_bytes: 65536,
    response_bytes_per_attempt: 393216,
    aggregate_response_bytes: 1572864,
    connect_timeout_seconds: 10,
    read_timeout_seconds: 15,
    wall_clock_seconds: 180,
    direct_asset_requests: 0,
    irreversible_mutations: 0,
  });
  assert.equal(fixture.external_asset_policy, "Never fetch an external stylesheet or any referenced asset.");
  assert.equal(fixture.mutation_policy.namespace, "open43-a1038-themepreviewer-");
  inspectKeys(fixture);
});

test("live evidence remains bounded, distinct, source-independent, and non-closing", async () => {
  let artifact;
  try {
    artifact = await loadJson(artifactPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`EVIDENCE_ARTIFACT_MISSING:${artifactPath}`);
    }
    throw error;
  }
  const fixtureBytes = await readFile(fixturePath);
  const scriptBytes = await readFile(scriptPath);
  const requirementsBytes = await readFile(requirementsPath);
  const requirements = requirementsBytes.toString("utf8");
  const commit = requirements.match(/Rokurolize\/wikidot\.py@([0-9a-f]{40})/)?.[1];

  assert.equal(artifact.schema, artifactSchema);
  assert.ok(["captured", "blocked"].includes(artifact.acquisition_status));
  assert.ok(["evidence_ready", "non_closure"].includes(artifact.case_disposition));
  assert.notEqual(artifact.case_disposition, "closed");
  assert.deepEqual(artifact.surface_ids, surfaces);
  assert.equal(artifact.base_commit, base);
  assert.equal(artifact.script_sha256, sha256(scriptBytes));
  assert.equal(artifact.fixture_sha256, sha256(fixtureBytes));
  assert.equal(artifact.dependency_identity.package, "wikidot");
  assert.ok(typeof artifact.dependency_identity.version === "string" && artifact.dependency_identity.version.length > 0);
  assert.equal(artifact.dependency_identity.pinned_commit, commit);
  assert.equal(artifact.dependency_identity.requirements_sha256, sha256(requirementsBytes));
  assert.deepEqual(artifact.endpoint_identity, {
    host: "sandbox-for-codex.wikidot.com",
    path: "/ajax-module-connector.php",
    method: "POST",
    redirect_policy: "same-response-only",
  });
  assert.notEqual(artifact.initial_state_observation.observation_id, artifact.active_state_observation.observation_id);
  assert.notDeepEqual(artifact.initial_state_observation.request_contract, artifact.active_state_observation.request_contract);
  assert.equal(artifact.counters.external_asset_requests, 0);
  assert.equal(artifact.counters.irreversible_mutations, 0);
  assert.ok(artifact.counters.actual_requests <= 12);
  assert.ok(artifact.counters.pagepreview_attempts <= 6);
  assert.ok(artifact.counters.mutation_attempts <= 1);
  assert.ok(artifact.counters.restore_attempts <= 1);
  assert.ok(artifact.counters.retries <= 1);
  assert.ok(artifact.counters.request_bytes <= 65536);
  assert.ok(artifact.counters.response_bytes <= 1572864);
  assert.ok(artifact.timing.elapsed_seconds <= 180);
  assert.equal(artifact.budgets.direct_asset_requests, 0);
  assert.ok(Array.isArray(artifact.attempted_routes) && artifact.attempted_routes.length > 0);
  const observationIds = new Set([
    artifact.initial_state_observation.observation_id,
    artifact.active_state_observation.observation_id,
  ]);
  for (const claim of artifact.claims) {
    assert.ok(["established", "blocked", "unobserved", "not_applicable"].includes(claim.status));
    assert.equal(new Set(claim.positive_observation_ids).size, claim.positive_observation_ids.length);
    assert.equal(new Set(claim.negative_observation_ids).size, claim.negative_observation_ids.length);
    if (claim.status === "established") {
      assert.equal(claim.positive_observation_ids.length, 2);
      assert.equal(claim.negative_observation_ids.length, 2);
      claim.positive_observation_ids.forEach((id) => assert.ok(observationIds.has(id)));
      claim.negative_observation_ids.forEach((id) => assert.ok(observationIds.has(id)));
    } else {
      assert.equal(claim.positive_observation_ids.length, 0);
      assert.equal(claim.negative_observation_ids.length, 0);
    }
  }
  const requiredRules = new Set([
    "initial-ui-state",
    "no-ui-state",
    "theme-url-query-interpretation",
    "scheme-and-host-handling",
    "descriptor-emission",
    "active-application-interval",
    "csp-interaction",
    "size-and-timeout-behavior",
    "stale-state-cleanup-and-restoration",
  ]);
  assert.deepEqual(new Set(artifact.claims.map(({ rule_id }) => rule_id)), requiredRules);
  if (artifact.acquisition_status === "blocked") {
    assert.equal(artifact.case_disposition, "non_closure");
    assert.equal(artifact.counters.actual_requests, 0);
    assert.equal(artifact.counters.mutation_attempts, 0);
    assert.equal(artifact.mutation_authority, "blocked");
    assert.equal(artifact.cleanup.status, "not-required-zero-mutations");
  }
  inspectKeys(artifact);
});
