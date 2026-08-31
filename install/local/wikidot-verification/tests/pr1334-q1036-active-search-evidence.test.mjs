import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const fixtureUrl = new URL("fixtures/pr1334-q1036-active-search-backend.json", root);
const artifactUrl = new URL("artifacts/pr1334-q1036-active-search-backend-20260810.json", root);

const fixtureBytes = await readFile(fixtureUrl);
const fixture = JSON.parse(fixtureBytes);
let artifactBytes;
try {
  artifactBytes = await readFile(artifactUrl);
} catch (error) {
  if (error?.code === "ENOENT") throw new Error("artifact_missing: run the bounded live capture");
  throw error;
}
const artifact = JSON.parse(artifactBytes);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const historicalCaptureScriptSha256 = "525cdbe3c4f824dcb87227d3fe4ca292c4171f029c10818cb0a974107dbac122";

const allowedHosts = new Set(["scp-wiki.wikidot.com", "www.wikidot.com"]);
const forbiddenSerialized = /(?:localhost|wikijump\.localhost|cookie|authorization|set-cookie|csrf|password|session[_-]?id)/i;

test("artifact has exact source identity and bounded public seams", () => {
  assert.equal(artifact.schema, "wikijump.pr1334.q1036_active_search_backend_live.v1");
  assert.equal(artifact.base_commit, fixture.base_commit);
  assert.deepEqual(artifact.feature_ids, fixture.feature_ids);
  assert.equal(artifact.audit_case_id, fixture.audit_case_id);
  assert.equal(artifact.fixture_sha256, sha256(fixtureBytes));
  assert.equal(artifact.capture_script_sha256, historicalCaptureScriptSha256);
  assert.deepEqual(artifact.budgets.limit, fixture.budgets);
  assert.ok(artifact.budgets.actual.requests <= fixture.budgets.max_requests);
  assert.ok(artifact.budgets.actual.aggregate_response_bytes <= fixture.budgets.max_aggregate_bytes);
  assert.equal(artifact.budgets.actual.mutations, 0);
  assert.ok(artifact.budgets.actual.wall_clock_seconds <= fixture.budgets.max_wall_clock_seconds);
  assert.equal(artifact.local_output_used, false);
  assert.equal(artifact.private_output_retained, false);
  assert.doesNotMatch(JSON.stringify(artifact), forbiddenSerialized);
  for (const attempt of artifact.attempts) {
    const url = new URL(attempt.request_url);
    assert.equal(url.protocol, "https:");
    assert.ok(allowedHosts.has(url.hostname));
    assert.equal(attempt.actor, "anonymous");
    assert.equal(attempt.method, "GET");
    assert.match(attempt.raw_body_sha256, /^[0-9a-f]{64}$/);
    assert.ok(attempt.response_bytes <= fixture.budgets.max_response_bytes);
    assert.ok(attempt.redirect_chain.length <= fixture.budgets.max_same_origin_redirects);
    assert.ok(attempt.redirect_chain.every((redirect) => new URL(redirect).hostname === url.hostname));
  }
});

test("artifact represents either complete observed evidence or an exact blocked canary", () => {
  assert.ok(["observed", "blocked"].includes(artifact.disposition));
  if (artifact.disposition === "blocked") {
    assert.ok(artifact.blocked_reasons.length > 0);
    assert.ok(artifact.blocked_reasons.every((reason) => fixture.allowed_blocked_reasons.includes(reason)));
    assert.deepEqual(
      artifact.attempts.map(({case_id}) => case_id),
      fixture.canary_cases.map(({case_id}) => case_id),
    );
    assert.ok(artifact.attempts.every(({result_rows}) => Array.isArray(result_rows) && result_rows.length === 0));
    assert.equal(artifact.full_matrix_started, false);
    assert.equal(artifact.claims.ranking, "unobserved");
    assert.equal(artifact.claims.counts, "unobserved");
    assert.equal(artifact.claims.pagination, "unobserved");
    assert.equal(artifact.claims.permission_filtering, "unobserved");
    assert.equal(artifact.cleanup.status, "not_needed");
    assert.equal(artifact.cleanup.mutated, false);
    return;
  }

  assert.equal(artifact.full_matrix_started, true);
  assert.equal(artifact.matrix.site.positive_queries.length, 2);
  assert.equal(artifact.matrix.site.negative_queries.length, 2);
  assert.equal(artifact.matrix.search_all.positive_queries.length, 2);
  assert.equal(artifact.matrix.search_all.negative_queries.length, 2);
  for (const attempt of artifact.attempts) {
    assert.ok(attempt.result_rows.length <= fixture.budgets.max_rows_per_response);
    for (const row of attempt.result_rows) {
      const url = new URL(row.url);
      assert.equal(url.protocol, "https:");
      assert.ok(!url.hostname.includes("wikijump"));
      assert.equal(row.public, true);
    }
  }
  assert.equal(artifact.matrix.site.stable_repeat, true);
  assert.equal(artifact.matrix.search_all.stable_repeat, true);
  assert.equal(artifact.matrix.site.page_two_observed, true);
  assert.equal(artifact.matrix.search_all.page_two_observed, true);
  assert.equal(artifact.actor_scope.search_all, "anonymous_only");
  assert.equal(artifact.actor_scope.private_behavior, "unobserved");
});

test("blocked evidence preserves exact known public errors without promoting search rules", () => {
  if (artifact.disposition !== "blocked") return;
  const unavailableAttempts = artifact.attempts.filter(({classification}) => classification === "backend_unavailable");
  assert.ok(unavailableAttempts.length > 0);
  for (const attempt of unavailableAttempts) {
    assert.equal(attempt.error_fragment, fixture.known_unavailable_errors[attempt.module]);
  }
  assert.deepEqual(artifact.promotable_rules, []);
  assert.match(artifact.remaining_gap, /ranking|pagination|result/i);
});
