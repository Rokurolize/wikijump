import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../../../../", import.meta.url)
const artifactPath = new URL(
  "install/local/wikidot-verification/artifacts/pr1334-framerail-account-route-attribution-20260810.json",
  root
)
const inventoryPath = new URL("docs/development/compatibility-surface-inventory.json", root)
const expectedIds = [
  "catalog-feature:account-lifecycle",
  "catalog-feature:secure-login",
  "framerail-route:/-/login",
  "framerail-route:/-/logout",
  "framerail-route:/-/register",
  "framerail-route:/-/settings",
  "framerail-route:/-/user",
  "framerail-route:/-/user/{slug}",
  "framerail-server-action:/-/login?/default",
  "framerail-server-action:/-/logout?/logout",
  "framerail-server-action:/-/register?/default",
  "framerail-server-action:/-/settings?/display",
  "framerail-server-action:/-/user?/userEdit"
]
const expectedRoutes = new Map([
  ["framerail-route:/-/login", ["framerail/src/routes/[x+2d]/login/+page.server.ts", "framerail/src/routes/[x+2d]/login/+page.svelte", "framerail/src/lib/server/load/login.ts", "loadLoginPage"]],
  ["framerail-route:/-/logout", ["framerail/src/routes/[x+2d]/logout/+page.server.ts", "framerail/src/routes/[x+2d]/logout/+page.svelte", "framerail/src/lib/server/load/logout.ts", "loadLogoutPage"]],
  ["framerail-route:/-/register", ["framerail/src/routes/[x+2d]/register/+page.server.ts", "framerail/src/routes/[x+2d]/register/+page.svelte", "framerail/src/lib/server/load/register.ts", "loadRegisterPage"]],
  ["framerail-route:/-/settings", ["framerail/src/routes/[x+2d]/settings/+page.server.ts", "framerail/src/routes/[x+2d]/settings/+page.svelte", "framerail/src/lib/server/load/user-settings.ts", "loadUserSettings"]],
  ["framerail-route:/-/user", ["framerail/src/routes/[x+2d]/user/+page.server.ts", "framerail/src/routes/[x+2d]/user/+page.svelte", "framerail/src/lib/server/load/user.ts", "loadUser"]],
  ["framerail-route:/-/user/{slug}", ["framerail/src/routes/[x+2d]/user/[slug]/+page.server.ts", "framerail/src/routes/[x+2d]/user/[slug]/+page.svelte", "framerail/src/lib/server/load/user.ts", "loadUser"]]
])
const expectedActions = new Map([
  ["framerail-server-action:/-/login?/default", ["default", "loginAction", "framerail/src/routes/[x+2d]/login/+page.server.ts", "framerail/src/lib/server/load/login.ts", "test_backed"]],
  ["framerail-server-action:/-/logout?/logout", ["logout", "logoutAction", "framerail/src/routes/[x+2d]/logout/+page.server.ts", "framerail/src/lib/server/load/logout.ts", "test_gap"]],
  ["framerail-server-action:/-/register?/default", ["default", "registerAction", "framerail/src/routes/[x+2d]/register/+page.server.ts", "framerail/src/lib/server/load/register.ts", "test_backed"]],
  ["framerail-server-action:/-/settings?/display", ["display", "userDisplaySettingsAction", "framerail/src/routes/[x+2d]/settings/+page.server.ts", "framerail/src/lib/server/load/user-settings.ts", "test_backed"]],
  ["framerail-server-action:/-/user?/userEdit", ["userEdit", "userEditAction", "framerail/src/routes/[x+2d]/user/+page.server.ts", "framerail/src/lib/server/load/user.ts", "test_gap"]]
])

const bytes = async (path) => readFile(new URL(path, root))
const hash = (value) => createHash("sha256").update(value).digest("hex")

