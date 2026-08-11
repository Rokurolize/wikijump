import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const fixtureUrl = new URL("../fixtures/pr1334-a1061-cache-a1063-breadcrumb-20260810-d/cases.json", import.meta.url)
const artifactUrl = new URL("../artifacts/pr1334-a1061-cache-a1063-breadcrumb-live-20260810-d.json", import.meta.url)
const scriptUrl = new URL("../scripts/capture-pr1334-a1061-cache-a1063-breadcrumb-20260810-d.py", import.meta.url)
const sha256 = (value) => createHash("sha256").update(value).digest("hex")

test("A1061 cache and A1063 breadcrumb evidence is public, bounded, and non-closing", async () => {
  const fixtureBytes = await readFile(fixtureUrl)
  const scriptBytes = await readFile(scriptUrl)
  const fixture = JSON.parse(fixtureBytes)
  const artifact = JSON.parse(await readFile(artifactUrl, "utf8"))

  assert.equal(artifact.schema, "wikijump.pr1334.a1061_cache_a1063_breadcrumb_live.v1")
  assert.equal(artifact.lane_id, fixture.lane_id)
  assert.equal(artifact.base_commit, "f2b5769e1ff6206c31cc2b66a03675c64fba6318")
  assert.equal(artifact.base_tree, "7b9967ff145092f5c1c358c04128ee94929557a9")
  assert.deepEqual(artifact.claim_surface_ids, fixture.claim_surface_ids)
  assert.deepEqual(artifact.context_only_surface_ids, fixture.context_only_surface_ids)
  assert.deepEqual(artifact.audit_case_ids, fixture.audit_case_ids)
  assert.equal(artifact.site, fixture.site)
  assert.match(artifact.run_id, new RegExp(fixture.run_id_pattern))
  assert.equal(artifact.run_namespace, `codex-pr1334-d-cache-breadcrumb-${artifact.run_id}`)
  assert.equal(artifact.fixture_sha256, sha256(fixtureBytes))
  assert.equal(artifact.script_sha256, sha256(scriptBytes))
  assert.equal(artifact.closure_status, "non_closing_evidence")
  assert.ok(["complete", "partial", "blocked"].includes(artifact.capture_status))
  assert.deepEqual(artifact.budgets, fixture.budgets)
  assert.ok(artifact.actual_usage.total_requests <= fixture.budgets.max_total_requests)
  assert.ok(artifact.actual_usage.mutation_requests <= fixture.budgets.max_mutation_requests)
  assert.ok(artifact.actual_usage.response_body_bytes <= fixture.budgets.max_total_response_bytes)
  assert.ok(artifact.actual_usage.artifact_bytes <= fixture.budgets.max_artifact_bytes)
  assert.ok(artifact.actual_usage.elapsed_ms <= fixture.budgets.total_wall_time_ms)
  assert.equal(artifact.setup_inventory.length <= fixture.budgets.max_live_pages, true)
  assert.equal(artifact.cleanup.live_state_debt, false)
  assert.equal(artifact.privacy.secret_scan, "pass")
  assert.equal(artifact.privacy.raw_authenticated_body_persisted, false)

  const executed = new Set(artifact.breadcrumb_cases.filter((entry) => entry.executed).map((entry) => entry.case_id))
  for (const claim of artifact.claimed_rules) {
    const controls = fixture.control_matrix[claim.rule_id]
    assert.ok(controls, `unknown claimed rule ${claim.rule_id}`)
    assert.ok(claim.positive_case_ids.length >= 2)
    assert.ok(claim.negative_case_ids.length >= 2)
    for (const caseId of [...claim.positive_case_ids, ...claim.negative_case_ids]) assert.ok(executed.has(caseId), `${caseId} was not executed`)
  }

  const pageLocal = artifact.claimed_rules.find((entry) => entry.rule_id === "D_R12_PAGE_LOCAL_CACHE_IDENTITY_AUTHORITY")
  assert.equal(pageLocal, undefined, "public observations must not be mapped directly to an internal page-local key")
  const serialized = JSON.stringify({ fixture, artifact })
  for (const [label, pattern] of [
    ["session value", /WIKIDOT_SESSION_ID=/i],
    ["password field", /"password"\s*:/i],
    ["email address", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
    ["raw cookie header", /"cookie"\s*:/i],
    ["csrf value", /"csrf(?:_token)?"\s*:/i],
    ["authorization header", /"authorization"\s*:/i],
    ["cache replacement requirement", /replace(?:ment)? of the site-wide fence/i],
  ]) assert.equal(pattern.test(serialized), false, `evidence contains forbidden ${label}`)
})
