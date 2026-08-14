import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cliPath = path.join(toolRoot, "scripts/build-compatibility-surface-inventory.mjs")

const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const pageActionsFixtureSource = `export const pageActions = {
  edit: editAction,
  deletedGet: deletedGetAction,
  restore: restoreAction
}
`

function cleanupFixture(t, root) {
  t.after(() => fs.rm(root, { recursive: true, force: true }))
}

const listPagesParameters = [
  "p", "pagetype", "page_type", "page-type", "category", "tags", "tag", "parent",
  "created_at", "createdat", "updated_at", "updatedat", "created_by", "createdby",
  "rating", "score", "name", "fullname", "full_slug", "fullslug", "range", "order",
  "offset", "limit", "perpage", "per_page", "separate", "wrapper", "rss", "rsstitle",
  "rssdescription", "rsshome", "rsslimit", "rssonly"
]

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
    schema: "wikijump.wikidot_page_action_surface_registry.v2",
    evidence_references: ["evidence/page-shell.html"],
    surfaces: [
      {
        action_id: "edit",
        source_status: "implemented",
        public_references: ["framerail/src/routes/+page.svelte"],
        test_references: ["tests/page-edit.test.js"]
      }
    ],
    missing_page_controls: [
      {
        control_id: "create",
        source_status: "implemented",
        operation_bindings: [
          {
            operation_id: "edit",
            public_references: [
              "framerail/src/lib/server/load/page/page-actions.ts#action:edit"
            ]
          }
        ],
        observable_states: [
          "missing-page-settled",
          "editor-loading",
          "editor-settled",
          "save-loading",
          "save-success",
          "save-denial",
          "save-failure",
          "created-page-settled"
        ],
        browser_interval_proof: { status: "missing", issue: 1372 },
        source_identities: [
          {
            path: "framerail/src/routes/+page.svelte",
            sha256: "b14d226020649601ba32153ab426b08d816efbdaa68fd0618cf3fe6143ee0fee"
          },
          {
            path: "framerail/src/lib/server/load/page/page-actions.ts",
            sha256: sha256(pageActionsFixtureSource)
          }
        ],
        issues: [1371, 1372],
        test_references: ["tests/missing-page-create.spec.ts"]
      },
      {
        control_id: "restore",
        source_status: "implemented",
        operation_bindings: [
          {
            operation_id: "deletedGet",
            public_references: [
              "framerail/src/lib/server/load/page/page-actions.ts#action:deletedGet"
            ]
          },
          {
            operation_id: "restore",
            public_references: [
              "framerail/src/lib/server/load/page/page-actions.ts#action:restore"
            ]
          }
        ],
        observable_states: [
          "missing-page-settled",
          "deleted-selection-loading",
          "deleted-selection-settled",
          "deleted-selection-denial",
          "deleted-selection-failure",
          "restore-loading",
          "restore-success",
          "restore-denial",
          "restore-failure",
          "restored-page-settled"
        ],
        browser_interval_proof: { status: "missing", issue: 1372 },
        source_identities: [
          {
            path: "framerail/src/routes/+page.svelte",
            sha256: "b14d226020649601ba32153ab426b08d816efbdaa68fd0618cf3fe6143ee0fee"
          },
          {
            path: "framerail/src/lib/server/load/page/page-actions.ts",
            sha256: sha256(pageActionsFixtureSource)
          }
        ],
        issues: [1371, 1372],
        test_references: ["tests/missing-page-restore.spec.ts"]
      }
    ]
  })
  await writeText(root, "framerail/src/routes/+page.svelte", "<h1>Fixture</h1>\n")
  await writeText(
    root,
    "framerail/src/routes/+page.server.ts",
    "export const actions = { edit: editAction }\n"
  )
  await writeText(
    root,
    "framerail/src/lib/server/load/page/page-actions.ts",
    pageActionsFixtureSource
  )
  await writeText(
    root,
    "framerail/src/lib/server/ajax-module-connector.js",
    `import { classifyWikidotSiteChangesRequest } from "./wikidot-site-changes.js"
const FORUM_READ_MODULE_PARAMETERS = new Map([
  ["forum/ForumStartModule", [new Set()]]
])
const SITE_CHANGES_MODULE = "changes/SiteChangesListModule"
const MEMBERS_LIST_MODULE = "membership/MembersListModule"
const MEMBERS_LIST_PARAMETERS = new Set(["group", "page"])
const MEMBERS_LIST_DEFAULT_PARAMETERS = new Set(["group"])
const PAGE_READ_MODULE_PARAMETERS = new Map([
  ["viewsource/ViewSourceModule", new Set(["page_id"])],
  ["files/PageFilesModule", new Set(["page_id"])]
])
const LIST_PAGES_PARAMETERS = new Set(${JSON.stringify(listPagesParameters)})
const NEWPAGE_ACTION = "misc/NewPageHelperAction"
const NEWPAGE_EVENT = "createNewPage"
const PAGE_DISCUSSION_ACTION = "ForumAction"
const PAGE_DISCUSSION_EVENT = "createPageDiscussionThread"
if (moduleName !== "list/ListPagesModule") throw new Error()
`
  )
  await writeJson(root, "docs/development/framerail-amc-wire-contracts.json", {
    schema: "wikijump.framerail_amc_wire_contracts.v1",
    modules: [
      {
        module_name: "list/ListPagesModule",
        allowed_parameters: listPagesParameters,
        required_fields: ["module_body"],
        parameter_order: "insignificant",
        duplicate_fields: "rejected",
        value_type: "urlencoded_utf8_string",
        callback_index: "accepted_ignored",
        authentication: "cookies_ignored;wikidot_token7_accepted_ignored",
        success_envelope: "status=ok;body=string",
        failure_envelopes: [
          "missing_module_body:status=not_ok;message=ListPages module_body is required",
          "render_failure:status=not_ok;message=Unable to render ListPages module"
        ],
        implementation_references: [
          "framerail/src/lib/server/ajax-module-connector.js",
          "deepwell/src/services/render/list_pages/ajax.rs"
        ]
      }
    ]
  })
  await writeText(
    root,
    "framerail/src/lib/server/wikidot-site-changes.js",
    `const BROWSER_FIELDS = new Set(["page", "perpage", "pageId", "categoryId", "options"])
const WIKIDOT_PY_FIELDS = new Set(["page", "perpage", "options"])
export const classifyWikidotSiteChangesRequest = (fields) => fields
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
  await writeJson(root, "docs/development/wikidot-py-amc-client-parity.json", {
    schema: "wikijump.wikidot_py_amc_client_parity.v1",
    source: { commit: "a".repeat(40) },
    modules: [
      {
        module_name: "viewsource/ViewSourceModule",
        parameters: ["page_id"],
        status: "supported",
        source_reference: "src/wikidot/module/page.py#source"
      },
      {
        module_name: "history/PageRevisionListModule",
        parameters: ["page_id"],
        status: "unsupported_unevidenced",
        gap: "fixture gap",
        source_reference: "src/wikidot/module/page.py#history"
      }
    ]
  })
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
  const closureAudits = []
  for (const [index, audit] of audits.entries()) {
    const value = {
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
    }
    const serialized = `${JSON.stringify(value, null, 2)}\n`
    await writeText(root, audit, serialized)
    closureAudits.push({
      path: audit,
      sha256: sha256(serialized),
      issue_count: index === 0 ? 1 : 0,
      case_count: index === 0 ? 1 : 0,
      classification_counts: {
        source_ready: 0,
        needs_source: 0,
        candidate_required: index === 0 ? 1 : 0,
        blocked_evidence: 0
      }
    })
  }
  const routeClasses = Object.fromEntries([
    "anonymous_read_only", "authenticated_read_only", "run_owned_mutation", "local_candidate",
    "live_browser_only", "missing_public_producer", "missing_architecture_domain_authority",
    "missing_security_policy"
  ].map((name) => [name, `${name} fixture route`]))
  await writeJson(root, "docs/development/open43-blocked-evidence-routing.json", {
    schema: "wikijump.open43.blocked_evidence_routing.v1",
    source_audits: audits,
    route_classes: routeClasses,
    counts: { ...Object.fromEntries(Object.keys(routeClasses).map((name) => [name, 0])), total: 0 },
    rows: []
  })
  await writeJson(root, "docs/development/open43-closure-audit-ownership-reconciliation.json", {
    schema: "wikijump.open43.closure_audit_ownership_reconciliation.v1",
    closure_audits: closureAudits,
    after: {
      case_count: 1,
      unique_case_count: 1,
      duplicate_case_ids: [],
      unknown_classifications: [],
      classification_counts: {
        source_ready: 0,
        needs_source: 0,
        candidate_required: 1,
        blocked_evidence: 0
      }
    }
  })
}

async function replacePageActionsFixture(root, actionSource) {
  const actionPath = "framerail/src/lib/server/load/page/page-actions.ts"
  await writeText(root, actionPath, actionSource)
  const registryPath = path.join(root, "docs/development/wikidot-page-action-surfaces.json")
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
  for (const control of registry.missing_page_controls) {
    const identity = control.source_identities.find(
      ({ path: sourcePath }) => sourcePath === actionPath
    )
    identity.sha256 = sha256(actionSource)
  }
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
}

function runCli(root, outputPath) {
  return spawnSync(process.execPath, [cliPath, "--root", root, "--output", outputPath], {
    encoding: "utf8"
  })
}

test("CLI discovers declared public surfaces and writes deterministic completion fields", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-inventory-"))
  cleanupFixture(t, root)
  await writeRepositoryFixture(root)
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "wrote 30 compatibility surfaces to inventory.json\n")
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  assert.equal(inventory.schema, "wikijump.compatibility_surface_inventory.v1")
  assert.deepEqual(inventory.counts, {
    total: 30,
    by_kind: {
      catalog_feature: 1,
      deepwell_jsonrpc_method: 1,
      framerail_amc_action_shape: 2,
      framerail_amc_module_shape: 15,
      framerail_route: 1,
      framerail_server_action: 1,
      framerail_xmlrpc_method: 1,
      missing_page_control: 2,
      open43_audit_case: 1,
      page_action: 1,
      wikidot_py_amc_module_shape: 2,
      wws_route: 2
    }
  })
  const listPagesSurfaces = inventory.surfaces
    .filter(({ surface_id }) => surface_id.includes("list/ListPagesModule"))
    .map(({ surface_id }) => surface_id)
  assert.equal(listPagesSurfaces.length, 8)
  assert.ok(listPagesSurfaces.some((id) => id.includes(`parameters=${[...listPagesParameters].sort().join(",")}`)))
  assert.ok(listPagesSurfaces.includes("framerail-amc-module:list/ListPagesModule:parameter-order=insignificant"))
  assert.ok(listPagesSurfaces.includes("framerail-amc-module:list/ListPagesModule:duplicate-fields=rejected"))
  assert.ok(listPagesSurfaces.includes("framerail-amc-module:list/ListPagesModule:value-type=urlencoded_utf8_string"))
  assert.ok(listPagesSurfaces.includes("framerail-amc-module:list/ListPagesModule:callback-index=accepted_ignored"))
  assert.ok(listPagesSurfaces.includes("framerail-amc-module:list/ListPagesModule:authentication=cookies_ignored;wikidot_token7_accepted_ignored"))
  assert.ok(listPagesSurfaces.includes("framerail-amc-module:list/ListPagesModule:success-envelope=status=ok;body=string"))
  assert.ok(listPagesSurfaces.includes("framerail-amc-module:list/ListPagesModule:failure-envelopes=missing_module_body:status=not_ok;message=ListPages module_body is required|render_failure:status=not_ok;message=Unable to render ListPages module"))
  assert.ok(listPagesSurfaces.every((id) => !id.includes("*")))
  assert.deepEqual(
    inventory.surfaces
      .filter(({ surface_id }) => surface_id.includes("SiteChangesListModule"))
      .map(({ surface_id }) => surface_id),
    [
      "framerail-amc-module:changes/SiteChangesListModule:parameters=categoryId,options,page,pageId,perpage",
      "framerail-amc-module:changes/SiteChangesListModule:parameters=options,page,perpage"
    ]
  )
  assert.deepEqual(
    inventory.surfaces
      .filter(({ surface_id }) => surface_id.includes("/-/health-check"))
      .map(({ surface_id }) => surface_id),
    [
      "wws-route:GET:/-/health-check",
      "wws-route:HEAD:/-/health-check"
    ]
  )
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
  const missingPageControls = inventory.surfaces.filter(
    ({ kind }) => kind === "missing_page_control"
  )
  assert.deepEqual(
    missingPageControls.map(({ surface_id }) => surface_id),
    ["missing-page-control:create", "missing-page-control:restore"]
  )
  assert.deepEqual(missingPageControls[0].operation_bindings, [
    {
      operation_id: "edit",
      public_references: ["framerail/src/lib/server/load/page/page-actions.ts#action:edit"]
    }
  ])
  assert.deepEqual(missingPageControls[1].operation_bindings, [
    {
      operation_id: "deletedGet",
      public_references: [
        "framerail/src/lib/server/load/page/page-actions.ts#action:deletedGet"
      ]
    },
    {
      operation_id: "restore",
      public_references: ["framerail/src/lib/server/load/page/page-actions.ts#action:restore"]
    }
  ])
  assert.deepEqual(
    missingPageControls.map(({ browser_interval_proof }) => browser_interval_proof),
    [
      { status: "missing", issue: 1372 },
      { status: "missing", issue: 1372 }
    ]
  )
  assert.deepEqual(missingPageControls[0].observable_states, [
    "missing-page-settled",
    "editor-loading",
    "editor-settled",
    "save-loading",
    "save-success",
    "save-denial",
    "save-failure",
    "created-page-settled"
  ])
  assert.deepEqual(missingPageControls[1].observable_states, [
    "missing-page-settled",
    "deleted-selection-loading",
    "deleted-selection-settled",
    "deleted-selection-denial",
    "deleted-selection-failure",
    "restore-loading",
    "restore-success",
    "restore-denial",
    "restore-failure",
    "restored-page-settled"
  ])
  assert.deepEqual(missingPageControls[0].source_identities, [
    {
      path: "framerail/src/routes/+page.svelte",
      sha256: "b14d226020649601ba32153ab426b08d816efbdaa68fd0618cf3fe6143ee0fee"
    },
    {
      path: "framerail/src/lib/server/load/page/page-actions.ts",
      sha256: sha256(pageActionsFixtureSource)
    }
  ])
  assert.deepEqual(
    missingPageControls.map(({ evidence }) => evidence),
    [
      { status: "missing", references: [] },
      { status: "missing", references: [] }
    ]
  )
  assert.deepEqual(
    inventory.surfaces.map(({ surface_id }) => surface_id),
    [...inventory.surfaces.map(({ surface_id }) => surface_id)].sort()
  )

  const firstOutput = await fs.readFile(outputPath, "utf8")
  const secondResult = runCli(root, outputPath)
  assert.equal(secondResult.status, 0, secondResult.stderr)
  assert.equal(await fs.readFile(outputPath, "utf8"), firstOutput)
})

test("CLI rejects an omitted or duplicate missing-page control", async (t) => {
  for (const mutation of ["omit", "duplicate"]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `compatibility-missing-page-${mutation}-`))
    cleanupFixture(t, root)
    await writeRepositoryFixture(root)
    const registryPath = path.join(root, "docs/development/wikidot-page-action-surfaces.json")
    const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
    registry.missing_page_controls = mutation === "omit"
      ? registry.missing_page_controls.slice(0, 1)
      : [registry.missing_page_controls[0], registry.missing_page_controls[0]]
    await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`)

    const result = runCli(root, path.join(root, "inventory.json"))

    assert.equal(result.status, 1, mutation)
    assert.match(
      result.stderr,
      /must declare exactly one create and one restore control/u,
      mutation
    )
  }
})