async function verifyWitness(witness) {
  assert.match(witness.path, /^(framerail\/src|framerail\/tests)\//)
  const sourceBytes = await bytes(witness.path)
  const source = sourceBytes.toString("utf8")
  assert.equal(witness.sha256, hash(sourceBytes), witness.path)
  assert.ok(witness.anchors.length > 0, witness.path)
  for (const anchor of witness.anchors) {
    const matchingLines = source.split("\n").flatMap((line, index) =>
      line.includes(anchor.text) ? [index + 1] : []
    )
    assert.deepEqual(matchingLines, [anchor.line], `${witness.path}: ${anchor.text}`)
  }
}

test("attributes the exact Framerail account route source slice without compatibility overclaim", async () => {
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"))
  assert.equal(artifact.schema, "wikijump.pr1334.framerail_account_route_attribution.v1")
  assert.equal(artifact.base_commit, "c78561b3f6dc35198658f618fc01d10e4bcad6d0")
  assert.equal(artifact.base_tree, "9f236023be41fd9c807272bbb16dd060b500b140")
  assert.equal(artifact.claim_scope, "source_attribution_only")
  assert.equal(artifact.compatibility_verdict, "not_evaluated")
  assert.equal(artifact.candidate_status, "not_run")
  assert.equal(artifact.standing_status, "not_run")
  assert.equal(artifact.network_requests, 0)
  assert.equal(artifact.mutations, 0)
  assert.equal(artifact.private_output_retained, false)
  assert.deepEqual(artifact.surface_ids, expectedIds)
  assert.deepEqual(artifact.records.map(({ surface_id }) => surface_id), expectedIds)
  assert.deepEqual(artifact.blocked_surface_ids, [])

  const inventoryBytes = await readFile(inventoryPath)
  const inventory = JSON.parse(inventoryBytes)
  assert.equal(artifact.identities.inventory.path, "docs/development/compatibility-surface-inventory.json")
  assert.equal(artifact.identities.inventory.sha256, hash(inventoryBytes))
  for (const identity of [artifact.identities.fixture, artifact.identities.script]) {
    assert.equal(identity.sha256, hash(await bytes(identity.path)), identity.path)
  }
  const inventoryRows = new Map(inventory.surfaces.map((row) => [row.surface_id, row]))

  for (const record of artifact.records) {
    const inventoryRow = inventoryRows.get(record.surface_id)
    assert.ok(inventoryRow, record.surface_id)
    assert.equal(record.kind, inventoryRow.kind)
    assert.equal(record.inventory_public_owner, inventoryRow.public_owner)
    assert.deepEqual(record.inventory_public_reference, inventoryRow.public_reference)
  }

  for (const [surfaceId, expected] of expectedRoutes) {
    const record = artifact.records.find(({ surface_id }) => surface_id === surfaceId)
    assert.equal(record.source_status, "source_present")
    assert.equal(record.server_load_export.path, expected[0])
    assert.equal(record.svelte_page_owner.path, expected[1])
    assert.equal(record.imported_load_module_owner.path, expected[2])
    assert.equal(record.imported_load_module_owner.function, expected[3])
    await verifyWitness(record.server_load_export)
    await verifyWitness(record.svelte_page_owner)
    await verifyWitness(record.imported_load_module_owner)
    assert.equal(record.test_status, "test_gap")
    assert.deepEqual(record.test_witnesses, [])
    assert.match(record.test_gap, /No allowed focused test/)
  }

  for (const [surfaceId, expected] of expectedActions) {
    const record = artifact.records.find(({ surface_id }) => surface_id === surfaceId)
    assert.equal(record.source_status, "source_present")
    assert.equal(record.action_key, expected[0])
    assert.equal(record.underlying_action_function, expected[1])
    assert.equal(record.exported_action_binding.path, expected[2])
    assert.equal(record.source_owner.path, expected[3])
    assert.equal(record.test_status, expected[4])
    await verifyWitness(record.exported_action_binding)
    await verifyWitness(record.source_owner)
    for (const witness of record.test_witnesses) await verifyWitness(witness)
    if (record.test_status === "test_backed") {
      assert.ok(record.test_witnesses.length > 0)
      assert.equal(record.test_gap, "")
    } else {
      assert.deepEqual(record.test_witnesses, [])
      assert.match(record.test_gap, /No allowed focused test/)
    }
  }

  const account = artifact.records[0]
  const secureLogin = artifact.records[1]
  for (const feature of [account, secureLogin]) {
    assert.equal(feature.source_slice_status, "partial_source_attribution")
    assert.ok(feature.represented_surface_ids.length > 0)
    assert.ok(feature.represented_surface_ids.every((id) => expectedIds.includes(id)))
    assert.ok(feature.excluded_subcapabilities.includes("complete catalog feature contract"))
  }
  assert.ok(account.excluded_subcapabilities.includes("account deletion"))
  assert.ok(account.excluded_subcapabilities.includes("email verification"))
  assert.ok(account.excluded_subcapabilities.includes("authentication recovery"))
  assert.ok(account.excluded_subcapabilities.includes("complete session behavior and every MFA interval"))
  assert.ok(secureLogin.excluded_subcapabilities.includes("every MFA interval"))

  assert.deepEqual(artifact.counts, {
    surface_count: 13,
    catalog_partial_source_attribution: 2,
    routes: 6,
    actions: 5,
    test_backed: 3,
    test_gap: 8,
    blocked: 0,
    network_requests: 0,
    mutations: 0
  })
  assert.match(artifact.no_overclaim, /attributes source only/)
  assert.match(artifact.no_overclaim, /does not evaluate Wikidot compatibility/)
  assert.match(artifact.no_overclaim, /browser, runtime, candidate, standing/)
  assert.doesNotMatch(JSON.stringify(artifact), /password\s*[:=]\s*["'][^"']+/i)
})
