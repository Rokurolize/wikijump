import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import test from "node:test"

const root = new URL("../../../../", import.meta.url)
const registryPath = new URL("docs/development/framerail-route-action-evidence.json", root)
const browserContractPath = new URL(
  "install/local/wikidot-verification/fixtures/framerail-route-action-browser/run-contract.json",
  root
)
const execFileAsync = promisify(execFile)
const gitEnvironment = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin"
})
const temporalIds = [
  "control:create",
  "control:restore",
  "pane:append",
  "pane:backlinks",
  "pane:delete",
  "pane:edit-meta",
  "pane:layout",
  "pane:lock",
  "pane:move",
  "pane:parent",
  "pane:site-tools",
  "pane:tags",
  "pane:vote",
  "pane:watchers"
]
const missingIntervals = ["denial", "failure", "loading", "selection", "settled", "success"]

const uniqueSorted = (values) =>
  values.length === new Set(values).size &&
  values.every((value, index) => !index || values[index - 1] < value)

async function git(args, encoding = "utf8") {
  const { stdout } = await execFileAsync("/usr/bin/git", args, {
    cwd: fileURLToPath(root),
    encoding,
    env: gitEnvironment,
    maxBuffer: 16 * 1024 * 1024
  })
  return stdout
}

const gitBlob = (revision, path) => git(["cat-file", "blob", `${revision}:${path}`], null)

async function verifyRegistry(registry) {
  assert.equal(registry.schema, "wikijump.framerail_route_action_evidence.v1")
  assert.deepEqual(Object.keys(registry), ["schema", "source_revision", "inventory", "records"])
  assert.match(registry.source_revision, /^[0-9a-f]{40}$/u)
  assert.deepEqual(Object.keys(registry.inventory), ["path", "sha256"])
  assert.equal(registry.inventory.path, "docs/development/compatibility-surface-inventory.json")
  assert.match(registry.inventory.sha256, /^[0-9a-f]{64}$/u)
  assert.ok(Array.isArray(registry.records))

  const resolvedRevision = (await git([
    "rev-parse",
    "--verify",
    `${registry.source_revision}^{commit}`
  ])).trim()
  assert.equal(resolvedRevision, registry.source_revision)
  const inventoryBytes = await gitBlob(registry.source_revision, registry.inventory.path)
  assert.equal(
    createHash("sha256").update(inventoryBytes).digest("hex"),
    registry.inventory.sha256
  )
  const inventory = JSON.parse(inventoryBytes.toString("utf8"))
  const expected = inventory.surfaces
    .filter(({ kind }) => kind === "framerail_route" || kind === "framerail_server_action")
    .map(({ surface_id }) => surface_id)
  const actual = registry.records.map(({ surface_id }) => surface_id)
  assert.equal(actual.length, 125)
  assert.deepEqual(actual, expected)
  assert.equal(new Set(actual).size, actual.length)

  const cases = new Map(
    inventory.surfaces
      .filter(({ kind }) => kind === "open43_audit_case")
      .map(({ existing_refs, surface_id }) => [
        surface_id.slice("open43-audit-case:".length),
        existing_refs.issues[0]
      ])
  )
  const temporal = []

  for (const record of registry.records) {
    assert.deepEqual(Object.keys(record), ["surface_id", "tests", "tracking", "temporal"])
    assert.ok(uniqueSorted(record.tests), `${record.surface_id} test links are not sorted and unique`)
    assert.ok(record.tracking.length > 0, `${record.surface_id} has no issue or case link`)
    assert.ok(
      uniqueSorted(
        record.tracking.map(
          (link) => `${String(link.issue).padStart(10, "0")}:${link.case ?? ""}`
        )
      ),
      `${record.surface_id} tracking links are not sorted and unique`
    )

    for (const reference of record.tests) {
      const match = /^(framerail\/tests\/[^:]+)::(.+)$/u.exec(reference)
      assert.ok(match, `${record.surface_id} has a noncanonical test link: ${reference}`)
      const source = (await gitBlob(registry.source_revision, match[1])).toString("utf8")
      const escaped = match[2].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
      const anchors = source.match(new RegExp(`\\b(?:test|it)\\(\\s*["']${escaped}["']`, "gu")) ?? []
      assert.equal(anchors.length, 1, `${record.surface_id} has an unresolved test link: ${reference}`)
    }

    for (const link of record.tracking) {
      assert.ok(Number.isSafeInteger(link.issue) && link.issue > 0)
      assert.deepEqual(Object.keys(link), link.case ? ["issue", "case"] : ["issue"])
      if (link.case) {
        assert.equal(
          cases.get(link.case),
          link.issue,
          `${record.surface_id} has an unresolved issue/case link`
        )
      }
      else assert.equal(link.issue, 1372, `${record.surface_id} has an unresolved issue link`)
    }

    for (const gap of record.temporal) {
      assert.deepEqual(Object.keys(gap), ["id", "status", "issue", "missing_intervals"])
      assert.equal(gap.status, "missing")
      assert.equal(gap.issue, 1372)
      assert.deepEqual(gap.missing_intervals, missingIntervals)
      temporal.push(gap.id)
    }
  }

  assert.deepEqual(temporal.sort(), temporalIds)
}

