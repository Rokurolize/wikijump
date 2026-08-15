import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const contract = JSON.parse(fs.readFileSync(path.join(root, "docs/development/wikidot-py-amc-write-surface.json"), "utf8"))
const plan = JSON.parse(fs.readFileSync(new URL("../fixtures/issue1373-amc-write-evidence-run-plan.json", import.meta.url), "utf8"))
const evidencePath = path.join(root, plan.evidence.path)
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"))

const unresolvedRows = contract.authenticated_behavior_evidence.pair_evidence
  .filter(({ classification }) => classification !== "positive")
  .map(({ pair_id, classification }) => ({ pair_id, current_classification: classification }))
  .sort((left, right) => left.pair_id.localeCompare(right.pair_id))
const expectedEvidencePairs = unresolvedRows
  .map(({ pair_id, current_classification: classification }) => ({ pair_id, classification }))
const expectedPageEditControls = [
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

const sha256 = filePath => createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")

const verifyPartialEvidence = value => {
  assert.equal(value.schema, "wikijump.issue1373.pageedit_live_controls.v2")
  assert.equal(value.issue, 1373)
  assert.equal(value.classification, "partial")
  assert.deepEqual(
    value.remaining_action_event_pairs
      .map(({ pair_id, classification }) => ({ pair_id, classification }))
      .sort((left, right) => left.pair_id.localeCompare(right.pair_id)),
    expectedEvidencePairs
  )
  const pairIds = value.remaining_action_event_pairs.map(({ pair_id }) => pair_id)
  assert.equal(new Set(pairIds).size, pairIds.length)
  assert.deepEqual(value.page_edit_controls.map(({ control_id }) => control_id).sort(), expectedPageEditControls)
  const controlIds = value.page_edit_controls.map(({ control_id }) => control_id)
  assert.equal(new Set(controlIds).size, controlIds.length)
  for (const control of value.page_edit_controls) {
    assert.ok(["observed", "not_observed"].includes(control.classification))
    if (control.classification === "observed") {
      assert.ok(value.records.some(({ case_id }) => case_id === control.record_case_id))
    } else {
      assert.equal(control.record_case_id, undefined)
    }
  }
}

test("issue #1373 run plan stays source-bound and partial", () => {
  assert.equal(plan.schema, "wikijump.issue1373_amc_write_evidence_run_plan.v2")
  assert.equal(plan.issue, 1373)
  assert.equal(plan.execution_authorized, undefined)
  assert.equal(plan.authority, undefined)
  assert.deepEqual(plan.source, {
    repository: "Rokurolize/wikidot.py",
    commit: contract.source.commit,
    tree: contract.authenticated_behavior_evidence.client.tree,
    contract_path: "docs/development/wikidot-py-amc-write-surface.json",
    contract_sha256: "cc77d68ab2226bf944fd08fa6171034de9883558759ec92b10072f86e805b183"
  })
  assert.equal(path.isAbsolute(plan.evidence.path), false)
  assert.equal(plan.evidence.classification, "partial")
  assert.equal(plan.evidence.sha256, sha256(evidencePath))
  assert.equal(sha256(path.join(root, plan.source.contract_path)), plan.source.contract_sha256)
  assert.equal(path.isAbsolute(evidence.source_identity.contract.path), false)
  assert.deepEqual(evidence.source_identity.contract, {
    path: plan.source.contract_path,
    sha256: plan.source.contract_sha256,
    schema: contract.schema
  })
  assert.equal(evidence.source_identity.client.commit, plan.source.commit)
  assert.equal(evidence.source_identity.client.tree, plan.source.tree)
  verifyPartialEvidence(evidence)

  const plannedRows = plan.action_event_cases
    .flatMap(({ cases }) => cases)
    .map(({ pair_id, current_classification }) => ({ pair_id, current_classification }))
    .sort((left, right) => left.pair_id.localeCompare(right.pair_id))
  assert.equal(unresolvedRows.length, 12)
  assert.deepEqual(plannedRows, unresolvedRows)
  assert.equal(new Set(plannedRows.map(({ pair_id }) => pair_id)).size, plannedRows.length)
  assert.deepEqual(plan.page_edit_controls.map(({ control_id }) => control_id).sort(), expectedPageEditControls)
  assert.equal(new Set(plan.page_edit_controls.map(({ control_id }) => control_id)).size, expectedPageEditControls.length)

  for (const group of [...plan.action_event_cases, ...plan.page_edit_controls]) {
    assert.ok(group.cleanup_fact.length > 0)
  }

  const forbiddenKeys = new Set([
    "username",
    "password",
    "cookie",
    "cookies",
    "lock_secret",
    "wikidot_token7",
    "authority",
    "required_authority",
    "execution_authorized",
    "actors"
  ])
  const inspect = value => {
    if (Array.isArray(value)) return value.forEach(inspect)
    if (value === null || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, key)
      inspect(child)
    }
  }
  inspect(plan)
  inspect(evidence)
})

test("issue #1373 evidence rejects omitted and duplicate result controls", () => {
  for (const field of ["remaining_action_event_pairs", "page_edit_controls"]) {
    const omitted = structuredClone(evidence)
    omitted[field].pop()
    assert.throws(() => verifyPartialEvidence(omitted))

    const duplicated = structuredClone(evidence)
    duplicated[field].push(duplicated[field][0])
    assert.throws(() => verifyPartialEvidence(duplicated))
  }
})