test("CLI rejects a stale missing-page source identity", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-missing-page-stale-"))
  cleanupFixture(t, root)
  await writeRepositoryFixture(root)
  const registryPath = path.join(root, "docs/development/wikidot-page-action-surfaces.json")
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
  registry.missing_page_controls[0].source_identities[0].sha256 = "0".repeat(64)
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`)

  const result = runCli(root, path.join(root, "inventory.json"))

  assert.equal(result.status, 1)
  assert.match(result.stderr, /create source identity is stale/u)
  await assert.rejects(fs.access(path.join(root, "inventory.json")))
})

test("CLI rejects a missing-page source identity outside the repository", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-missing-page-path-"))
  cleanupFixture(t, root)
  await writeRepositoryFixture(root)
  const registryPath = path.join(root, "docs/development/wikidot-page-action-surfaces.json")
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
  registry.missing_page_controls[0].source_identities[0].path = "../outside-source.svelte"
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`)

  const result = runCli(root, path.join(root, "inventory.json"))

  assert.equal(result.status, 1)
  assert.match(result.stderr, /create has an invalid source identity/u)
  await assert.rejects(fs.access(path.join(root, "inventory.json")))
})

test("CLI rejects malformed or contradictory available browser proof", async (t) => {
  const invalidProofs = [
    { status: "available", references: [null] },
    { status: "available", references: [""] },
    { status: "available", references: ["./evidence/create.json"] },
    { status: "available", references: [" evidence/create.json"] },
    { status: "available", references: ["evidence/create.json", "evidence/create.json"] },
    { status: "available", references: ["evidence/create.json"], issue: 1372 },
    { status: "missing", issue: 1372, references: ["evidence/create.json"] },
    { status: "missing", issue: 1372, extra: true }
  ]
  for (const [index, proof] of invalidProofs.entries()) {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), `compatibility-missing-page-proof-${index}-`)
    )
    cleanupFixture(t, root)
    await writeRepositoryFixture(root)
    const registryPath = path.join(root, "docs/development/wikidot-page-action-surfaces.json")
    const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
    registry.missing_page_controls[0].browser_interval_proof = proof
    await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`)

    const result = runCli(root, path.join(root, "inventory.json"))

    assert.equal(result.status, 1, JSON.stringify(proof))
    assert.match(result.stderr, /create has invalid browser_interval_proof/u)
  }
})

test("CLI accepts canonical available browser proof without adding an issue", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-missing-page-proof-ok-"))
  cleanupFixture(t, root)
  await writeRepositoryFixture(root)
  const registryPath = path.join(root, "docs/development/wikidot-page-action-surfaces.json")
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
  registry.missing_page_controls[0].browser_interval_proof = {
    status: "available",
    references: ["evidence/create-browser.json#settled"]
  }
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  const create = inventory.surfaces.find(
    ({ surface_id }) => surface_id === "missing-page-control:create"
  )
  assert.deepEqual(create.browser_interval_proof, {
    status: "available",
    references: ["evidence/create-browser.json#settled"]
  })
})

test("CLI rejects an operation anchor absent from the declared pageActions object", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-missing-page-action-"))
  cleanupFixture(t, root)
  await writeRepositoryFixture(root)
  const actionSource = pageActionsFixtureSource.replace("edit: editAction,\n", "")
  await replacePageActionsFixture(root, actionSource)

  const result = runCli(root, path.join(root, "inventory.json"))

  assert.equal(result.status, 1)
  assert.match(result.stderr, /create edit is not declared by .*#pageActions/u)
})

test("CLI ignores pageActions declarations shadowed by TypeScript comments and literals", async (t) => {
  const realDeclaration = pageActionsFixtureSource.replace("edit: editAction,\n", "")
  const shadows = {
    comment: "// export const pageActions = { edit: fake, deletedGet: fake, restore: fake }",
    string: 'const shadow = "export const pageActions = { edit: fake, deletedGet: fake, restore: fake }"',
    regex: "/export const pageActions = { edit: fake, deletedGet: fake, restore: fake }/"
  }
  for (const [kind, shadow] of Object.entries(shadows)) {
    await t.test(kind, async (t) => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), `compatibility-missing-page-${kind}-`)
      )
      cleanupFixture(t, root)
      await writeRepositoryFixture(root)
      await replacePageActionsFixture(root, `${shadow}\n${realDeclaration}`)

      const result = runCli(root, path.join(root, "inventory.json"))

      assert.equal(result.status, 1)
      assert.match(result.stderr, /create edit is not declared by .*#pageActions/u)
    })
  }
})

test("CLI discovers GET, implicit HEAD, and FALLBACK for the production composite route", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-wws-composite-"))
  await writeRepositoryFixture(root)
  await writeText(
    root,
    "wws/src/route.rs",
    `pub fn build_router() {
  Router::new().route(
    "/{page_slug}/code",
    on(MethodFilter::GET, handle_default_code_redirect)
      .fallback(redirect_to_main),
  )
}
`
  )
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  assert.deepEqual(
    inventory.surfaces
      .filter(({ kind }) => kind === "wws_route")
      .map(({ surface_id }) => surface_id),
    [
      "wws-route:FALLBACK:/{page_slug}/code",
      "wws-route:GET:/{page_slug}/code",
      "wws-route:HEAD:/{page_slug}/code"
    ]
  )
  const firstOutput = await fs.readFile(outputPath, "utf8")
  const secondResult = runCli(root, outputPath)
  assert.equal(secondResult.status, 0, secondResult.stderr)
  assert.equal(await fs.readFile(outputPath, "utf8"), firstOutput)
})

test("CLI aggregates same-path GET and any handlers into effective dispatch slots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-wws-aggregate-"))
  await writeRepositoryFixture(root)
  await writeText(
    root,
    "wws/src/route.rs",
    `pub fn build_router() {
  Router::new()
    .route("/-/file/{page_slug}/{filename}", get(handle_file_fetch))
    .route("/-/file/{page_slug}/{filename}", any(handle_invalid_method))
}
`
  )
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  assert.deepEqual(
    inventory.surfaces
      .filter(({ kind }) => kind === "wws_route")
      .map(({ surface_id }) => surface_id),
    [
      "wws-route:FALLBACK:/-/file/{page_slug}/{filename}",
      "wws-route:GET:/-/file/{page_slug}/{filename}",
      "wws-route:HEAD:/-/file/{page_slug}/{filename}"
    ]
  )
})

test("CLI preserves standalone any as one ANY dispatch surface", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-wws-any-"))
  await writeRepositoryFixture(root)
  await writeText(
    root,
    "wws/src/route.rs",
    `pub fn build_router() {
  Router::new().route("/-/health-check", any(handle_health_check))
}
`
  )
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  assert.deepEqual(
    inventory.surfaces
      .filter(({ kind }) => kind === "wws_route")
      .map(({ surface_id }) => surface_id),
    ["wws-route:ANY:/-/health-check"]
  )
})

test("CLI accepts a closed MethodFilter or-chain with a route-local fallback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-wws-filter-"))
  await writeRepositoryFixture(root)
  await writeText(
    root,
    "wws/src/route.rs",
    `pub fn build_router() {
  Router::new().route(
    "/filtered",
    on(MethodFilter::GET.or(MethodFilter::HEAD).or(MethodFilter::OPTIONS), handle_filtered)
      .fallback(handle_unmatched),
  )
}
`
  )
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  assert.deepEqual(
    inventory.surfaces
      .filter(({ kind }) => kind === "wws_route")
      .map(({ surface_id }) => surface_id),
    [
      "wws-route:FALLBACK:/filtered",
      "wws-route:GET:/filtered",
      "wws-route:HEAD:/filtered",
      "wws-route:OPTIONS:/filtered"
    ]
  )
})

test("CLI lets an explicit HEAD handler override GET's implicit HEAD surface", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-wws-head-"))
  await writeRepositoryFixture(root)
  await writeText(
    root,
    "wws/src/route.rs",
    `pub fn build_router() {
  Router::new()
    .route("/resource", get(handle_get))
    .route("/resource", head(handle_head))
}
`
  )
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  const routes = inventory.surfaces.filter(({ kind }) => kind === "wws_route")
  assert.deepEqual(routes.map(({ surface_id }) => surface_id), [
    "wws-route:GET:/resource",
    "wws-route:HEAD:/resource"
  ])
  assert.deepEqual(
    routes.find(({ surface_id }) => surface_id === "wws-route:HEAD:/resource").public_reference,
    ["wws/src/route.rs#head:/resource:handle_head"]
  )
})

test("CLI ignores route-like text in Rust comments, strings, and test-only source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-wws-lexical-"))
  await writeRepositoryFixture(root)
  await writeText(
    root,
    "wws/src/route.rs",
    `fn identity<'a>(value: &'a str) -> &'a str { value }
