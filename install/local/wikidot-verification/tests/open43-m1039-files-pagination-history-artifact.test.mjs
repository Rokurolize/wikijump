import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../fixtures/open43-m1039-files-pagination-history/cases.json", import.meta.url);
const artifactUrl = new URL("../artifacts/open43-m1039-files-pagination-history-live-20260810.json", import.meta.url);

const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const artifact = JSON.parse(await readFile(artifactUrl, "utf8"));

test("M1039 artifact binds the exact source, surface, site, actors, and public interfaces", () => {
  assert.equal(artifact.schema, "wikidot.live.open43.m1039.files-pagination-history.v1");
  assert.equal(artifact.source_identity.base_commit, fixture.source_identity.base_commit);
  assert.deepEqual(artifact.target_surface_ids, fixture.target_surface_ids);
  assert.equal(artifact.site, fixture.site);
  assert.deepEqual(artifact.actor_matrix.map(({label}) => label), fixture.actors);
  assert.deepEqual(Object.keys(artifact.public_interfaces), fixture.public_interfaces);
  assert.match(artifact.evidence_identity.captured_at_utc, /^2026-08-10T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u);
  assert.match(artifact.evidence_identity.fixture_sha256, /^[0-9a-f]{64}$/u);
  assert.match(artifact.evidence_identity.script_sha256, /^[0-9a-f]{64}$/u);
});

test("M1039 artifact preserves every required observation section and setup bound", () => {
  assert.deepEqual(Object.keys(artifact.observations), fixture.observation_sections);
  assert.equal(artifact.setup.required_active_rows, fixture.setup.required_active_rows);
  assert.equal(artifact.setup.required_deleted_rows, fixture.setup.required_deleted_rows);
  assert.equal(artifact.setup.required_history_targets, fixture.setup.history_targets);
  assert.equal(artifact.setup.required_versions_per_history_target, fixture.setup.versions_per_history_target);
  assert.deepEqual(artifact.setup.byte_lengths, fixture.setup.byte_lengths);
  assert.deepEqual(artifact.setup.filename_control_kinds, fixture.setup.filename_control_kinds);
});

test("M1039 artifact is either complete observed evidence or an exact blocker receipt", () => {
  assert.ok(["observed", "blocked"].includes(artifact.status));
  if (artifact.status === "observed") {
    assert.ok(artifact.setup.active_rows_achieved >= fixture.setup.required_active_rows);
    assert.ok(artifact.pagination_bounds.active_row_denominator >= fixture.setup.required_active_rows);
    assert.ok(artifact.pagination_bounds.rows_per_page > 0);
    assert.ok(artifact.pagination_bounds.total_observed_pages >= 2);
    assert.equal(artifact.cleanup.verified, true);
    assert.deepEqual(artifact.cleanup.remaining_run_owned_objects, []);
    assert.deepEqual(artifact.promoted_rules.map(({rule_id}) => rule_id), fixture.attempted_rules.map(({rule_id}) => rule_id));
    for (const rule of artifact.promoted_rules) {
      const declared = fixture.attempted_rules.find(({rule_id}) => rule_id === rule.rule_id);
      assert.ok(declared);
      assert.deepEqual(rule.positive_control_ids, declared.positive_control_ids);
      assert.deepEqual(rule.negative_control_ids, declared.negative_control_ids);
      assert.equal(rule.positive_control_ids.length, 2);
      assert.equal(rule.negative_control_ids.length, 2);
    }
  } else {
    assert.deepEqual(artifact.promoted_rules, []);
    assert.equal(artifact.setup.active_rows_achieved, 0);
    assert.equal(artifact.setup.total_bytes_uploaded, 0);
    assert.equal(artifact.mutation_performed, false);
    assert.equal(artifact.cleanup.verified, true);
    assert.deepEqual(artifact.cleanup.remaining_run_owned_objects, []);
    assert.equal(artifact.blocked_reason.code, "private-page-acl-public-preflight-unavailable");
    assert.ok(artifact.blocked_reason.missing_authority.length > 0);
    assert.ok(Object.values(artifact.public_interfaces).every(({status}) => status === "not_attempted_due_to_preflight_block"));
    assert.ok(Object.values(artifact.observations).every(({status}) => ["not_attempted_due_to_preflight_block", "verified_no_mutation_required"].includes(status)));
  }
});

test("M1039 artifact is secret-free", () => {
  const serialized = JSON.stringify(artifact);
  assert.equal(artifact.credentials_exposed, false);
  assert.doesNotMatch(serialized, /WIKIDOT_SESSION_ID|wikidot_token7|lock_secret|csrf|set-cookie|authorization/iu);
  assert.doesNotMatch(serialized, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu);
});
