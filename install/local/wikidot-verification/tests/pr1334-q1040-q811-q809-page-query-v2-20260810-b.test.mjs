import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const fixtureUrl = new URL("../fixtures/pr1334-q1040-q811-q809-page-query-v2-20260810-b/cases.json", import.meta.url)
const artifactUrl = new URL("../artifacts/pr1334-q1040-q811-q809-page-query-live-v2-20260810-b.json", import.meta.url)
const sha256 = (value) => createHash("sha256").update(value).digest("hex")

test("PR 1334 page-query v2 evidence is bounded, actor-labelled, and debt-free", async () => {
  const fixtureBytes = await readFile(fixtureUrl)
  const artifactBytes = await readFile(artifactUrl)
  const fixture = JSON.parse(fixtureBytes)
  const artifact = JSON.parse(artifactBytes)

  assert.equal(fixture.schema, "wikijump.pr1334.q1040_q811_q809_page_query_fixture.v2")
  assert.equal(artifact.schema, "wikijump.pr1334.q1040_q811_q809_page_query_live.v2")
  assert.equal(artifact.lane_id, fixture.lane_id)
  assert.equal(artifact.base_commit, fixture.base_commit)
  assert.equal(artifact.base_tree, fixture.base_tree)
  assert.equal(artifact.fixture_sha256, sha256(fixtureBytes))
  assert.equal(artifact.script_sha256, "d239d0fbe10decd039c4bc0c065e8f45324def5f60e208b9c492065862e1652e")
  assert.match(artifact.run_id, new RegExp(fixture.run_id_pattern))
  assert.equal(artifact.site, "sandbox-for-codex")
  assert.equal(artifact.environment.python_version, "3.12.3")
  assert.equal(artifact.environment.wikidot_version, "4.4.1")
  assert.match(artifact.environment.wikidot_package_origin, /^\/home\/roku\/\.devspace\/worktrees\/wikijump-3af0335e\/install\/local\/wikidot-verification\/\.venv\//)
  assert.equal(artifact.environment.interpreter, "/home/roku/.devspace/worktrees/wikijump-3af0335e/install/local/wikidot-verification/.venv/bin/python")

  const token = sha256(Buffer.from(artifact.run_id)).slice(0, fixture.short_names.token_length)
  assert.equal(artifact.name_plan.token, token)
  assert.equal(artifact.name_plan.common_prefix, `q${token}`)
  assert.equal(artifact.name_plan.target_category, `q${token}`)
  assert.equal(artifact.name_plan.pages.length, 10)
  assert.deepEqual(artifact.name_plan.pages.map(({ page_role }) => page_role), fixture.expected_create_order)
  const fullnames = artifact.name_plan.pages.map(({ fullname }) => fullname)
  assert.equal(new Set(fullnames).size, 10)
  for (const { fullname, category } of artifact.name_plan.pages) {
    assert.match(fullname, /^[a-z0-9-]+(?::[a-z0-9-]+)?$/)
    assert.ok(Buffer.byteLength(fullname, "ascii") <= fixture.short_names.max_fullname_bytes)
    assert.ok(fullname.split(":").length <= 2)
    assert.ok(Buffer.byteLength(category, "ascii") <= fixture.short_names.max_category_bytes)
    assert.equal(/codex-pr1334-b-pagequery-|pr1334-c|pr1334-d/.test(fullname), false)
  }
  const targetNames = artifact.name_plan.pages.filter(({ category }) => category === artifact.name_plan.target_category).map(({ fullname }) => fullname)
  const observerNames = artifact.name_plan.pages.filter(({ page_role }) => page_role.startsWith("observer_")).map(({ fullname }) => fullname)
  for (const target of targetNames) for (const observer of observerNames) assert.notEqual(target, observer)

  assert.equal(artifact.authority_preflight.roles.length, 5)
  assert.deepEqual(artifact.authority_preflight.roles.map(({ actor_label }) => actor_label), ["A", "B", "C", "D", "E"])
  for (const role of artifact.authority_preflight.roles) {
    assert.deepEqual(Object.keys(role).sort(), ["actor_label", "authenticated", "is_admin", "is_member", "is_moderator"])
    assert.match(role.actor_label, /^[A-E]$/)
    for (const key of ["authenticated", "is_admin", "is_member", "is_moderator"]) assert.equal(typeof role[key], "boolean")
  }
  assert.deepEqual(artifact.authority_preflight.operation_capabilities, { cancel_vote: true, create: true, destroy: true, source_readback: true, vote: true })
  assert.equal(artifact.authority_preflight.inverse_count, 19)
  assert.equal(artifact.authority_preflight.inverse_count <= fixture.limits.cleanup_mutation_reserve, true)
  assert.equal(artifact.authority_preflight.rating_settings_changed, false)

  const selected = artifact.authority_preflight.selected_actors
  if (Object.keys(selected).length > 0) {
    assert.match(selected.creator, /^[A-E]$/)
    assert.match(selected.voter_1, /^[A-E]$/)
    assert.match(selected.voter_2, /^[A-E]$/)
    assert.notEqual(selected.voter_1, selected.voter_2)
    const roleByLabel = new Map(artifact.authority_preflight.roles.map((row) => [row.actor_label, row]))
    assert.equal(roleByLabel.get(selected.creator).is_admin, true)
    assert.equal(roleByLabel.get(selected.voter_1).authenticated, true)
    assert.equal(roleByLabel.get(selected.voter_2).authenticated, true)
  }

  const checkAbsence = (rows) => {
    assert.equal(rows.length, 10)
    for (const row of rows) {
      assert.equal(row.anonymous.exact_search_count, 0)
      assert.notEqual(row.anonymous.public_status, 301)
      assert.equal(row.anonymous.marker_present, false)
      assert.equal(row.anonymous.absent, true)
      assert.ok(["not_found", "credential_redirect_refusal"].includes(row.authenticated.classification))
      if (row.authenticated.classification === "credential_redirect_refusal") assert.equal(row.authenticated.message_prefix_matched, true)
      assert.equal(row.authenticated.absent, true)
    }
  }
  checkAbsence(artifact.authority_preflight.absence)

  assert.deepEqual(artifact.deferred_rules, [
    "B_R2_RATEDPAGES_UNRATED_INCLUSION",
    "B_R5_ACTOR_SCOPED_ADJACENCY",
    "B_R6_EXACT_AJAX_CONTEXT",
    "B_R8_TIMING_EQUIVALENCE_BOUNDARY",
  ])
  assert.deepEqual(artifact.budgets, fixture.limits)
  assert.ok(artifact.actual_usage.total_requests <= fixture.limits.max_total_requests)
  assert.ok(artifact.actual_usage.mutation_requests <= fixture.limits.max_mutation_requests)
  assert.ok(artifact.actual_usage.ordinary_mutations <= fixture.limits.max_mutation_requests - fixture.limits.cleanup_mutation_reserve)
  assert.ok(artifact.actual_usage.cleanup_mutations <= fixture.limits.cleanup_mutation_reserve)
  assert.ok(artifact.actual_usage.concurrent_read_requests <= fixture.limits.max_concurrent_read_requests)
  assert.ok(artifact.actual_usage.request_body_bytes <= fixture.limits.max_request_body_bytes)
  assert.ok(artifact.actual_usage.response_body_bytes_per_request <= fixture.limits.max_response_body_bytes_per_request)
  assert.ok(artifact.actual_usage.total_response_bytes <= fixture.limits.max_total_response_bytes)
  assert.ok(artifact.actual_usage.persisted_fragment_bytes_per_case <= fixture.limits.max_persisted_fragment_bytes_per_case)
  assert.ok(artifact.actual_usage.elapsed_ms <= fixture.limits.total_wall_time_ms)
  assert.equal(artifact.actual_usage.artifact_bytes, artifactBytes.length)
  assert.ok(artifactBytes.length <= fixture.limits.max_artifact_bytes)

  assert.equal(artifact.cleanup.live_state_debt, false)
  assert.deepEqual(artifact.cleanup.errors, [])
  assert.equal(artifact.privacy.actor_labels_only, true)
  assert.equal(artifact.privacy.raw_authenticated_body_persisted, false)
  assert.equal(artifact.privacy.secret_scan, "pass")
  assert.deepEqual(artifact.privacy.forbidden_values_found, [])

  if (artifact.capture_status === "complete") {
    assert.equal(artifact.failure, null)
    assert.equal(artifact.authority_preflight.status, "passed")
    assert.equal(artifact.setup_inventory.length, 10)
    assert.deepEqual(artifact.setup_inventory.map(({ page_role }) => page_role), fixture.expected_create_order)
    assert.deepEqual(artifact.setup_inventory.map(({ create_ordinal }) => create_ordinal), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.equal(new Set(artifact.setup_inventory.map(({ page_id }) => page_id)).size, 10)
    for (const row of artifact.setup_inventory) {
      assert.equal(row.requested_fullname, row.returned_fullname)
      assert.equal(row.identity_exact, true)
      assert.ok(Number.isSafeInteger(row.page_id) && row.page_id > 0)
    }
    assert.ok(artifact.setup_inventory.findIndex(({ page_role }) => page_role === "tie_a_2") < artifact.setup_inventory.findIndex(({ page_role }) => page_role === "tie_a_1"))
    assert.ok(artifact.setup_inventory.findIndex(({ page_role }) => page_role === "tie_b_1") < artifact.setup_inventory.findIndex(({ page_role }) => page_role === "tie_b_2"))

    const expectedVotes = fixture.vote_plan.map((row, index) => ({
      mutation_id: `vote-${index + 1}`,
      page_role: row.page_role,
      actor_label: selected[row.actor_slot],
      actor_slot: row.actor_slot,
      value: row.value,
    }))
    assert.deepEqual(artifact.vote_plan, expectedVotes)
    const scoreByRole = new Map(artifact.score_readback.map((row) => [row.page_role, row]))
    assert.equal(scoreByRole.size, 6)
    for (const [role, score] of Object.entries(fixture.expected_scores)) assert.equal(scoreByRole.get(role).score, score)
    for (const row of artifact.score_readback) {
      const expectedActorVotes = expectedVotes.filter((vote) => vote.page_role === row.page_role).map(({ actor_label, value }) => ({ actor_label, value })).sort((a, b) => a.actor_label.localeCompare(b.actor_label) || a.value - b.value)
      assert.deepEqual(row.actor_votes, expectedActorVotes)
      assert.equal(row.vote_count, expectedActorVotes.length)
    }

    const finalObservers = artifact.rated_observers.filter(({ first_read }) => !first_read)
    assert.equal(finalObservers.length, 2)
    for (const observer of finalObservers) {
      assert.equal(observer.http_status, 200)
      const rows = observer.rows.map((row) => ({ fullname: row.links[0].fullname, score: row.score }))
      assert.equal(rows.length, 6)
      assert.deepEqual(new Set(rows.map(({ fullname }) => fullname)), new Set(targetNames))
      for (const row of rows) {
        const role = artifact.name_plan.pages.find(({ fullname }) => fullname === row.fullname).page_role
        assert.equal(row.score, fixture.expected_scores[role])
      }
    }
    assert.deepEqual(finalObservers[0].rows, finalObservers[1].rows)

    assert.equal(artifact.directional_matrix.length, 6)
    assert.deepEqual(new Set(artifact.directional_matrix.map(({ page_role }) => page_role)), new Set(Object.keys(fixture.expected_scores)))
    for (const row of artifact.directional_matrix) {
      assert.equal(row.http_status, 200)
      assert.ok(row.next.rows.length <= 1)
      assert.ok(row.previous.rows.length <= 1)
      for (const direction of [row.next, row.previous]) for (const semanticRow of direction.rows) assert.equal(targetNames.includes(semanticRow.links[0].fullname), true)
    }

    assert.equal(artifact.request_sequence.length, 8)
    for (const offset of [0, 4]) {
      const [before, mutation, firstRead, after] = artifact.request_sequence.slice(offset, offset + 4)
      assert.deepEqual([before.kind, mutation.kind, firstRead.kind, after.kind], ["unrelated_control_before", "vote_mutation", "observer_first_read", "unrelated_control_after"])
      assert.equal(firstRead.sequence, mutation.sequence + 1)
      assert.equal(before.page_role, after.page_role)
      assert.equal(before.semantic_sha256, after.semantic_sha256)
      assert.equal(before.http_status, 200)
      assert.equal(firstRead.http_status, 200)
      assert.equal(after.http_status, 200)
    }

    assert.equal(artifact.claimed_rules.length, 4)
    const knownCases = new Set(artifact.cases.filter(({ status }) => status === "executed").map(({ id }) => id))
    for (const [ruleId, controls] of Object.entries(fixture.claim_matrix)) {
      const claim = artifact.claimed_rules.find(({ id }) => id === ruleId)
      assert.ok(claim)
      assert.equal(claim.expected_value_source, "live_public_wikidot")
      assert.deepEqual(claim.positive_case_ids, controls.positive)
      assert.deepEqual(claim.negative_case_ids, controls.negative)
      for (const caseId of [...claim.positive_case_ids, ...claim.negative_case_ids]) assert.equal(knownCases.has(caseId), true)
    }
    const r1 = artifact.claimed_rules.find(({ id }) => id === "B_R1_RATEDPAGES_EQUAL_SCORE_ORDER")
    assert.match(r1.observation.inference_boundary, /no universal hidden discriminator inferred/)
    const r7 = artifact.claimed_rules.find(({ id }) => id === "B_R7_REQUEST_TIME_FIRST_READ")
    assert.equal(r7.observation.scope, "ordinary public request order only")
    assert.equal(r7.observation.latency_equivalence_claimed, false)
    assert.equal(r7.observation.browser_or_internal_cache_claimed, false)

    assert.equal(artifact.cleanup.status, "verified")
    assert.equal(artifact.cleanup.actions.filter(({ action }) => action === "cancel_vote").length, 9)
    assert.equal(artifact.cleanup.actions.filter(({ action }) => action === "destroy_page").length, 10)
    assert.equal(artifact.cleanup.cancellation_readback.length, 6)
    assert.equal(artifact.cleanup.cancellation_readback.every(({ score, vote_count }) => score === 0 && vote_count === 0), true)
    checkAbsence(artifact.cleanup.absence)
    assert.deepEqual(artifact.cleanup.search, { common_prefix_count: 0, run_marker_count: 0, target_category_count: 0 })
  } else {
    assert.equal(artifact.capture_status, "blocked")
    assert.deepEqual(artifact.claimed_rules, [])
    if (artifact.setup_inventory.length === 0) assert.equal(artifact.cleanup.status, "not_started_blocked")
    else assert.equal(artifact.cleanup.status, "verified")
  }

  const serialized = JSON.stringify(artifact)
  for (const [label, pattern] of [
    ["session", /WIKIDOT_SESSION_ID/i],
    ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
    ["cookie", /"cookie"\s*:/i],
    ["csrf", /"csrf(?:_token)?"\s*:/i],
    ["authorization", /"authorization"\s*:/i],
    ["login id", /"username"\s*:/i],
  ]) assert.equal(pattern.test(serialized), false, `artifact contains forbidden ${label}`)
})
