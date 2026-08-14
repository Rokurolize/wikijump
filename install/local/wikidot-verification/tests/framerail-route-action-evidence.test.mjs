import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../../../../", import.meta.url)
const inventoryPath = new URL("docs/development/compatibility-surface-inventory.json", root)
const registryPath = new URL("docs/development/framerail-route-action-evidence.json", root)
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

async function verifyRegistry(registry, inventory, read = readFile) {
  assert.equal(registry.schema, "wikijump.framerail_route_action_evidence.v1")
  assert.ok(Array.isArray(registry.records))

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
      const source = await read(new URL(match[1], root), "utf8")
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
  const [registry, inventory] = await Promise.all(
    [registryPath, inventoryPath].map(async (path) => JSON.parse(await readFile(path, "utf8")))
  )
  await verifyRegistry(registry, inventory)
})

test("Framerail evidence verifier rejects stale and unresolved links", async () => {
  const [registry, inventory] = await Promise.all(
    [registryPath, inventoryPath].map(async (path) => JSON.parse(await readFile(path, "utf8")))
  )
  const stale = structuredClone(registry)
  stale.records[0].tests = ["framerail/tests/not-present.test.js::not present"]
  await assert.rejects(verifyRegistry(stale, inventory))

  const unresolved = structuredClone(registry)
  unresolved.records[0].tracking = [{ issue: 754, case: "NOT_A_CASE" }]
  await assert.rejects(verifyRegistry(unresolved, inventory))

  const missing = structuredClone(registry)
  missing.records.pop()
  await assert.rejects(verifyRegistry(missing, inventory))

  const duplicate = structuredClone(registry)
  duplicate.records[1] = duplicate.records[0]
  await assert.rejects(verifyRegistry(duplicate, inventory))

  const duplicateLink = structuredClone(registry)
  duplicateLink.records[0].tests.push(duplicateLink.records[0].tests[0])
  await assert.rejects(verifyRegistry(duplicateLink, inventory))
})
