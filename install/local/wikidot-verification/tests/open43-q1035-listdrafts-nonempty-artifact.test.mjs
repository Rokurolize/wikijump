import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../fixtures/open43-q1035-listdrafts-nonempty/cases.json", import.meta.url);
const artifactUrl = new URL("../artifacts/open43-q1035-listdrafts-nonempty-live-20260810.json", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function assertNoSecretMaterial(value) {
  function visit(current) {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (current && typeof current === "object") {
      for (const [key, item] of Object.entries(current)) {
        assert.doesNotMatch(key, /session|token|lock_secret|csrf|password|email|cookie|set-cookie/iu);
        visit(item);
      }
      return;
    }
    if (typeof current === "string") {
      assert.doesNotMatch(current, /WIKIDOT_SESSION_ID\s*=|wikidot_token7\s*=|lock_secret\s*=|csrf\s*=|password\s*=/iu);
      assert.doesNotMatch(current, /\b[A-Za-z0-9_-]{80,}\b/u);
    }
  }
  visit(value);
}

function assertCleanup(artifact, fixture, requireCapturedBaseline) {
  assert.equal(artifact.cleanup.discard_existing.verified_absent, true);
  assert.equal(artifact.cleanup.discard_nonexisting.verified_absent, true);
  assert.equal(artifact.cleanup.published_page_deleted, true);
  assert.equal(artifact.cleanup.holder_page_deleted, true);
  assert.equal(typeof artifact.cleanup.baseline_restored, "boolean");
  if (requireCapturedBaseline) assert.equal(artifact.cleanup.baseline_restored, true);
  assert.deepEqual(artifact.cleanup.remaining_run_owned_objects, []);
  assert.deepEqual(artifact.cleanup.owned_fullnames, [
    fixture.fixture.existing_page,
    fixture.fixture.nonexisting_page,
    fixture.fixture.holder_page,
  ]);
}

test("Q1035 ListDrafts artifact is complete observed evidence or an exact blocker receipt", async () => {
  const fixture = await readJson(fixtureUrl);
  const artifact = await readJson(artifactUrl);

  assert.equal(artifact.schema, "wikidot.live.open43.q1035-listdrafts-nonempty.v1");
  assert.equal(artifact.site, fixture.site);
  assert.equal(artifact.run_id, fixture.run_id);
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.match(artifact.captured_at, /^2026-08-10T/u);
  assert.match(artifact.fixture_sha256, /^[0-9a-f]{64}$/u);
  assert.ok(["observed", "blocked"].includes(artifact.status));
  assertNoSecretMaterial(artifact);

  assert.deepEqual(artifact.fixture, fixture.fixture);
  assert.deepEqual(artifact.actor_matrix.map(({actor_id}) => actor_id), fixture.actors.map(({actor_id}) => actor_id));
  assert.equal(new Set(artifact.actor_matrix.map(({client_identity}) => client_identity)).size, fixture.actors.length);
  for (const actor of artifact.actor_matrix) {
    assert.equal(typeof actor.observed_role_category, "string");
    assert.ok(actor.observed_role_category.length > 0);
  }

  assert.deepEqual(artifact.public_interfaces, [
    "edit/PageEditModule",
    "WikiPageAction/savePage",
    "WikiPageAction/synchronize",
    "WikiPageAction/checkDraftExists",
    "WikiPageAction/removePageEditLock",
    "edit/PagePreviewModule",
    "anonymous saved-holder GET",
    "viewsource/ViewSourceModule",
    "WikiPageAction/deletePage"
  ]);
  assert.equal(artifact.preflight.discard_route_established, true);
  assert.equal(artifact.preflight.discard_verification_route_established, true);
  assert.equal(artifact.preflight.all_fullnames_absent_or_run_owned, true);
  assert.equal(artifact.preflight.foreign_draft_reused, false);

  if (artifact.status === "blocked") {
    assert.deepEqual(artifact.promoted_rules, []);
    assert.equal(typeof artifact.blocked.reason, "string");
    assert.ok(artifact.blocked.reason.length > 0);
    assert.equal(typeof artifact.blocked.missing_authority, "string");
    assert.ok(artifact.blocked.missing_authority.length > 0);
    assert.ok([0, 1, 2].includes(artifact.blocked.draft_types_created));
    assert.equal(artifact.blocked.draft_types_created, 0);
    assert.equal(artifact.cleanup.operations.every(({status}) => status === "already-absent"), true);
    assertCleanup(artifact, fixture, false);
    return;
  }

  assert.equal(artifact.blocked, null);
  assert.equal(artifact.lifecycle.empty_baseline.stage, "empty-baseline-before-run-owned-draft-creation");
  assert.equal(artifact.lifecycle.existing_only.existing_published_unchanged, true);
  assert.equal(artifact.lifecycle.both_drafts.existing_published_unchanged, true);
  assert.equal(artifact.lifecycle.both_drafts.nonexisting_target_absent, true);
  assert.equal(artifact.lifecycle.existing_updated.update_verified, true);
  assert.equal(artifact.lifecycle.nonexisting_updated.update_verified, true);
  assert.equal(artifact.lifecycle.after_existing_discard.existing_draft_absent, true);
  assert.equal(artifact.lifecycle.after_nonexisting_discard.nonexisting_draft_absent, true);
  assert.equal(artifact.lifecycle.final_baseline.run_owned_row_count, 0);
  assert.equal(artifact.lifecycle.final_baseline.wrapper_present_for_every_case, true);

  assert.deepEqual(Object.keys(artifact.preview_matrices).sort(), fixture.actors.map(({actor_id}) => actor_id).sort());
  for (const actor of fixture.actors) {
    const matrix = artifact.preview_matrices[actor.actor_id];
    assert.deepEqual(matrix.map(({case_id}) => case_id), fixture.listdrafts_cases.map(({case_id}) => case_id));
    for (const row of matrix) {
      assert.equal(row.interface, "PagePreviewModule");
      assert.equal(row.wrapper.tag, "div");
      assert.equal(row.wrapper.class, "list-drafts-box");
      assert.ok(Array.isArray(row.rows));
      for (const item of row.rows) {
        assert.deepEqual(item.hierarchy, ["div.list-drafts-item", "p", "a"]);
        assert.equal(typeof item.href, "string");
        assert.equal(typeof item.text, "string");
      }
    }
  }

  assert.equal(artifact.saved_holder.interface, "saved-holder-anonymous-GET");
  assert.equal(artifact.saved_holder.http_status, 200);
  assert.equal(artifact.saved_holder.wrapper.tag, "div");
  assert.equal(artifact.saved_holder.wrapper.class, "list-drafts-box");
  assert.equal(artifact.saved_holder.saved_source, fixture.fixture.holder_source);

  assert.deepEqual(artifact.promoted_rules.map(({rule_id}) => rule_id), fixture.promoted_rule_contracts.map(({rule_id}) => rule_id));
  for (const [index, rule] of artifact.promoted_rules.entries()) {
    const declared = fixture.promoted_rule_contracts[index];
    assert.deepEqual(rule.positive_control_ids, declared.positive_control_ids);
    assert.deepEqual(rule.negative_control_ids, declared.negative_control_ids);
    assert.equal(rule.observations.length, 4);
    assert.equal(rule.observations.every(({passed}) => passed === true), true);
  }

  assert.equal(artifact.published_page_unchanged.source, fixture.fixture.published_source);
  assert.equal(artifact.published_page_unchanged.unchanged_during_drafts, true);
  assert.equal(artifact.nonexisting_page_absent.before_draft, true);
  assert.equal(artifact.nonexisting_page_absent.during_draft, true);
  assert.equal(artifact.nonexisting_page_absent.after_discard, true);
  assertCleanup(artifact, fixture, true);
});
