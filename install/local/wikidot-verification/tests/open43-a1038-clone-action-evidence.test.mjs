import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const fixturePath = "install/local/wikidot-verification/fixtures/open43-a1038-clone-action.json";
const artifactPath = "install/local/wikidot-verification/artifacts/open43-a1038-clone-action-live.json";
const base = "43471ea5a4759e3cf855bf3a3ec5456d0901ce01";
const surfaces = ["open43-audit-case:A1038_CLONE_ACTION", "catalog-feature:module-clone"];
const forbiddenSites = new Set(["scp-wiki", "scp-jp", "sandbox-for-codex", "scpaiueouiuiuiui", "scp-jp-sandbox3"]);
const sensitiveKeys = ["pass" + "word", "pass" + "wd", "cook" + "ie", "author" + "ization", "session_" + "id", "session_" + "token", "access_" + "token", "api_" + "key", "client_" + "secret", "private_" + "key", "cred" + "ential"];

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function sha256File(relative) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
}

function collectKeys(value, output = []) {
  if (Array.isArray(value)) for (const item of value) collectKeys(item, output);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    output.push(key.toLowerCase());
    collectKeys(item, output);
  }
  return output;
}

function validateNoSensitiveKeys(value) {
  const keys = collectKeys(value);
  for (const key of keys) assert.equal(sensitiveKeys.some((term) => key.includes(term)), false, `sensitive JSON key: ${key}`);
}

function validateFixture(fixture) {
  assert.equal(fixture.schema, "wikijump.open43.a1038_clone_action_fixture.v1");
  assert.deepEqual(fixture.surface_ids, surfaces);
  assert.equal(fixture.integration_base, base);
  assert.deepEqual(fixture.read_only_preview_seam, {
    host: "sandbox-for-codex.wikidot.com",
    path: "/ajax-module-connector.php",
    http_method: "POST",
    module_name: "edit/PagePreviewModule",
    mode: "page",
    title: "Open43 A1038 Clone action authority preflight",
    source_forms: [
      "[[module Clone]]",
      '[[module Clone source="open43-clone-src-20260810-c1038"]]',
      '[[module Clone source="open43-clone-src-20260810-c1038" button="OPEN43 CLONE C1038"]]',
    ],
  });
  assert.match(fixture.source_site, /^open43-clone-src-20260810-[a-z0-9]+$/);
  assert.match(fixture.destination_site, /^open43-clone-dst-20260810-[a-z0-9]+$/);
  assert.notEqual(fixture.source_site, fixture.destination_site);
  assert.equal(forbiddenSites.has(fixture.source_site), false);
  assert.equal(forbiddenSites.has(fixture.destination_site), false);
  assert.equal(fixture.dependency.wikidot_py_commit, "2434bf77744488cb2095327c9e0e4450add78df3");
  assert.equal(sha256File(fixture.dependency.requirements_path), fixture.dependency.requirements_sha256);
  assert.deepEqual(fixture.observation_ids.positive, ["a1038-clone-shell-positive-1", "a1038-clone-shell-positive-2"]);
  assert.deepEqual(fixture.observation_ids.negative, ["a1038-clone-shell-negative-1", "a1038-clone-shell-negative-2"]);
  assert.deepEqual(fixture.budgets, {
    actual_outbound_requests: 20,
    preflight_requests: 8,
    read_requests: 15,
    clone_action_requests: 1,
    clone_attempts: 1,
    cleanup_mutation_requests: 2,
    mutation_requests: 3,
    retries: 1,
    minimum_interval_seconds: 4.0,
    request_body_bytes_per_attempt: 16384,
    aggregate_request_bytes: 131072,
    response_bytes_per_attempt: 524288,
    aggregate_response_bytes: 4194304,
    sentinel_text_characters_per_object: 4096,
    files_copied: 2,
    pages_copied: 2,
    connect_timeout_seconds: 10,
    read_timeout_seconds: 20,
    wall_clock_seconds: 300,
    irreversible_mutations: 0,
    nonpublic_content_reads: 0,
  });
  for (const authority of fixture.authority_sources) {
    const absolute = path.isAbsolute(authority.path) ? authority.path : path.join(root, authority.path);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex"), authority.sha256);
  }
  validateNoSensitiveKeys(fixture);
}