pub fn build_router() {
  let quote = '"';
  // .route("/comment", get(comment_handler))
  let example = ".route(\\"/string\\", any(string_handler))";
  let raw = r#".route("/raw-string", get(raw_handler))"#;
  /* .route("/block-comment", get(block_handler)) */
  Router::new().route("/production", any(handle_production))
}

#[cfg(test)]
mod tests {
  fn fixture() { Router::new().route("/test-only", get(test_handler)); }
}
`
  )
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  assert.deepEqual(
    inventory.surfaces
      .filter(({ kind }) => kind === "wws_route")
      .map(({ surface_id }) => surface_id),
    ["wws-route:ANY:/production"]
  )
})

test("CLI discovers production routes on both sides of a cfg(test) module", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-wws-cfg-test-"))
  await writeRepositoryFixture(root)
  await writeText(
    root,
    "wws/src/route.rs",
    `pub fn first_router() {
  Router::new().route("/before-tests", any(handle_before))
}

#[cfg(test)]
mod tests {
  fn fixture() {
    Router::new().route("/test-only", get(test_handler));
  }
}

pub fn second_router() {
  Router::new().route("/after-tests", get(handle_after))
}
`
  )
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 0, result.stderr)
  const inventory = JSON.parse(await fs.readFile(outputPath, "utf8"))
  assert.deepEqual(
    inventory.surfaces
      .filter(({ kind }) => kind === "wws_route")
      .map(({ surface_id }) => surface_id),
    [
      "wws-route:ANY:/before-tests",
      "wws-route:GET:/after-tests",
      "wws-route:HEAD:/after-tests"
    ]
  )
})

test("CLI fails closed for an unsupported cfg(test)-attributed item", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-wws-cfg-item-"))
  await writeRepositoryFixture(root)
  await writeText(
    root,
    "wws/src/route.rs",
    `pub fn first_router() {
  Router::new().route("/before-tests", any(handle_before))
}

