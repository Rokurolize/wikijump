import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fixturePath = path.join(root, "fixtures/pr1334-q1032-whoinvited-populated.json");
const artifactPath = path.join(root, "artifacts/pr1334-q1032-whoinvited-populated-20260810.json");
const capturePath = path.join(root, "scripts/capture_pr1334_q1032_whoinvited.py");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Q1032 WhoInvited evidence is bounded and machine-auditable", () => {
  let artifactBytes;
  try {
    artifactBytes = readFileSync(artifactPath);
  } catch (error) {
    assert.fail(`artifact_missing: ${error.code}`);
  }

  const fixtureBytes = readFileSync(fixturePath);
  const captureBytes = readFileSync(capturePath);
  const fixture = JSON.parse(fixtureBytes);
  const artifact = JSON.parse(artifactBytes);

  assert.equal(artifact.schema, "wikijump.pr1334.q1032_whoinvited_populated_live.v1");
  assert.equal(artifact.base_commit, "898e57da57c964893380a44e8b9b7765f274351c");
  assert.equal(artifact.feature_id, "module-whoinvited");
  assert.equal(artifact.surface_id, "catalog-feature:module-whoinvited");
  assert.equal(artifact.residual_id, "Q1032_REMAINING_DIRECTORY_RUNTIME");
  assert.equal(artifact.fixture_sha256, sha256(fixtureBytes));
  assert.equal(artifact.capture_script_sha256, sha256(captureBytes));
  assert.ok(["observed", "blocked"].includes(artifact.disposition));
  assert.deepEqual(artifact.identity_matrix.positive_roles, fixture.positive_roles);
  assert.deepEqual(artifact.identity_matrix.negative_roles, fixture.negative_roles);
  assert.equal(artifact.public_seams.quickmodule.module, "MemberLookupQModule");
  assert.equal(artifact.public_seams.results_amc.module_name, "wiki/invitations/WhoInvitedResultsModule");
  assert.equal(artifact.live_script.contains_member_lookup, true);
  assert.equal(artifact.live_script.contains_results_module, true);
  assert.match(artifact.live_script.sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.page_preview.raw_response_sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.page_preview.body_sha256, /^[0-9a-f]{64}$/);
  assert.equal(artifact.page_preview.form_present, true);
  assert.equal(artifact.page_preview.status, "ok");
  assert.ok(artifact.budgets.actual_http_requests <= fixture.budgets.maximum_http_requests);
  assert.equal(artifact.budgets.actual_state_changing_requests, 0);
  assert.ok(artifact.budgets.maximum_response_bytes === fixture.budgets.maximum_response_bytes);
  assert.ok(artifact.budgets.maximum_retained_bytes === fixture.budgets.maximum_retained_bytes);
  assert.equal(artifact.privacy.secret_scan_matches, 0);
  assert.equal(artifact.privacy.non_run_owned_identity_bodies_persisted, 0);
  assert.equal(artifact.local_wikijump_output_used, false);

  if (artifact.disposition === "blocked") {
    const allowed = new Set([
      "missing_public_invitation_create",
      "missing_public_invitation_accept",
      "missing_public_invitation_cleanup",
      "invitation_history_not_reversible",
      "insufficient_run_owned_identities",
      "lookup_seam_drift",
      "sandbox_authority_not_run_owned",
      "response_budget_exceeded",
    ]);
    assert.ok(artifact.blocked_reasons.length > 0);
    assert.ok(artifact.blocked_reasons.every((reason) => allowed.has(reason)));
    assert.equal(artifact.mutated, false);
    assert.equal(artifact.mutation_count, 0);
    assert.equal(artifact.cleanup.status, "not_needed");
    assert.equal(artifact.matrix_results.executed, false);
  } else {
    assert.equal(artifact.cleanup.status, "verified");
    assert.equal(artifact.matrix_results.executed, true);
    assert.deepEqual(artifact.matrix_results.completed_roles, [...fixture.positive_roles, ...fixture.negative_roles]);
  }

  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["Authorization", "Set-Cookie", "WIKIDOT_SESSION_ID", "csrf_token"]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden artifact field: ${forbidden}`);
  }
  assert.equal(artifact.rule_boundaries.initial_form_authorizes_invitation_mutation, false);
  assert.equal(artifact.rule_boundaries.local_invitation_design_authorized, false);
});
