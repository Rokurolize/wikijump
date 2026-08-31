import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import test from "node:test"

const fixtureUrl = new URL("../fixtures/pr1334-a1061-cycle-cascade-20260810-c/cases.json", import.meta.url)
const artifactUrl = new URL("../artifacts/pr1334-a1061-cycle-cascade-live-20260810-c.json", import.meta.url)
const sha256 = (value) => createHash("sha256").update(value).digest("hex")

test("A1061 exact cycle evidence is bounded, public, reversible, and non-closing", async () => {
  const fixtureBytes = await readFile(fixtureUrl)
  const artifactBytes = await readFile(artifactUrl)
  const fixture = JSON.parse(fixtureBytes)
  const artifact = JSON.parse(artifactBytes)

  assert.equal(artifact.schema, "wikijump.pr1334.a1061_cycle_cascade_live.v1")
  assert.equal(artifact.lane_id, fixture.lane_id)
  assert.equal(artifact.base_commit, "f2b5769e1ff6206c31cc2b66a03675c64fba6318")
  assert.equal(artifact.base_tree, "7b9967ff145092f5c1c358c04128ee94929557a9")
  assert.deepEqual(artifact.claim_surface_ids, fixture.claim_surface_ids)
  assert.deepEqual(artifact.context_only_surface_ids, fixture.context_only_surface_ids)
  assert.deepEqual(artifact.audit_case_ids, fixture.audit_case_ids)
  assert.match(artifact.run_id, /^pr1334-c-a1061-cycle-[0-9]{8}t[0-9]{6}z-[a-z0-9]{6,12}$/)
  assert.equal(artifact.run_namespace, `codex-pr1334-c-cycle-${artifact.run_id}`)
  assert.equal(artifact.site, fixture.site)
  assert.equal(artifact.fixture_sha256, sha256(fixtureBytes))
  assert.equal(artifact.script_sha256, "5e4a7505a5865458c1becf4d2e4f3691d48286009b1169809275b7f3fec0e0e0")
  assert.equal(artifact.closure_status, "non_closing_evidence")
  assert.ok(["complete", "partial", "blocked"].includes(artifact.capture_status))
  assert.equal(artifact.budgets.max_total_requests, 112)
  assert.equal(artifact.budgets.max_mutation_requests, 40)
  assert.ok(artifact.actual_usage.total_requests <= artifact.budgets.max_total_requests)
  assert.ok(artifact.actual_usage.mutation_requests <= artifact.budgets.max_mutation_requests)
  assert.ok(artifact.actual_usage.response_body_bytes <= artifact.budgets.max_total_response_bytes)
  assert.ok(artifact.actual_usage.elapsed_ms <= artifact.budgets.total_wall_time_ms)
  assert.ok((await stat(artifactUrl)).size <= artifact.budgets.max_artifact_bytes)
  assert.equal(artifact.graph_contract.page_count, 8)
  assert.equal(artifact.graph_contract.cycle_length, 2)
  assert.equal(artifact.graph_contract.self_cycles, 0)
  assert.equal(artifact.graph_contract.cross_site_includes, 0)
  assert.equal(artifact.parent_ownership_graph.purpose, "run_ownership_and_cleanup_only")
  assert.equal(artifact.cleanup.live_state_debt, false)
  assert.equal(artifact.cleanup.run_marker_count_after_cleanup, 0)
  assert.equal(artifact.cleanup.namespace_lookup_count_after_cleanup, 0)
  assert.equal(artifact.cleanup.all_parent_links_cleared_before_delete, true)
  assert.equal(artifact.cleanup.all_include_edges_broken_before_delete, true)
  assert.equal(artifact.privacy.secret_scan, "pass")
  assert.deepEqual(artifact.privacy.forbidden_values_found, [])
  assert.equal(artifact.privacy.raw_authenticated_body_persisted, false)

  for (const [rule, controls] of Object.entries(fixture.control_matrix)) {
    assert.equal(controls.positive.length, 2, `${rule} requires two positive cases`)
    assert.equal(controls.negative.length, 2, `${rule} requires two negative cases`)
  }
  for (const rule of artifact.claimed_rules) {
    assert.notMatch(rule.id, /FINITE|STOPPING|DEDUPLICATION|DUPLICATE_EDGE/)
    assert.ok(rule.positive_case_ids.length >= 2)
    assert.ok(rule.negative_case_ids.length >= 2)
  }
  const blockedIds = new Set(artifact.blocked_rules.map((rule) => rule.id))
  if (!artifact.claimed_rules.some((rule) => rule.id === "C_R1_EXACT_CYCLE_TRAVERSAL_ORDER")) {
    assert.ok(blockedIds.has("C_R1_EXACT_CYCLE_TRAVERSAL_ORDER"))
  }
  if (!artifact.claimed_rules.some((rule) => rule.id === "C_R2_EXACT_CYCLE_TRAVERSAL_COUNT")) {
    assert.ok(blockedIds.has("C_R2_EXACT_CYCLE_TRAVERSAL_COUNT"))
  }

  const serialized = artifactBytes.toString("utf8")
  for (const [label, pattern] of [
    ["session cookie", /WIKIDOT_SESSION_ID/i],
    ["password", /password/i],
    ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
    ["cookie header", /\"cookie\"\s*:/i],
    ["csrf", /csrf/i],
    ["authorization", /authorization/i],
    ["lane D namespace", /codex-pr1334-d-cache-breadcrumb-/i],
  ]) {
    assert.equal(pattern.test(serialized), false, `artifact contains forbidden ${label}`)
  }
})
