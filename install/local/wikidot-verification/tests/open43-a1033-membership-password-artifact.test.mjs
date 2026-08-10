import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const casesPath = new URL("../fixtures/open43-a1033-membership-password/cases.json", import.meta.url);
const artifactPath = new URL("../artifacts/open43-a1033-membership-password-live-20260810.json", import.meta.url);

const expectedSurfaceIds = [
  "open43-audit-case:A1033_PASSWORD_SUBMISSION",
  "catalog-feature:module-membershipbypassword",
];

const forbiddenKeys = /^(?:password|password_value|submitted_password|cookie|cookies|csrf|token|lock|lock_secret|email|username|login_id|headers)$/i;

function collectForbiddenKeys(value, path = "artifact") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenKeys(item, `${path}[${index}]`));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(forbiddenKeys.test(key) ? [`${path}.${key}`] : []),
    ...collectForbiddenKeys(child, `${path}.${key}`),
  ]);
}

test("A1033 password-membership evidence is a complete observed or blocked terminal artifact", async () => {
  const fixture = JSON.parse(await readFile(casesPath, "utf8"));
  const artifactText = await readFile(artifactPath, "utf8");
  const artifact = JSON.parse(artifactText);

  assert.equal(fixture.schema, "wikijump.wikidot_membership_password_cases.v1");
  assert.deepEqual(fixture.target_surface_ids, expectedSurfaceIds);
  assert.equal(artifact.schema, "wikijump.wikidot_membership_password_evidence.v1");
  assert.deepEqual(artifact.target_surface_ids, expectedSurfaceIds);
  assert.match(artifact.captured_at_utc, /^2026-08-10T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  assert.match(artifact.fixture_sha256, /^[0-9a-f]{64}$/);
  assert.ok(["observed", "blocked"].includes(artifact.status));
  assert.equal(artifact.site_authority.account_store_check_schema, "wikidot.sandbox.accounts.check.v1");
  assert.equal(artifact.site_authority.catalog_schema, "wikidot.sandbox.catalog.v1");
  assert.deepEqual(artifact.actor_fixture_matrix.required_labels, fixture.required_actor_labels);
  assert.equal(artifact.bounded_failure_attempts.maximum_wrong_submissions_per_actor, 3);
  assert.ok(artifact.bounded_failure_attempts.actual_wrong_submissions_per_actor >= 0);
  assert.ok(artifact.bounded_failure_attempts.actual_wrong_submissions_per_actor <= 3);
  assert.equal(artifact.password_material_recorded, false);
  assert.equal(artifact.credentials_exposed, false);
  assert.deepEqual(collectForbiddenKeys(artifact), []);
  assert.doesNotMatch(artifactText, /WIKIDOT_SESSION_ID|wikidot_token7|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  if (artifact.status === "blocked") {
    assert.deepEqual(artifact.promoted_rules, []);
    assert.equal(artifact.membership_mutations_performed, 0);
    assert.equal(artifact.password_setting_mutations_performed, 0);
    assert.equal(artifact.holder_page_mutations_performed, 0);
    assert.equal(artifact.cleanup_receipt.status, "not_needed_no_mutation");
    assert.deepEqual(artifact.cleanup_receipt.remaining_run_owned_objects, []);
    assert.equal(artifact.settings_restoration_receipt.status, "not_needed_no_mutation");
    assert.equal(artifact.settings_restoration_receipt.baseline_changed, false);
    assert.ok(artifact.blocked_reason.length > 0);
    assert.ok(artifact.missing_authority.includes("explicitly-authorized-disposable-site"));
    assert.ok(artifact.preflight.every((entry) => ["satisfied", "missing", "not_evaluated_after_blocker"].includes(entry.status)));
    assert.ok(artifact.attempted_read_only_routes.length >= 2);
    assert.deepEqual(artifact.public_interfaces_used, []);
  } else {
    assert.equal(artifact.missing_authority, null);
    assert.equal(artifact.blocked_reason, null);
    assert.equal(artifact.promoted_rules.length, fixture.promotable_rules.length);
    for (const rule of artifact.promoted_rules) {
      assert.equal(rule.positive_case_ids.length, 2);
      assert.equal(rule.negative_case_ids.length, 2);
    }
    assert.equal(artifact.cleanup_receipt.status, "complete");
    assert.equal(artifact.settings_restoration_receipt.status, "restored_and_verified");
  }
});