#[cfg(test)]
fn fixture() {
  Router::new().route("/test-only", get(test_handler));
}

pub fn second_router() {
  Router::new().route("/after-tests", any(handle_after))
}
`
  )
  const outputPath = path.join(root, "inventory.json")

  const result = runCli(root, outputPath)

  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /wws\/src\/route\.rs contains an unsupported cfg\(test\) item/u)
  await assert.rejects(fs.access(outputPath))
})

test("CLI fails closed for unknown, service, dynamic, and malformed WWS route shapes", async () => {
  const cases = [
    ["unknown filter", 'on(MethodFilter::COPY, handler).fallback(unmatched)'],
    ["service endpoint", "service(handler)"],
    ["unknown chain", "get(handler).layer(layer)"],
    ["dynamic path", null],
    ["malformed route", null]
  ]
  for (const [name, endpoint] of cases) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-wws-closed-"))
    await writeRepositoryFixture(root)
    const declaration = name === "dynamic path"
      ? ".route(route_path, get(handler))"
      : name === "malformed route"
        ? '.route("/malformed", get(handler)'
        : `.route("/closed", ${endpoint})`
    await writeText(
      root,
      "wws/src/route.rs",
      `pub fn build_router() { Router::new()${declaration} }
`
    )
    const outputPath = path.join(root, "inventory.json")

    const result = runCli(root, outputPath)

    assert.equal(result.status, 1, `${name}: ${result.stderr}`)
    assert.match(result.stderr, /wws\/src\/route\.rs contains (?:an unsupported|an unbalanced|an unterminated) route declaration/u)
    await assert.rejects(fs.access(outputPath))
  }
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
  const serializedAudit = `${JSON.stringify(audit, null, 2)}\n`
  await fs.writeFile(auditPath, serializedAudit)
  const reconciliationPath = path.join(
    root,
    "docs/development/open43-closure-audit-ownership-reconciliation.json"
  )
  const reconciliation = JSON.parse(await fs.readFile(reconciliationPath, "utf8"))
  reconciliation.closure_audits[0].sha256 = sha256(serializedAudit)
  await fs.writeFile(reconciliationPath, `${JSON.stringify(reconciliation, null, 2)}\n`)

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

test("CLI rejects a stale Open43 audit digest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-audit-digest-"))
  await writeRepositoryFixture(root)
  await fs.appendFile(
    path.join(root, "docs/development/open43-audit-1.json"),
    "\n"
  )

  const result = runCli(root, path.join(root, "inventory.json"))

  assert.equal(result.status, 1)
  assert.match(result.stderr, /reconciliation digest does not match/u)
})

test("CLI rejects a blocked-evidence routing row outside the audit denominator", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "compatibility-routing-extra-"))
  await writeRepositoryFixture(root)
  const routingPath = path.join(root, "docs/development/open43-blocked-evidence-routing.json")
  const routing = JSON.parse(await fs.readFile(routingPath, "utf8"))
  routing.rows.push({
    case_id: "F999_NOT_IN_AUDITS",
    route_class: "anonymous_read_only",
    status: "not_attempted_not_safe",
    reason: "fixture"
  })
  routing.counts.anonymous_read_only = 1
  routing.counts.total = 1
  await fs.writeFile(routingPath, `${JSON.stringify(routing, null, 2)}\n`)

  const result = runCli(root, path.join(root, "inventory.json"))

  assert.equal(result.status, 1)
  assert.match(result.stderr, /routing rows do not exactly match blocked_evidence cases/u)
})
