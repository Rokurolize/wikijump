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
const relativePath = value => {
  assert.equal(typeof value, "string")
  assert.equal(path.isAbsolute(value), false, value)
  assert.equal(value.includes(".."), false, value)
  return value
}
const fileSha256 = value => sha256(path.join(root, relativePath(value)))

const verifyIdentityBindings = (planValue, evidenceValue) => {
  assert.equal(planValue.schema, "wikijump.issue1373_amc_write_evidence_run_plan.v3")
  assert.deepEqual(planValue.execution, { enabled: false, mode: "static" })
  assert.deepEqual(planValue.run_safety, {
    authority_gate: "safety_only",
    cleanup_gate: "required_before_live_execution"
  })
  assert.equal(planValue.source.repository, contract.source.repository)
  assert.equal(planValue.source.commit, contract.source.commit)
  assert.equal(planValue.source.commit, contract.authenticated_behavior_evidence.current_source_commit)
  assert.equal(planValue.source.tree, contract.authenticated_behavior_evidence.client.tree)
  assert.deepEqual(planValue.source.client_lock, {
    path: "uv.lock",
    repository: "Rokurolize/wikidot.py",
    sha256: contract.authenticated_behavior_evidence.client.uv_lock_sha256
  })

  const pinnedFiles = planValue.source.pinned_files
  assert.deepEqual(pinnedFiles, {
    requirements: {
      path: "install/local/wikidot-verification/requirements.txt",
      sha256: "456c74d295e7de9265cbd6a088c285b1739f84902c65d224cb5daf44d99bf151"
    },
    requirements_lock: {
      path: "install/local/wikidot-verification/requirements.lock",
      sha256: "8f2ec862f6f0358b5f0aea8ca6edd40c1ef043c2f0391701217fd907c2ae82e1"
    }
  })
  assert.equal(fileSha256(pinnedFiles.requirements.path), pinnedFiles.requirements.sha256)
  assert.equal(fileSha256(pinnedFiles.requirements_lock.path), pinnedFiles.requirements_lock.sha256)
  const requirements = fs.readFileSync(path.join(root, pinnedFiles.requirements.path), "utf8")
  const sourcePin = `wikidot @ git+https://github.com/Rokurolize/wikidot.py@${planValue.source.commit}`
  assert.equal(requirements.split("\n").filter(line => line === sourcePin).length, 1)

  const contractPath = relativePath(planValue.source.contract_path)
  assert.equal(fileSha256(contractPath), planValue.source.contract_sha256)
  assert.equal(planValue.evidence.classification, "partial")
  assert.equal(fileSha256(planValue.evidence.path), planValue.evidence.sha256)
  assert.equal(path.isAbsolute(evidenceValue.source_identity.contract.path), false)
  assert.deepEqual(evidenceValue.source_identity.repository, planValue.source.repository)
  assert.deepEqual(evidenceValue.source_identity.pinned_files, pinnedFiles)
  assert.deepEqual(evidenceValue.source_identity.contract, {
    path: planValue.source.contract_path,
    sha256: planValue.source.contract_sha256,
    schema: contract.schema
  })
  assert.deepEqual(evidenceValue.source_identity.client, {
    commit: planValue.source.commit,
    lock_path: planValue.source.client_lock.path,
    lock_sha256: planValue.source.client_lock.sha256,
    repository: planValue.source.repository,
    tree: planValue.source.tree
  })
}

