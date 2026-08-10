import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cliPath = path.join(toolRoot, "scripts/build-compatibility-surface-inventory.mjs")

async function writeJson(root, relativePath, value) {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(root, relativePath, value) {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, value)
}

async function writeRepositoryFixture(root) {
  await writeJson(root, "docs/wikidot-specifications/catalog.json", {
    feature_count: 1,
    features: [
      {
        id: "feature-one",
        documentation_status: "documented",
        specification: "specifications/core/feature-one.md"
      }
    ]
  })
  await writeJson(root, "docs/wikidot-specifications/implementation-ledger.json", {
    features: {
      "feature-one": {
        status: "pending",
        tests: [],
        documentation_evidence: ["specifications/core/feature-one.md"],
        live_oracle_evidence: []
      }
    }
  })
  await writeText(
    root,
    "deepwell/src/api.rs",
    'register!("ping", ping);\n'
  )
  await writeJson(root, "docs/development/wikidot-page-action-surfaces.json", {
    schema: "wikijump.wikidot_page_action_surface_registry.v1",
    evidence_references: ["evidence/page-shell.html"],
    surfaces: [
      {
        action_id: "edit",
        source_status: "implemented",
        public_references: ["framerail/src/routes/+page.svelte"],
        test_references: ["tests/page-edit.test.js"]
      }
    ]
  })
  await writeText(root, "framerail/src/routes/+page.svelte", "<h1>Fixture</h1>\n")
  await writeText(
    root,
    "framerail/src/routes/+page.server.ts",
    "export const actions = { save: saveAction }\n"
  )
  await writeText(
    root,
    "framerail/src/lib/server/ajax-module-connector.js",
    `const FORUM_READ_MODULE_PARAMETERS = new Map([
  ["forum/ForumStartModule", [new Set()]]
])
const SITE_CHANGES_MODULE = "changes/SiteChangesListModule"
const SITE_CHANGES_READ_FIELDS = new Set(["page", "perpage"])
const MEMBERS_LIST_MODULE = "membership/MembersListModule"
const MEMBERS_LIST_PARAMETERS = new Set(["group", "page"])
const NEWPAGE_ACTION = "misc/NewPageHelperAction"
const NEWPAGE_EVENT = "createNewPage"
const PAGE_DISCUSSION_ACTION = "ForumAction"
const PAGE_DISCUSSION_EVENT = "createPageDiscussionThread"
if (moduleName !== "list/ListPagesModule") throw new Error()
`
  )
  await writeText(
    root,
    "framerail/src/lib/server/xmlrpc/methods.ts",
    `const METHOD_DEFINITIONS = {
  "system.listMethods": { help: "fixture", signatures: [["array"]] }
}
`
  )
  await writeText(
    root,
    "wws/src/route.rs",
    `pub fn build_router() {
  Router::new().route("/-/health-check", get(handle_health_check))
}
`
  )

  const audits = Array.from(
    { length: 7 },
    (_, index) => `docs/development/open43-audit-${index + 1}.json`
  )
  await writeJson(root, "docs/development/open43-blocked-evidence-routing.json", {
    source_audits: audits
  })
  for (const [index, audit] of audits.entries()) {
    await writeJson(root, audit, {
      schema: `wikijump.open43.fixture_${index + 1}.v1`,
      issues:
        index === 0
          ? [
              {
                issue: 123,
                subrows: [
                  {
                    case_id: "F123_PUBLIC_CASE",
                    classification: "candidate_required",
                    owner: "fixture-public-owner",
                    existing_tests: ["tests/public.test.mjs#public case"]
                  }
                ]
              }
            ]
          : []
    })
  }
}

function runCli(root, outputPath) {
  return spawnSync(process.execPath, [cliPath, "--root", root, "--output", outputPath], {
    encoding: "utf8"
  })
}

