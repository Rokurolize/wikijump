import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, stat} from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../fixtures/pr1334-q1034-q778-actor-deletion-20260810-a/cases.json", import.meta.url);
const artifactUrl = new URL("../artifacts/pr1334-q1034-q778-actor-deletion-live-20260810-a.json", import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const expectedRules = [
  "A_R1_ACTOR_VISIBILITY",
  "A_R2_POST_CREATE_EDIT_AUTHORITY",
  "A_R3_DELETE_VISIBILITY_TRANSITION",
  "A_R4_RESTORE_OR_TERMINAL_DELETE",
  "A_R5_MINI_AND_RECENT_MODULE_REFRESH",
  "A_R6_IMPORTED_AND_DELETED_USER_PRESENTATION",
  "A_R7_FIRST_READ_AND_BOUNDED_CONCURRENCY",
];

test("Q1034 and Q778 actor deletion evidence is bounded, private, and authority gated", async () => {
  const fixtureBytes = await readFile(fixtureUrl);
  const artifactBytes = await readFile(artifactUrl);
  const fixture = JSON.parse(fixtureBytes);
  const artifact = JSON.parse(artifactBytes);

  assert.equal(fixture.schema, "wikijump.pr1334.q1034_q778_actor_deletion_cases.v1");
  assert.equal(artifact.schema, "wikijump.pr1334.q1034_q778_actor_deletion_live.v1");
  for (const field of ["lane_id", "base_commit", "base_tree", "claim_surface_ids", "context_only_surface_ids", "audit_case_ids", "site", "budgets"]) {
    assert.deepEqual(artifact[field], fixture[field]);
  }
  assert.match(artifact.run_id, new RegExp(fixture.run_id_pattern, "u"));
  assert.equal(artifact.run_namespace, `codex-pr1334-a-forum-${artifact.run_id}`);
  assert.equal(artifact.fixture_sha256, sha256(fixtureBytes));
  assert.equal(artifact.script_sha256, "cea9ca2b789cac5a5536ef14cb5b9445b52a68e935e01b6232d351297783f2dd");
  assert.equal(artifact.capture_status, "blocked");
  assert.equal(artifact.closure_status, "non_closing_evidence");
  assert.equal(artifact.authority_preflight.status, "blocked");
  assert.ok(artifact.authority_preflight.missing.includes("exact_delete_operation_and_success_envelope_known"));
  assert.ok(artifact.authority_preflight.missing.includes("public_cleanup_for_every_created_object"));

  assert.deepEqual(Object.keys(fixture.control_matrix), expectedRules);
  const executed = new Set(artifact.cases.map(({case_id}) => case_id));
  for (const rule of artifact.claimed_rules) {
    assert.ok(expectedRules.includes(rule.rule_id));
    assert.ok(rule.positive_case_ids.length >= 2);
    assert.ok(rule.negative_case_ids.length >= 2);
    for (const caseId of [...rule.positive_case_ids, ...rule.negative_case_ids]) assert.ok(executed.has(caseId));
    for (const field of ["statement", "public_interface", "varied_boundary", "evidence_fields"]) assert.ok(rule[field]);
  }
  assert.deepEqual(artifact.claimed_rules, []);
  assert.deepEqual(artifact.blocked_rules.map(({rule_id}) => rule_id), expectedRules);

  const usage = artifact.actual_usage;
  const limits = artifact.budgets;
  assert.ok(usage.total_requests <= limits.max_total_requests);
  assert.ok(usage.mutation_requests <= limits.max_mutation_requests - limits.cleanup_mutation_reserve);
  assert.ok(usage.request_body_bytes <= limits.max_request_body_bytes);
  assert.ok(usage.response_body_bytes <= limits.max_total_response_bytes);
  assert.ok(usage.max_concurrent_read_requests <= limits.max_concurrent_read_requests);
  assert.ok(usage.elapsed_ms <= limits.total_wall_time_ms);
  assert.ok(artifactBytes.byteLength <= limits.max_artifact_bytes);
  assert.equal(usage.artifact_bytes, artifactBytes.byteLength);

  assert.deepEqual(artifact.setup_inventory, []);
  assert.deepEqual(artifact.cleanup.action_inventory, []);
  assert.equal(artifact.cleanup.status, "not_started_blocked");
  assert.equal(artifact.cleanup.mutation_started, false);
  assert.equal(artifact.cleanup.run_marker_count_after_cleanup, 0);
  assert.equal(artifact.cleanup.live_state_debt, false);
  assert.equal(artifact.cleanup.page_absence, true);
  assert.equal(artifact.cleanup.thread_absence, true);
  assert.equal(artifact.cleanup.post_absence, true);
  assert.equal(artifact.privacy.raw_authenticated_body_persisted, false);
  assert.deepEqual(artifact.privacy.forbidden_values_found, []);
  assert.equal((await stat(artifactUrl)).size, artifactBytes.byteLength);

  const serialized = `${fixtureBytes.toString("utf8")}\n${artifactBytes.toString("utf8")}`;
  const forbidden = [
    ["session cookie", /WIKIDOT_SESSION_ID\s*[=:]/iu],
    ["password field", /"password"\s*:/iu],
    ["email address", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu],
    ["cookie header", /"cookie"\s*:/iu],
    ["authorization header", /"authorization"\s*:/iu],
    ["csrf field", /"(?:csrf|wikidot_token7)"\s*:/iu],
    ["edit lock field", /"(?:edit[_-]?lock|lock[_-]?id)"\s*:/iu],
  ];
  for (const [label, pattern] of forbidden) assert.equal(pattern.test(serialized), false, `found forbidden ${label}`);
});
