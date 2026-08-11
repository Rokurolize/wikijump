import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {fileURLToPath} from "node:url";

process.chdir(fileURLToPath(new URL("../../../../", import.meta.url)));

const artifactPath = "install/local/wikidot-verification/artifacts/pr1334-wws-route-attribution-no-thumbnails-20260810.json";
let artifact;
try { artifact = JSON.parse(readFileSync(artifactPath, "utf8")); }
catch (error) { if (error.code === "ENOENT") throw new Error("artifact_missing: run bounded WWS route source-attribution capture"); throw error; }
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const fixture = readJson(artifact.fixture_path);

test("base, fixture, script, inventory identity, and privacy", () => {
  assert.equal(artifact.schema, "wikijump.pr1334.wws_route_attribution.v1");
  assert.equal(artifact.base_commit, "f2b5769e1ff6206c31cc2b66a03675c64fba6318");
  assert.equal(artifact.fixture_sha256, sha256(artifact.fixture_path));
  assert.equal(artifact.capture_script_sha256, sha256(artifact.capture_script_path));
  assert.equal(artifact.inventory_sha256, sha256(artifact.inventory_path));
  const serialized = JSON.stringify({fixture, artifact});
  assert.doesNotMatch(serialized, /(?:\/home\/|\/mnt\/|[A-Za-z]:\\)/);
  assert.doesNotMatch(serialized, /(?:authorization|bearer|password|secret|csrf|session.token|cookie|request.body|environment)/i);
  assert.deepEqual(artifact.privacy, {absolute_paths_retained: 0, credential_values_retained: 0, private_output_retained: false});
});

test("exact 27-ID denominator and exact thumbnail exclusions", () => {
  assert.deepEqual(fixture.routes.map(([method, path]) => `wws-route:${method}:${path}`), fixture.surface_ids);
  const expected = fixture.surface_ids.toSorted();
  assert.deepEqual(artifact.surface_ids, expected);
  assert.equal(new Set(artifact.surface_ids).size, 27);
  assert.deepEqual(artifact.thumbnail_exclusions, fixture.thumbnail_exclusions);
  for (const excluded of fixture.thumbnail_exclusions) assert.ok(!artifact.surface_ids.includes(excluded));
});

test("exact 16 ANY and 11 GET route-registration attribution", () => {
  assert.equal(artifact.records.filter((record) => record.declared_method_class === "ANY").length, 16);
  assert.equal(artifact.records.filter((record) => record.declared_method_class === "GET").length, 11);
  for (const record of artifact.records) {
    assert.equal(record.route_registration_path, "wws/src/route.rs");
    assert.ok(record.route_anchor_text.includes(`"${record.surface_id.slice(record.surface_id.indexOf(":/") + 1)}"`));
    assert.ok(record.route_anchor_text.includes(`${record.declared_method_class.toLowerCase()}(${record.registered_handler_symbol})`));
    assert.deepEqual(record.route_registration_line_range.length, 2);
  }
});

test("exact handler-owner attribution", () => {
  for (const record of artifact.records) {
    assert.equal(record.inventory_public_owner, "wws");
    assert.equal(record.source_owner, "wws");
    assert.match(record.registered_handler_symbol, /^handle_[a-z_]+$/);
    assert.match(record.handler_definition_path, /^wws\/src\/handler\/[a-z_]+\.rs$/);
    assert.deepEqual(record.handler_definition_line_range.length, 2);
    for (const [path, hash] of Object.entries(record.source_sha256)) assert.equal(hash, sha256(path));
  }
});

test("exhaustive test-backed/test-gap classification, aggregate counts, and no parity overclaim", () => {
  const backed = artifact.records.filter((record) => record.test_status === "test_backed");
  const gaps = artifact.records.filter((record) => record.test_status === "test_gap");
  assert.equal(backed.length + gaps.length, 27);
  for (const record of backed) { assert.ok(record.test_witnesses.length > 0); assert.equal(record.gap_reason, ""); }
  for (const record of gaps) { assert.deepEqual(record.test_witnesses, []); assert.ok(record.gap_reason.length > 0); }
  assert.deepEqual(artifact.counts, {surfaces: 27, any_surfaces: 16, get_surfaces: 11, thumbnail_surfaces_selected: 0, route_registrations_attributed: 27, handler_owners_attributed: 27, source_gaps: 0, test_backed: backed.length, test_gap: gaps.length, test_backed_plus_test_gap: 27, network_requests: 0, mutations: 0});
  for (const record of artifact.records) {
    assert.equal(record.claim_scope, "source_attribution_only"); assert.equal(record.compatibility_verdict, "not_evaluated");
    assert.equal(record.candidate_status, "not_run"); assert.equal(record.standing_status, "not_run");
  }
  assert.equal(artifact.network_requests, 0); assert.equal(artifact.mutations, 0);
});
