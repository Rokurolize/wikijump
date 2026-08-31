import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const checker = path.join(
  repositoryRoot,
  "install/local/wikidot-verification/scripts/verify-compatibility-denominator-contract.mjs"
)
const contract = path.join(
  repositoryRoot,
  "docs/development/compatibility-denominator-contract.json"
)

test("Phase 1A compatibility denominator contract is structurally closed", () => {
  const result = spawnSync(process.execPath, [checker, "--contract", contract], {
    cwd: repositoryRoot,
    encoding: "utf8"
  })

  assert.equal(result.status, 0, result.stderr)
})

test("Phase 1A contract rejects critical identity, row, binding, and final-zero drift", async (t) => {
  const baseline = JSON.parse(await fs.readFile(contract, "utf8"))
  const cases = [
    ["source manifest id policy drift", (value) => { value.identity_policy.source_manifest_id_pattern = "^source:.*$" }],
    ["mutable-coordinate surface id", (value) => { value.structural_examples.surface_assignments[0].surface_id = "surface:GET:/example" }],
    ["mutable-coordinate relationship id", (value) => { value.structural_examples.relationships[0].relationship_id = "relationship:alias:/example" }],
    ["missing immutable raw digest", (value) => { delete value.structural_examples.raw_source_records[0].record_sha256 }],
    ["duplicate raw identity", (value) => { value.structural_examples.raw_source_records[1].raw_record_id = "raw:00000001" }],
    ["duplicate canonical surface", (value) => {
      value.structural_examples.surface_assignments.push({
        ...value.structural_examples.surface_assignments[0],
        assignment_id: "assignment:00000002"
      })
    }],
    ["unknown relationship type", (value) => { value.structural_examples.relationships[0].relationship_type = "similar" }],
    ["missing equivalence record", (value) => { value.structural_examples.relationships.pop() }],
    ["mutable manifest revision", (value) => { value.structural_examples.source_manifests[0].commit = "HEAD" }],
    ["missing source manifest", (value) => { value.structural_examples.source_manifests = [] }],
    ["unknown raw source binding", (value) => { value.structural_examples.rows[0].source.bindings[0].raw_record_id = "raw:99999999" }],
    ["ambiguous null", (value) => { value.structural_examples.rows[0].input = null }],
    ["missing state without reason", (value) => { value.structural_examples.rows[0].actor = { state: "missing" } }],
    ["missing owners without reason", (value) => { value.structural_examples.rows[0].owners = { state: "missing" } }],
    ["missing issues without reason", (value) => { value.structural_examples.rows[0].issues = { state: "missing" } }],
    ["unknown owner", (value) => { value.structural_examples.rows[0].owners.implementation[0] = "implementation:unknown" }],
    ["unknown standing state", (value) => { value.structural_examples.rows[0].standing.state = "done" }],
    ["present blockers without issue", (value) => { value.structural_examples.rows[0].blockers = { state: "present", numbers: [] } }],
    ["mutable candidate proof", (value) => {
      value.structural_examples.rows[0].candidate = {
        state: "pass",
        artifacts: [{ path: "candidate.json", sha256: "9".repeat(64) }]
      }
    }],
    ["unproven closed row", (value) => {
      value.structural_examples.rows[0].closure = { state: "closed", references: [] }
    }],
    ["missing final-zero class", (value) => { value.vocabularies.final_zero_nonzero_classes.pop() }],
    ["unknown final-zero class", (value) => { value.vocabularies.final_zero_nonzero_classes.push("other") }]
  ]
  for (const field of ["actor", "input", "observable_interval", "result"]) {
    cases.push([`missing ${field} field`, (value) => { delete value.structural_examples.rows[0][field] }])
  }
  for (const field of ["source", "evidence", "tests", "owners", "issues", "blockers", "candidate", "standing", "closure"]) {
    cases.push([`missing ${field} dimension`, (value) => { delete value.structural_examples.rows[0][field] }])
  }

  for (const [name, mutate] of cases) {
    await t.test(name, async (t) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "denominator-contract-"))
      t.after(() => fs.rm(directory, { recursive: true, force: true }))
      const candidate = structuredClone(baseline)
      mutate(candidate)
      const candidatePath = path.join(directory, "contract.json")
      await fs.writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`)

      const result = spawnSync(process.execPath, [checker, "--contract", candidatePath], {
        cwd: repositoryRoot,
        encoding: "utf8"
      })

      assert.equal(result.status, 1, `${name}: ${result.stderr}`)
      assert.match(result.stderr, /compatibility denominator contract failed:/u)
    })
  }
})

test("Phase 1A contract admits explicit missing states and source-local raw ids", async (t) => {
  const candidate = JSON.parse(await fs.readFile(contract, "utf8"))
  candidate.structural_examples.source_manifests.push({
    ...candidate.structural_examples.source_manifests[0],
    source_manifest_id: "manifest:00000002",
    path: "example/other-source-manifest.json",
    sha256: "9".repeat(64)
  })
  candidate.structural_examples.raw_source_records.push({
    source_manifest_id: "manifest:00000002",
    raw_record_id: "raw:00000001",
    record_sha256: "a".repeat(64)
  })
  const row = candidate.structural_examples.rows[0]
  row.owners = { state: "missing", reason: "not_recorded" }
  row.issues = { state: "missing", reason: "not_recorded" }
  row.candidate = {
    state: "pass",
    artifacts: [{ path: "/evidence/candidate.json", sha256: "b".repeat(64) }]
  }
  row.standing = {
    state: "pass",
    artifacts: [{ path: "/evidence/standing.json", sha256: "c".repeat(64) }]
  }
  row.closure = { state: "closed", references: ["issue:1359"] }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "denominator-contract-valid-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const candidatePath = path.join(directory, "contract.json")
  await fs.writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`)

  const result = spawnSync(process.execPath, [checker, "--contract", candidatePath], {
    cwd: repositoryRoot,
    encoding: "utf8"
  })

  assert.equal(result.status, 0, result.stderr)
})
