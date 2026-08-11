import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const cases = JSON.parse(await readFile(new URL("fixtures/data-form-output-css-hostile-theme/cases.json", root), "utf8"));
const artifact = JSON.parse(await readFile(new URL("artifacts/data-form-output-css-hostile-theme-live-20260810.json", root), "utf8"));

const phases = [
  "create_form",
  "invalid_create",
  "valid_create_submission",
  "create_saved_source",
  "create_storage",
  "create_display",
  "edit_form",
  "invalid_edit",
  "valid_edit_submission",
  "edit_saved_source",
  "edit_storage",
  "edit_display",
  "reload",
  "authored_css_source",
  "emitted_css_fragment",
  "cleanup",
];

test("hostile-theme artifact has the exact public evidence identity", () => {
  assert.equal(artifact.schema, "wikidot.live.data-form.output-css-hostile-theme.v1");
  assert.equal(artifact.site, cases.site);
  assert.deepEqual(artifact.surface_ids, cases.surface_ids);
  assert.equal(artifact.actor_labels.mutation, "account-a");
  assert.equal(artifact.actor_labels.saved_page_read, "anonymous");
  assert.equal(artifact.credential_material, "none");
  assert.deepEqual(artifact.browser_computed_claims, []);
  assert.equal(artifact.hostile_css.source, cases.hostile_css_source);
  assert.match(artifact.hostile_css.sha256, /^[0-9a-f]{64}$/);
  assert.equal(artifact.cleanup.verified, true);
  assert.deepEqual(artifact.cleanup.remaining_pages, []);
});

test("hostile-theme artifact is complete and secret-free", () => {
  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /WIKIDOT_(?:USERNAME|PASSWORD|SESSION_ID)|wikidot_token7|lock_secret|csrf|(?:^|[\"_])email(?:[\"_]|$)/i);
  assert.ok(["observed", "blocked"].includes(artifact.status));
  if (artifact.status === "blocked") {
    assert.deepEqual(artifact.fixtures, []);
    assert.deepEqual(artifact.fixture_attempts.map(({fixture_id}) => fixture_id), cases.fixtures.map(({fixture_id}) => fixture_id));
    assert.equal(artifact.fixture_attempts[0].setup_progress.template_published, true);
    assert.equal(artifact.fixture_attempts[0].setup_progress.page_edit_module_requested, true);
    assert.equal(artifact.fixture_attempts[0].setup_progress.data_form_table_observed, false);
    assert.equal(artifact.fixture_attempts[0].setup_progress.valid_create_attempted, false);
    assert.equal(artifact.fixture_attempts[1].terminal_result, "not-started-after-first-fixture-blocker");
    assert.ok(artifact.cleanup.recovery_readback.every(({absence_verified}) => absence_verified === true));
    return;
  }
  assert.equal(artifact.fixtures.length, cases.fixtures.length);
  for (const expected of cases.fixtures) {
    const actual = artifact.fixtures.find(({fixture_id}) => fixture_id === expected.fixture_id);
    assert.ok(actual, `missing fixture ${expected.fixture_id}`);
    assert.equal(actual.template_source, expected.template_source);
    for (const phase of phases) assert.ok(Object.hasOwn(actual, phase), `${expected.fixture_id} missing ${phase}`);
    assert.equal(actual.authored_css_source, cases.hostile_css_source);
    assert.equal(actual.cleanup.absence_verified, true);
  }
});

test("observed evidence promotes only four-control server rules", () => {
  if (artifact.status === "blocked") {
    assert.deepEqual(artifact.promoted_rules, []);
    assert.equal(typeof artifact.blocked_reason, "string");
    assert.ok(artifact.blocked_reason.length > 0);
    assert.equal(typeof artifact.missing_authority, "string");
    assert.ok(artifact.missing_authority.length > 0);
    assert.ok(Array.isArray(artifact.attempted_public_routes));
    return;
  }

  assert.equal(artifact.blocked_reason, null);
  assert.equal(artifact.missing_authority, null);
  assert.ok(Array.isArray(artifact.server_dom_claims));
  assert.ok(artifact.server_dom_claims.length > 0);
  const requiredRuleIds = cases.rules.filter(({optional}) => !optional).map(({rule_id}) => rule_id);
  assert.deepEqual(artifact.promoted_rules.filter(({rule_id}) => requiredRuleIds.includes(rule_id)).map(({rule_id}) => rule_id), requiredRuleIds);
  for (const promoted of artifact.promoted_rules) {
    const expected = cases.rules.find(({rule_id}) => rule_id === promoted.rule_id);
    assert.ok(expected, `unknown rule ${promoted.rule_id}`);
    assert.deepEqual(promoted.controls.map(({case_id, polarity}) => ({case_id, polarity})), expected.controls);
    assert.equal(promoted.controls.filter(({polarity}) => polarity === "positive").length, 2);
    assert.equal(promoted.controls.filter(({polarity}) => polarity === "negative").length, 2);
    assert.ok(promoted.controls.every(({passed}) => passed === true));
  }
});
