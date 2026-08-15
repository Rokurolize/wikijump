import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { CANDIDATE_CASE_SET_NAMES } from "../src/candidate-case-command.mjs"
import {
  buildCandidateCaseSetManifest,
  verifyCandidateCaseSetManifest,
} from "../scripts/build-candidate-case-set-manifest.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const cliPath = path.join(
  repositoryRoot,
  "install/local/wikidot-verification/scripts/build-candidate-case-set-manifest.mjs"
)
const manifestPath = path.join(repositoryRoot, "docs/development/candidate-case-set-manifest.json")

const SETTINGS_GROUPS = [
  ["open43-settings-analytics", ["S754_ANALYTICS_INITIAL", "S754_ANALYTICS_SETTLED"]],
  ["open43-settings-theme", ["S755_THEME_INITIAL", "S755_THEME_SETTLED"]],
  ["open43-settings-toolbar", ["S757_TOOLBAR_INITIAL", "S757_TOOLBAR_SETTLED"]],
  ["open43-settings-admin", ["S1046_ADMIN_INITIAL", "S1046_ADMIN_SETTLED", "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX"]],
]

function runCli(argumentsList) {
  return spawnSync(process.execPath, [cliPath, ...argumentsList], { encoding: "utf8" })
}

async function readManifest() {
  return JSON.parse(await fs.readFile(manifestPath, "utf8"))
}

test("candidate case set manifest exactly covers every registered case set once", async () => {
  const result = runCli(["--verify"])

  assert.equal(result.status, 0, result.stderr)
  const manifest = await readManifest()
  assert.deepEqual(manifest, buildCandidateCaseSetManifest())
  assert.equal(verifyCandidateCaseSetManifest(manifest), true)
  assert.equal(manifest.case_set_count, CANDIDATE_CASE_SET_NAMES.length)
  assert.equal(manifest.execution_case_set_count + manifest.alias_case_set_count, manifest.case_set_count)
  assert.equal(manifest.execution_case_set_count, manifest.case_sets.length)
  assert.equal(manifest.alias_case_set_count, manifest.aliases.length)
  assert.deepEqual(
    [...manifest.case_sets.map(({ name }) => name), ...manifest.aliases.map(({ name }) => name)].sort(),
    [...CANDIDATE_CASE_SET_NAMES].sort(),
  )
})

test("selected execution case IDs are globally single-owner with one settings alias", async () => {
  const manifest = await readManifest()
  const byOwner = new Map()
  for (const row of manifest.case_sets) {
    for (const caseId of row.case_ids) {
      assert.equal(byOwner.has(caseId), false, `${caseId} is owned by more than one selected set`)
      byOwner.set(caseId, row.name)
    }
  }
  for (const [group, caseIds] of SETTINGS_GROUPS) {
    for (const caseId of caseIds) {
      assert.equal(byOwner.get(caseId), group, `${caseId} must be owned by ${group}`)
    }
  }
  assert.deepEqual(manifest.aliases, [{
    name: "open43-settings-browser",
    alias_of: SETTINGS_GROUPS.map(([group]) => group).sort(),
    case_ids: SETTINGS_GROUPS.flatMap(([, caseIds]) => caseIds),
  }])
  assert.equal(
    manifest.case_sets.some(({ name }) => name === "open43-settings-browser"),
    false,
    "the monolithic settings set must not be an execution owner",
  )
})

test("candidate case set manifest rejects a duplicated case ID across selected sets", async () => {
  const manifest = structuredClone(await readManifest())
  const actions = manifest.case_sets.find(({ name }) => name === "open43-actions")
  actions.case_ids.push("S754_ANALYTICS_INITIAL")

  assert.throws(
    () => verifyCandidateCaseSetManifest(manifest),
    /duplicate candidate case ID across selected sets: S754_ANALYTICS_INITIAL owned by open43-actions and open43-settings-analytics/u,
  )
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-case-set-manifest-"))
  await fs.writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  const result = runCli(["--output", path.join(directory, "manifest.json"), "--verify"])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /candidate case set manifest is stale/u)
  await fs.rm(directory, { recursive: true, force: true })
})

test("candidate case set manifest rejects alias drift and omitted or unknown sets", async () => {
  const manifest = structuredClone(await readManifest())

  const aliasDrift = structuredClone(manifest)
  aliasDrift.aliases[0].alias_of = aliasDrift.aliases[0].alias_of.slice(1)
  assert.throws(() => verifyCandidateCaseSetManifest(aliasDrift), /case_ids do not match the union of its owners/u)

  const omitted = structuredClone(manifest)
  omitted.case_sets.pop()
  omitted.execution_case_set_count -= 1
  omitted.case_set_count -= 1
  assert.throws(() => verifyCandidateCaseSetManifest(omitted), /omits, duplicates, or adds/u)

  const unknown = structuredClone(manifest)
  unknown.case_sets.push({ name: "open43-not-a-registered-set", case_ids: ["X999_UNKNOWN_SET"] })
  unknown.execution_case_set_count += 1
  unknown.case_set_count += 1
  assert.throws(() => verifyCandidateCaseSetManifest(unknown), /omits, duplicates, or adds/u)

  const duplicated = structuredClone(manifest)
  duplicated.case_sets.push(structuredClone(duplicated.case_sets[0]))
  duplicated.execution_case_set_count += 1
  duplicated.case_set_count += 1
  assert.throws(() => verifyCandidateCaseSetManifest(duplicated), /omits, duplicates, or adds/u)
})
