import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const contract = JSON.parse(fs.readFileSync(path.join(root, "docs/development/wikidot-py-amc-write-surface.json"), "utf8"))
const plan = JSON.parse(fs.readFileSync(new URL("../fixtures/issue1373-amc-write-evidence-run-plan.json", import.meta.url), "utf8"))

test("issue #1373 run plan stays source-bound, complete, and disabled", () => {
  assert.equal(plan.schema, "wikijump.issue1373_amc_write_evidence_run_plan.v1")
  assert.equal(plan.issue, 1373)
  assert.equal(plan.execution_authorized, false)
  assert.deepEqual(plan.source, {
    repository: "Rokurolize/wikidot.py",
    commit: contract.source.commit,
    tree: contract.authenticated_behavior_evidence.client.tree,
    contract_path: "docs/development/wikidot-py-amc-write-surface.json",
    contract_sha256: "cc77d68ab2226bf944fd08fa6171034de9883558759ec92b10072f86e805b183"
  })
  assert.deepEqual(plan.authority, {
    state_path: "/home/roku/wjlab/state/current.json",
    state_sha256: "1781ccb83d816e96e5f59eb1dd0cec54302ce7dd7ebbe4e9a561cb24f3f45617",
    phase: "BUILDING",
    status: "blocked",
    reason: "The current state does not authorize authenticated Wikidot work, sandbox mutation, or authority changes."
  })

  const unresolvedRows = contract.authenticated_behavior_evidence.pair_evidence
    .filter(({ classification }) => classification !== "positive")
    .map(({ pair_id, classification }) => ({ pair_id, current_classification: classification }))
    .sort((left, right) => left.pair_id.localeCompare(right.pair_id))
  const plannedRows = plan.action_event_cases
    .flatMap(({ cases }) => cases)
    .map(({ pair_id, current_classification }) => ({ pair_id, current_classification }))
    .sort((left, right) => left.pair_id.localeCompare(right.pair_id))
  assert.deepEqual(plannedRows, unresolvedRows)
  assert.equal(new Set(plannedRows.map(({ pair_id }) => pair_id)).size, plannedRows.length)

  const expectedPageEditCases = [
    "cancellation_release",
    "expiry_release",
    "other_locks",
    "role_boundaries",
    "save_conflict",
    "save_failure",
    "save_noop",
    "stale_lock",
    "wrong_lock"
  ]
  assert.deepEqual(plan.page_edit_cases.map(({ case_id }) => case_id).sort(), expectedPageEditCases)

  for (const group of [...plan.action_event_cases, ...plan.page_edit_cases]) {
    assert.ok(group.required_authority.length > 0)
    assert.ok(group.cleanup_proof.length > 0)
  }

  const forbiddenKeys = new Set(["username", "password", "cookie", "cookies", "lock_secret", "wikidot_token7"])
  const inspect = value => {
    if (Array.isArray(value)) return value.forEach(inspect)
    if (value === null || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, key)
      inspect(child)
    }
  }
  inspect(plan)
})