test("Framerail route and action evidence links resolve exactly", async () => {
  const registry = JSON.parse(await readFile(registryPath, "utf8"))
  await verifyRegistry(registry)
})

test("Framerail evidence verifier rejects stale and unresolved links", async () => {
  const registry = JSON.parse(await readFile(registryPath, "utf8"))
  const stale = structuredClone(registry)
  stale.records[0].tests = ["framerail/tests/not-present.test.js::not present"]
  await assert.rejects(verifyRegistry(stale))

  const unresolved = structuredClone(registry)
  unresolved.records[0].tracking = [{ issue: 754, case: "NOT_A_CASE" }]
  await assert.rejects(verifyRegistry(unresolved))

  const missing = structuredClone(registry)
  missing.records.pop()
  await assert.rejects(verifyRegistry(missing))

  const duplicate = structuredClone(registry)
  duplicate.records[1] = duplicate.records[0]
  await assert.rejects(verifyRegistry(duplicate))

  const duplicateLink = structuredClone(registry)
  duplicateLink.records[0].tests.push(duplicateLink.records[0].tests[0])
  await assert.rejects(verifyRegistry(duplicateLink))
})

test("Framerail evidence verifier rejects invented and poisoned source identities", async () => {
  const registry = JSON.parse(await readFile(registryPath, "utf8"))
  const invented = structuredClone(registry)
  invented.source_revision = "0000000000000000000000000000000000000000"
  await assert.rejects(verifyRegistry(invented))

  const poisoned = structuredClone(registry)
  poisoned.source_revision = "HEAD^{commit};touch /tmp/framerail-evidence-poisoned"
  await assert.rejects(verifyRegistry(poisoned))

  const staleInventory = structuredClone(registry)
  staleInventory.inventory.sha256 = "0".repeat(64)
  await assert.rejects(verifyRegistry(staleInventory))
})

test("issue #1372 browser run contract is complete, source-bound, and blocked", async () => {
  const contract = JSON.parse(await readFile(browserContractPath, "utf8"))
  assert.equal(contract.schema, "wikijump.framerail_route_action_browser_run.v1")
  assert.equal(contract.issue, 1372)
  assert.equal(contract.status, "blocked_authority")
  assert.match(contract.source_revision, /^[0-9a-f]{40}$/u)

  const registryBytes = await gitBlob(contract.source_revision, contract.evidence_registry.path)
  assert.equal(
    createHash("sha256").update(registryBytes).digest("hex"),
    contract.evidence_registry.sha256
  )
  const registry = JSON.parse(registryBytes.toString("utf8"))
  const expectedSubjectIds = registry.records.flatMap(({ temporal }) => temporal.map(({ id }) => id))
  assert.deepEqual(contract.subjects.map(({ id }) => id).sort(), expectedSubjectIds.sort())
  assert.equal(new Set(contract.subjects.map(({ id }) => id)).size, 14)
  assert.deepEqual(contract.required_intervals, missingIntervals)
  assert.equal(contract.subjects.length * contract.required_intervals.length, 84)
  for (const subject of contract.subjects) {
    assert.ok(subject.trigger_selectors.length > 0, `${subject.id} has no trigger`)
    assert.match(subject.settled_selector, /^[#.]/u)
  }

  assert.deepEqual(contract.actor_classes, ["denied", "permitted"])
  assert.deepEqual(contract.result_controls, ["denial", "failure", "success"])
  assert.equal(contract.layout, "wikidot")
  assert.deepEqual(contract.preflight_required, [
    "authority_state_sha256",
    "browser_identity",
    "evidence_output_path",
    "failure_control_identity",
    "fixture_identity",
    "run_id",
    "runtime_identity"
  ])
  assert.deepEqual(contract.evidence_fields, [
    "actor_class", "browser_identity", "console_errors", "dom", "failed_requests",
    "http_errors", "interval", "page_errors", "runtime_identity", "screenshot",
    "source_revision", "subject_id", "timestamp", "url"
  ])
  assert.deepEqual(contract.authority, {
    required: ["browser", "run-owned-fixture-mutation", "run-owned-runtime"],
    current: "not_authorized",
    source: "/home/roku/wjlab/state/current.json"
  })
  assert.deepEqual(contract.historical_evidence, {
    path: "/home/roku/wjlab/evidence/page-pane-lazy-browser-20260713.json",
    sha256: "17b9b5215d40c32123ada66b43c5d5a37ea4a06a37bf2ebf99c0595e39c61ba9",
    classification: "historical_history_only"
  })
  assert.equal(contract.cleanup.required, true)
  assert.equal(contract.cleanup.protected_resources_must_remain_unchanged, true)
})