test("A1038 Clone action evidence is fail-closed and authority-bound", () => {
  const fixture = readJson(fixturePath);
  validateFixture(fixture);
  if (!fs.existsSync(path.join(root, artifactPath))) {
    assert.fail(`EVIDENCE_ARTIFACT_MISSING:${artifactPath}`);
  }
  const artifactStat = fs.statSync(path.join(root, artifactPath));
  const testStat = fs.statSync(new URL(import.meta.url));
  assert.ok(artifactStat.mtimeMs >= testStat.mtimeMs, "artifact predates the acceptable RED validator");
  const artifact = readJson(artifactPath);
  assert.equal(artifact.schema, "wikijump.open43.a1038_clone_action_live_evidence.v1");
  assert.equal(artifact.acquisition_status, "blocked");
  assert.equal(artifact.case_disposition, "non_closure");
  assert.equal(artifact.non_closure, true);
  assert.deepEqual(artifact.surface_ids, surfaces);
  assert.equal(artifact.integration_base, base);
  assert.equal(artifact.fixture_sha256, sha256File(fixturePath));
  assert.deepEqual(artifact.dependency, fixture.dependency);
  assert.deepEqual(artifact.endpoint_identity, fixture.read_only_preview_seam);
  assert.equal(artifact.mutation_seam_status, "blocked");
  assert.equal(artifact.mutation_seam, null);
  assert.equal(artifact.source_site, fixture.source_site);
  assert.equal(artifact.destination_site, fixture.destination_site);
  assert.equal(artifact.source_disposable, false);
  assert.equal(artifact.destination_disposable, false);
  assert.equal(artifact.deletion_authority, false);
  assert.equal(artifact.restoration_authority, false);
  assert.deepEqual(artifact.counters, {
    actual_requests: 0,
    redirect_responses: 0,
    read_requests: 0,
    mutation_requests: 0,
    clone_action_requests: 0,
    clone_attempts: 0,
    cleanup_mutation_requests: 0,
    retries: 0,
    request_bytes: 0,
    response_bytes: 0,
    elapsed_seconds: artifact.counters.elapsed_seconds,
  });
  assert.ok(artifact.counters.elapsed_seconds >= 0 && artifact.counters.elapsed_seconds <= fixture.budgets.wall_clock_seconds);
  assert.deepEqual(artifact.budgets, fixture.budgets);
  assert.deepEqual(artifact.observations, []);
  assert.equal(artifact.clone_attempt, null);
  assert.deepEqual(artifact.cleanup, {
    required: false,
    records: [],
    destination_absent_verified: false,
    destination_baseline_restored: false,
    source_baseline_restored: false,
    residual_state: "none",
  });
  assert.equal(artifact.local_observations, 0);
  assert.equal(artifact.nonpublic_content_reads, 0);
  assert.equal(artifact.sensitive_material_collected, false);
  assert.ok(artifact.blockers.some((value) => value.includes("exact Clone action")));
  assert.ok(artifact.blockers.some((value) => value.includes("deletion authority")));
  for (const claim of artifact.claims) {
    assert.ok(["established", "blocked", "unobserved", "not_applicable"].includes(claim.status));
    if (claim.status === "established") {
      assert.equal(new Set(claim.positive_observation_ids).size, 2);
      assert.equal(new Set(claim.negative_observation_ids).size, 2);
      assert.equal(claim.positive_observation_ids.length, 2);
      assert.equal(claim.negative_observation_ids.length, 2);
    }
  }
  assert.equal(artifact.claims.some((claim) => claim.status === "established"), false);
  validateNoSensitiveKeys(artifact);
});