const verifyWitnessBindings = value => {
  const controls = value.page_edit_controls
  const records = value.records
  const bindings = value.witness_bindings
  assert.ok(Array.isArray(bindings))
  const controlIds = controls.map(({ control_id }) => control_id)
  const recordIds = records.map(({ case_id }) => case_id)
  assert.equal(new Set(controlIds).size, controlIds.length)
  assert.equal(new Set(recordIds).size, recordIds.length)
  const observedControls = controls.filter(({ classification }) => classification === "observed")
  const observedIds = observedControls.map(({ control_id }) => control_id).sort()
  assert.deepEqual(bindings.map(({ control_id }) => control_id).sort(), observedIds)
  assert.equal(new Set(bindings.map(({ control_id }) => control_id)).size, bindings.length)
  assert.equal(new Set(bindings.map(({ record_case_id }) => record_case_id)).size, bindings.length)

  for (const control of controls) {
    const binding = bindings.find(({ control_id }) => control_id === control.control_id)
    if (control.classification === "observed") {
      assert.ok(binding)
      assert.equal(control.record_case_id, binding.record_case_id)
    } else {
      assert.equal(control.record_case_id, undefined)
      assert.equal(binding, undefined)
    }
  }
  for (const binding of bindings) {
    const record = records.find(({ case_id }) => case_id === binding.record_case_id)
    assert.ok(record)
    assert.equal(record.witness_control_id, binding.control_id)
  }
  for (const record of records) {
    if (record.witness_control_id === null) continue
    assert.equal(bindings.filter(({ record_case_id }) => record_case_id === record.case_id).length, 1)
  }
}

const verifyPartialEvidence = value => {
  assert.equal(value.schema, "wikijump.issue1373.pageedit_live_controls.v3")
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
  }
  assert.deepEqual(value.role_boundaries, {
    classification: "not_observed",
    denied_actor_observed: false,
    observed_actor: "B",
    status: "blocked"
  })
  verifyWitnessBindings(value)
}

test("issue #1373 run plan stays source-bound and partial", () => {
  verifyIdentityBindings(plan, evidence)
  assert.equal(plan.issue, 1373)
  assert.equal(plan.execution_authorized, undefined)
  assert.equal(plan.authority, undefined)
  assert.equal(path.isAbsolute(plan.evidence.path), false)
  assert.equal(plan.evidence.classification, "partial")
  assert.equal(plan.evidence.sha256, sha256(evidencePath))
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

test("issue #1373 verifier rejects identity drift", () => {
  const driftCases = [
    ["requirements", value => { value.source.pinned_files.requirements.sha256 = "0".repeat(64) }],
    ["requirements lock", value => { value.source.pinned_files.requirements_lock.sha256 = "0".repeat(64) }],
    ["contract", value => { value.source.contract_sha256 = "0".repeat(64) }],
    ["client lock", value => { value.source.client_lock.sha256 = "0".repeat(64) }],
    ["evidence", value => { value.evidence.sha256 = "0".repeat(64) }]
  ]
  for (const [, mutate] of driftCases) {
    const drifted = structuredClone(plan)
    mutate(drifted)
    assert.throws(() => verifyIdentityBindings(drifted, evidence))
  }

  const evidenceDriftCases = [
    value => { value.source_identity.repository = "other/repository" },
    value => { value.source_identity.pinned_files.requirements.sha256 = "0".repeat(64) },
    value => { value.source_identity.contract.sha256 = "0".repeat(64) },
    value => { value.source_identity.client.lock_sha256 = "0".repeat(64) }
  ]
  for (const mutate of evidenceDriftCases) {
    const drifted = structuredClone(evidence)
    mutate(drifted)
    assert.throws(() => verifyIdentityBindings(plan, drifted))
  }
})

test("issue #1373 verifier rejects duplicate, missing, and unrelated witness pairs", () => {
  const omitted = structuredClone(evidence)
  omitted.witness_bindings.pop()
  assert.throws(() => verifyPartialEvidence(omitted))

  const duplicated = structuredClone(evidence)
  duplicated.witness_bindings.push(duplicated.witness_bindings[0])
  assert.throws(() => verifyPartialEvidence(duplicated))

  const unrelated = structuredClone(evidence)
  unrelated.witness_bindings[0].record_case_id = "contention-force-lock"
  assert.throws(() => verifyPartialEvidence(unrelated))

  const roleClaim = structuredClone(evidence)
  roleClaim.page_edit_controls.find(({ control_id }) => control_id === "role_boundaries").classification = "observed"
  roleClaim.page_edit_controls.find(({ control_id }) => control_id === "role_boundaries").record_case_id = "role-boundary"
  assert.throws(() => verifyPartialEvidence(roleClaim))
})
