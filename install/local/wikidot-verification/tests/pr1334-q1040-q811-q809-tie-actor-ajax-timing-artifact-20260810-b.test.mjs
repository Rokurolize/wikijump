import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const fixtureUrl = new URL("../fixtures/pr1334-q1040-q811-q809-tie-actor-ajax-timing-20260810-b/cases.json", import.meta.url)
const artifactUrl = new URL("../artifacts/pr1334-q1040-q811-q809-tie-actor-ajax-timing-live-20260810-b.json", import.meta.url)
const scriptUrl = new URL("../scripts/capture-pr1334-q1040-q811-q809-tie-actor-ajax-timing-20260810-b.py", import.meta.url)
const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const legacyScriptSha256 = "7ebbc5e4189e9eb5861ef8603774d71c1d0a65af9d5720e7bafed37c1d2741e4"
const legacyFixtureSha256 = "cb123994c1d2db25377a8efc16afd3cf0f7bb3067cf9aca189dcbb487f9fdaff"

test("Q1040 Q811 Q809 evidence is bounded, source-independent, and non-closing", async () => {
  const fixtureBytes = await readFile(fixtureUrl)
  const scriptBytes = await readFile(scriptUrl)
  const fixture = JSON.parse(fixtureBytes)
  const artifactBytes = await readFile(artifactUrl)
  const artifact = JSON.parse(artifactBytes)

  assert.equal(artifact.schema, "wikijump.pr1334.q1040_q811_q809_tie_actor_ajax_timing_live.v1")
  assert.equal(artifact.lane_id, fixture.lane_id)
  assert.equal(artifact.base_commit, "f2b5769e1ff6206c31cc2b66a03675c64fba6318")
  assert.equal(artifact.base_tree, "7b9967ff145092f5c1c358c04128ee94929557a9")
  assert.deepEqual(artifact.claim_surface_ids, fixture.claim_surface_ids)
  assert.deepEqual(artifact.context_only_surface_ids, fixture.context_only_surface_ids)
  assert.deepEqual(artifact.audit_case_ids, fixture.audit_case_ids)
  assert.match(artifact.run_id, new RegExp(fixture.run_id_pattern))
  if (artifact.script_sha256 === legacyScriptSha256) assert.equal(artifact.run_namespace, `${fixture.run_namespace_prefix}${artifact.run_id}`)
  else assert.equal(artifact.run_namespace, `${fixture.run_namespace_prefix}${sha256(artifact.run_id).slice(0, 12)}`)
  assert.equal(artifact.site, fixture.site)
  assert.equal([legacyFixtureSha256, sha256(fixtureBytes)].includes(artifact.fixture_sha256), true)
  assert.equal([legacyScriptSha256, sha256(scriptBytes)].includes(artifact.script_sha256), true)
  assert.equal(artifact.closure_status, "non_closing_evidence")
  assert.ok(["complete", "partial", "blocked"].includes(artifact.capture_status))
  const expectedBudgets = { ...fixture.limits, ...(artifact.fixture_sha256 === legacyFixtureSha256 ? { minimum_interval_between_mutations_ms: 1000 } : {}) }
  assert.deepEqual(artifact.budgets, expectedBudgets)
  const actualKey = { total_wall_time_ms: "elapsed_ms" }
  for (const [key, limit] of Object.entries(fixture.limits)) {
    if (key.startsWith("max_") || key === "total_wall_time_ms") assert.ok(artifact.actual_usage[actualKey[key] ?? key.replace(/^max_/, "")] <= limit, key)
  }
  assert.ok(Buffer.byteLength(artifactBytes) <= fixture.limits.max_artifact_bytes)
  assert.equal(artifact.cleanup.live_state_debt, false)
  assert.equal(artifact.cleanup.proof_in_artifact, true)
  assert.equal(artifact.privacy.raw_authenticated_body_persisted, false)
  assert.deepEqual(artifact.privacy.forbidden_values_found, [])

  const knownCases = new Set(artifact.cases.map(({ id }) => id))
  for (const [rule, controls] of Object.entries(fixture.control_matrix)) {
    assert.equal(controls.positive.length, 2, `${rule} positive controls`)
    assert.equal(controls.negative.length, 2, `${rule} negative controls`)
  }
  for (const rule of artifact.claimed_rules) {
    assert.equal(rule.positive_case_ids.length >= 2, true, `${rule.id} positives`)
    assert.equal(rule.negative_case_ids.length >= 2, true, `${rule.id} negatives`)
    for (const id of [...rule.positive_case_ids, ...rule.negative_case_ids]) assert.equal(knownCases.has(id), true, `${rule.id}: ${id}`)
    assert.equal(rule.expected_value_source, "live_public_wikidot")
  }
  assert.equal(artifact.claimed_rules.some((rule) => /local|wikijump/i.test(rule.expected_value_source)), false)

  const serialized = JSON.stringify(artifact)
  for (const [label, pattern] of [
    ["session", /WIKIDOT_SESSION_ID/i], ["password", /password/i], ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
    ["cookie", /"cookie"\s*:/i], ["csrf", /"csrf(?:_token)?"\s*:/i], ["authorization", /"authorization"\s*:/i], ["login id", /"username"\s*:/i],
  ]) assert.equal(pattern.test(serialized), false, `artifact contains forbidden ${label}`)
})