test("CLI discovers declared public surfaces and writes deterministic completion fields", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-inventory-"))
  await writeRepositoryFixture(root)
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "wrote 14 compatibility surfaces to inventory.json\n")
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  assert.equal(inventory.schema, "wikijump.compatibility_surface_inventory.v1")
  assert.deepEqual(inventory.counts, {
    total: 14,
    by_kind: {
      catalog_feature: 1,
      deepwell_jsonrpc_method: 1,
      framerail_amc_action_shape: 2,
      framerail_amc_module_shape: 4,
      framerail_route: 1,
      framerail_server_action: 1,
      framerail_xmlrpc_method: 1,
      open43_audit_case: 1,
      page_action: 1,
      wws_route: 1
    }
  })
  const caseSurface = inventory.surfaces.find(
    ({ surface_id }) => surface_id === "open43-audit-case:F123_PUBLIC_CASE"
  )
  assert.deepEqual(caseSurface, {
    surface_id: "open43-audit-case:F123_PUBLIC_CASE",
    kind: "open43_audit_case",
    public_owner: "fixture-public-owner",
    public_reference: [
      "docs/development/open43-audit-1.json#F123_PUBLIC_CASE"
    ],
    existing_refs: {
      issues: [123],
      cases: ["F123_PUBLIC_CASE"],
      tests: ["tests/public.test.mjs#public case"]
    },
    evidence: { status: "available", references: [] },
    source: { status: "implemented", references: [] },
    candidate: { status: "pending", references: [] },
    standing: { status: "pending", references: [] },
    closure: { status: "open", references: [] }
  })
  assert.deepEqual(
    inventory.surfaces.map(({ surface_id }) => surface_id),
    [...inventory.surfaces.map(({ surface_id }) => surface_id)].sort()
  )

  const firstOutput = await fs.readFile(outputPath, "utf8")
  const secondResult = runCli(root, outputPath)
  assert.equal(secondResult.status, 0, secondResult.stderr)
  assert.equal(await fs.readFile(outputPath, "utf8"), firstOutput)
})

test("CLI rejects a duplicate discovered surface", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-duplicate-"))
  await writeRepositoryFixture(root)
  await fs.appendFile(path.join(root, "deepwell/src/api.rs"), 'register!("ping", ping_again);\n')
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /duplicate surface_id: deepwell-jsonrpc:ping/u)
  await assert.rejects(fs.access(outputPath))
})

test("CLI rejects an implementation ledger orphan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-orphan-"))
  await writeRepositoryFixture(root)
  const ledgerPath = path.join(
    root,
    "docs/wikidot-specifications/implementation-ledger.json"
  )
  const ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8"))
  ledger.features["orphan-feature"] = { status: "pending", tests: [] }
  await fs.writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)

  const result = runCli(root, path.join(root, "inventory.json"))

  assert.equal(result.status, 1)
  assert.match(result.stderr, /orphan ledger feature: orphan-feature/u)
})

test("CLI rejects an audit case without an issue owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-owner-"))
  await writeRepositoryFixture(root)
  const auditPath = path.join(root, "docs/development/open43-audit-1.json")
  const audit = JSON.parse(await fs.readFile(auditPath, "utf8"))
  delete audit.issues[0].issue
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`)

  const result = runCli(root, path.join(root, "inventory.json"))

  assert.equal(result.status, 1)
  assert.match(result.stderr, /audit case without an issue owner/u)
})

test("CLI rejects a status outside the closed vocabulary", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-status-"))
  await writeRepositoryFixture(root)
  const ledgerPath = path.join(
    root,
    "docs/wikidot-specifications/implementation-ledger.json"
  )
  const ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8"))
  ledger.features["feature-one"].status = "mostly-done"
  await fs.writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)

  const result = runCli(root, path.join(root, "inventory.json"))

  assert.equal(result.status, 1)
  assert.match(result.stderr, /unknown ledger status for feature-one: mostly-done/u)
})
