#!/usr/bin/env node

import fs from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { discoverFramerailRouteDescriptors } from "../src/compatibility-inventory/framerail-routes.mjs"
import { discoverOpen43AuditCases as discoverOpen43AuditCasesFromSource } from "../src/compatibility-inventory/open43-audits.mjs"
import { discoverWwsRouteRecords } from "../src/compatibility-inventory/wws-route-parser.mjs"
import { scanRustTokens } from "../src/compatibility-inventory/rust-source.mjs"
import { extractBalanced, importedBinding, maskTypeScriptCommentsAndLiterals, objectPropertyNames, splitTopLevel } from "../src/compatibility-inventory/typescript-source.mjs"

import { CANDIDATE_CASE_SETS } from "../src/candidate-case-command.mjs"

const SCHEMA = "wikijump.compatibility_surface_inventory.v3"
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../../..")
const DEFAULT_OUTPUT = "docs/development/compatibility-surface-inventory.json"
const SEMANTICS_REGISTRY = "docs/development/compatibility-surface-semantics.json"
const SITE_CHANGES_EVIDENCE_ARTIFACT =
  "install/local/wikidot-verification/artifacts/open43-readonly-live-20260810.json"
const SITE_CHANGES_EVIDENCE_ID = "E_OPEN43_SITECHANGES_AMC_20260810"
const SITE_CHANGES_SURFACE_ID =
  "framerail-amc-module:changes/SiteChangesListModule:parameters=categoryId,options,page,pageId,perpage"
const SITE_CHANGES_EXTERNAL_ROOT =
  "/home/roku/wjlab/evidence/20260808-open87-execution/pr2-open43-readonly-live-20260809"
const SITE_CHANGES_ARTIFACT_SHA256 =
  "9c98424c2082c7989e2c09e9c9c4e8082be8d3c8e42910383b3e323095b9a410"
const SITE_CHANGES_EXTERNAL_SHA256SUMS =
  "225897681df10c1e8c307053056849990fc32ebe10e47f2ab9012685bda709ff"
const SITE_CHANGES_CASES = Object.freeze([
  ["q1035-sitechanges-page-one", "6428a591526492e12c846d0dc84219979facaa91e2dd1dd431d608bffb075b9b", "b90e04799dc2404328a3de4ef7a1a36ec32e8ea2286c076ff1256909072e2061"],
  ["q1035-sitechanges-page-two", "1a23ac1e1e2e90998fd422e72fa3591ea64ef4ab47a2483225efbc08ee49c558", "73d0f678a9389be8244eb0d17445b4435f0f757d33e20c1c0df0c73a5b82c6d4"],
  ["q1035-sitechanges-page-three", "dca8256cbae00597b16e89277bc9f1cdd450a19c82f88c4e41e774827378b2fc", "ce24924d820e1aa93c6c971ec39c7a82acc937eb0f77b744862f3da4fe6a0426"],
  ["q1035-sitechanges-page-out", "b3042ab04ed5bebbd8ef01592419d74c26fd5c12c426f5c2b5704e62f1837c1f", "5aa7e88fdae452b00e35a553ce4f1f14576df652558d9ec98ea945c07d789190"],
  ["q1035-sitechanges-source", "d398d377cf35b669e7601b27c9f030fec00e34f8d75ae5e8b5a3c4e37330c658", "ca3160a51410c23a078ee5b5fc0ce9585c74bcb4c4c69a9c4430a5c913fce060"],
  ["q1035-sitechanges-files", "0605d698fb67cabd48bcfa7e8af447e7dacf145e4ae949eeffa1cf5e23aa8657", "f147b761ef7899ae98d614d6d089f02de14c22d6adde56f27ed354411d2a2f6a"],
  ["q1035-sitechanges-empty-options", "c7f1b199ea74def438865052cba7e9955cac18c00ee85dd6e2a1b74c66eea0bc", "b90e04799dc2404328a3de4ef7a1a36ec32e8ea2286c076ff1256909072e2061"],
  ["q1035-sitechanges-missing-category", "e1eb1c324af7c73d719a3f1011cc250ec8eab03ce47bca875f064bb3ce922ef2", "f3deef67552b3e7218eba33bc354c3e1562df93ac39b21f99855035c96e5a35b"]
])
const SITE_CHANGES_ANONYMOUS_INDEX_SHA256 =
  "65b89a3fb1758a80dd20766be15d183e94e5afa9a5e0a4f3405630cd5682fa36"
const SITE_CHANGES_AUTHENTICATED_INDEX_SHA256 =
  "0ee1786699c88fe36908aa46d8347c38519e4270be638041b82e477a9426e435"
const SITE_CHANGES_FLICKR_INDEX_SHA256 =
  "8bb2b1f0c038d0ca8b5e59ac99e7e8b916c3b87c87972a430bece513561bb9ce"
const CATALOG_SOURCE_ATTRIBUTION = "docs/development/compatibility-catalog-source-attribution.json"
const CANONICAL_IMPLEMENTATION_LEDGER = "scripts/data/wikidot-implementation-ledger.json"
const DATA_FORM_SPECIFICATION_PREFIX = "docs/wikidot-specifications/specifications/data-forms/"
const MODULE_SPECIFICATION_PREFIX = "docs/wikidot-specifications/specifications/module/"
const WIKIDOT_PY_GIT_DIR = path.join(process.env.WIKIDOT_PY_CHECKOUT ?? "/home/roku/src/Rokurolize/wikidot.py", ".git")
const FTML_GIT_DIR = path.join(process.env.WIKIJUMP_FTML_CHECKOUT ?? "/home/roku/src/Rokurolize/ftml", ".git")
const GIT_EXECUTABLE = "/usr/bin/git"
const GIT_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin"
})
const WIKIDOT_PY_AMC_MODULE_EXCLUSIONS = new Set(["edit/PageEditModule"])
const SOURCE_INPUTS = new Map()
const SUPPORTED_RELATIONSHIP_EDGE_TYPES = new Set([
  "alias", "equivalence", "implemented_by", "parsed_by", "rendered_by", "tested_by"
])
const AUDITED_OWNERSHIP_REPORTS = Object.freeze([
  {
    path: "/home/roku/wjlab/ownership-mapping-20260815/catalog-feature-owners.json",
    sha256: "63537ec48261f0bb956407e7fa2889a2f33548b596d441191632319907f0f855"
  },
  {
    path: "/home/roku/wjlab/ownership-mapping-20260815/deepwell-jsonrpc.json",
    sha256: "9a55d5a726dd6696639cb1686da11440bf75bc211fbb7b48bac5575e3df4074c"
  },
  {
    path: "/home/roku/wjlab/ownership-mapping-20260815/framerail-actions.json",
    sha256: "d3b461c03d931c3397fcd345b0400fb07e8fbe8621f48cfd80dfd7f6b0ec126b"
  },
  {
    path: "/home/roku/wjlab/ownership-mapping-20260815/wws-wikidot-py.json",
    sha256: "ef87c37c9bd2ebf661d003c361f386c5d979b30aeebb18a6b44c307124f0636c"
  }
])
const AUDITED_CATALOG_SHA256 = "ce9a798b7d1d076085e634e1e61ef338fff89bb3dc797449f90f06aae4f61714"
const AUDITED_CATALOG_FALLBACK = Object.freeze({
  count: 92,
  surface_ids_sha256: "08a6222562288778e1b0eb705a0281401424f514aeb542bedbabf37a0261a95e",
  mapping_sha256: "840583979a874ed9b9189b446f39d4932cf043c1e89235db1b443c2fd3572190"
})
const AUDITED_CURRENT_CATALOG_ISSUES = Object.freeze({
  count: 195,
  surface_ids_sha256: "3a2cf09c168b37eb4539336cca7807f06585ece006a3327c2b2093b327424377",
  mapping_sha256: "3b5f692daf4475775187ac9b5a452844b2330cbadb9ea94aa92ee9c3d9319c30",
  fallback_issue: 1387,
  fallback_count: 168,
  fallback_surface_ids_sha256: "a69ba8bc0a841c3092fb6cab2b1d2efcea8044b25ddb9dcad52669db66867820",
  fallback_mapping_sha256: "9a7489f1083ef9a114f95221997194afcb6eb1b957ad36f307e309a3a3668ff7"
})
const AUDITED_ISSUE_GROUPS = Object.freeze({
  deepwell_jsonrpc_method: Object.freeze({ count: 177, surface_ids_sha256: "7d0e51714222209e2bfce3d5a8322a181b80328a9148f963883881dab10fa7fc", mapping_sha256: "f2eddb6aa0d557a8a08992cd5bf2858a831e816132495a84db3644f83d8976f2" }),
  framerail_route: Object.freeze({ count: 30, surface_ids_sha256: "15147d35e636af683d7feca934d2c2007655643f3cd2794f3b5fd4b7cc0f79af", mapping_sha256: "365bcd4a9f322dc087f89dd362b8c2497fc1c3dd51cfccdbb6f41d528abc19d7" }),
  framerail_server_action: Object.freeze({ count: 107, surface_ids_sha256: "2d24668b2c1a9c5dd03f76aeba6e4ebe40127e0570bf0b788bec5d980cefd836", mapping_sha256: "03447d40bc082d4b323530ec2abf0b57ad3906fac5ef268cb1bb344e8e9fa0fd" }),
  framerail_amc_action_shape: Object.freeze({ count: 2, surface_ids_sha256: "69e643ef40a7efffbcc2cea03dc0f864aa0fb62d51ab8fd0c6062c74af9bee49", mapping_sha256: "945b06829bdf00f44c78040b1b2a4f793bb3e67325c98a94cffee4079c008646" }),
  framerail_amc_module_shape: Object.freeze({ count: 27, surface_ids_sha256: "4f2f2705c525444287f6d2f2835903263953f78d8d2d830f46b296e139de8b13", mapping_sha256: "90c279280479e68e0227a8c4d26ececa5a74b0f0ef8937abeac548dcffc89b61" }),
  page_action: Object.freeze({ count: 25, surface_ids_sha256: "7650ecd18142446eb1c4f557ad13bc525cdd541b31dcbc982ea1f92288f0e206", mapping_sha256: "98ebacfd535793c5c4996797ea2c206f3edea85852520705b01a3f9dd03faad6" }),
  framerail_xmlrpc_method: Object.freeze({ count: 17, surface_ids_sha256: "862b1daa07ba126424e6021d306854f2c431073c024e1497a0ed5ab65b0d118d", mapping_sha256: "8862712f0d5acc1e73ff31f873d4ed8a8e7d2c01afc74ce988894e38508f9a34" }),
  wws_route: Object.freeze({ count: 50, surface_ids_sha256: "b83d044571891e697ad1a14ad5c36ce0ef034dedbb3ffca0702f7d00f0cd18b3", mapping_sha256: "b2d851904f7d8e1d9b4399a11dd954760a102142ae7f9676b29b487c63940c88" }),
  wikidot_py_amc_module_shape: Object.freeze({ count: 22, surface_ids_sha256: "4af71683f0059a07403b6cba86cb1d8961e9b9b4c1b2f3be158b2e7bd2918123", mapping_sha256: "a7cd9e3f642420977c413a97231131d38f56e0374e3440955e081b417e3ac48f" })
})
const FTML_PUBLIC_PREVIEW_TEST_FEATURES = new Set([
  "syntax-bibliography",
  "syntax-block-formatting-elements",
  "syntax-block-quotes",
  "syntax-code-blocks",
  "syntax-date",
  "syntax-definition-lists",
  "syntax-footnotes",
  "syntax-headings",
  "syntax-horizontal-rules",
  "syntax-inline-formatting",
  "syntax-lists",
  "syntax-math",
  "syntax-notes",
  "syntax-paragraphs-and-newline",
  "syntax-table-of-contents",
  "syntax-tables",
  "syntax-text-size",
  "syntax-typography",
  "syntax-universal-escaping"
])
const FTML_PUBLIC_PREVIEW_TEST =
  "deepwell/tests/page.rs#documented_ftml_owned_syntax_has_public_preview_regressions"
const DEFERRED_XMLRPC_CATALOG_FEATURES = new Set([
  "catalog-feature:api-categories-select",
  "catalog-feature:api-deleted-methods",
  "catalog-feature:api-files-get-meta",
  "catalog-feature:api-files-get-one",
  "catalog-feature:api-files-save-one",
  "catalog-feature:api-files-select",
  "catalog-feature:api-overview",
  "catalog-feature:api-pages-get-meta",
  "catalog-feature:api-pages-get-one",
  "catalog-feature:api-pages-save-one",
  "catalog-feature:api-pages-select",
  "catalog-feature:api-posts-get",
  "catalog-feature:api-posts-select",
  "catalog-feature:api-tags-select",
  "catalog-feature:api-users-get-me"
])
const FRAMERAIL_ROUTE_ISSUE_EXCEPTIONS = new Map([
  ["framerail-route:/local--favicon/{filename}", 756],
  ["framerail-route:/printer--friendly/{*path}", 777],
  ["framerail-route:/forum/c-{category}/{*name}", 1034],
  ["framerail-route:/forum/start/{*extra}", 1034],
  ["framerail-route:/forum/t-{thread}/{*name}", 1034],
  ["framerail-route:/forum/{fallback}/{*extra}", 1034]
])
const PAGE_ACTION_ISSUES = new Map([
  ["page-action:backlinks", 1027],
  ["page-action:delete", 1373],
  ["page-action:discuss", 839],
  ["page-action:edit", 775],
  ["page-action:edit-append", 1041],
  ["page-action:edit-meta", 1373],
  ["page-action:edit-sections", 1041],
  ["page-action:file-delete", 1039],
  ["page-action:file-edit", 1039],
  ["page-action:file-history", 1039],
  ["page-action:file-info", 1039],
  ["page-action:file-move", 1039],
  ["page-action:file-upload", 1062],
  ["page-action:files", 1039],
  ["page-action:history", 1063],
  ["page-action:lock", 1373],
  ["page-action:more-options", 1041],
  ["page-action:parent", 1063],
  ["page-action:print", 777],
  ["page-action:rate", 1030],
  ["page-action:rename-move", 1373],
  ["page-action:site-tools", 1041],
  ["page-action:tags", 1041],
  ["page-action:view-source", 1041],
  ["page-action:watchers", 1032]
])
const CATALOG_FEATURE_ISSUE_EXCEPTIONS = new Map([
  ["catalog-feature:avatars", 1392],
  ["catalog-feature:community-site-directory", 1508],
  ["catalog-feature:data-forms-deleting-form", 1391],
  ["catalog-feature:data-forms-file-field", 1504],
  ["catalog-feature:data-forms-images", 1504],
  ["catalog-feature:forum-signatures", 1506],
  ["catalog-feature:gravatar", 1507],
  ["catalog-feature:module-createaccount", 1505],
  ["catalog-feature:module-comments", 1034],
  ["catalog-feature:module-deleteaccount", 1505],
  ["catalog-feature:module-forumcategory", 1034],
  ["catalog-feature:module-forumnewthread", 1034],
  ["catalog-feature:module-forumstart", 1034],
  ["catalog-feature:module-forumthread", 1034],
  ["catalog-feature:module-frontforum", 1034],
  ["catalog-feature:module-frontspecialmini", 1389],
  ["catalog-feature:module-listpages", 1383],
  ["catalog-feature:module-managesite", 1038],
  ["catalog-feature:module-members", 1032],
  ["catalog-feature:module-newsite", 1505],
  ["catalog-feature:outgoing-pingbacks", 1509],
  ["catalog-feature:module-petitionadmin", 1038],
  ["catalog-feature:module-recentposts", 1034],
  ["catalog-feature:module-recentthreads", 1034],
  ["catalog-feature:module-sitechanges", 1035],
  ["catalog-feature:module-sitestagcloud", 1508],
  ["catalog-feature:web-statistics", 1510],
])

async function loadSupportedWikidotPySource(root) {
  const value = await readJson(root, "docs/development/wikidot-py-supported-source.json")
  if (value.schema !== "wikijump.wikidot_py_supported_source.v1" ||
      typeof value.repository !== "string" ||
      !/^[0-9a-f]{40}$/u.test(value.commit ?? "") ||
      !/^[0-9a-f]{40}$/u.test(value.root_tree ?? "") ||
      !Array.isArray(value.objects)) {
    throw new Error("wikidot.py supported source lock is invalid")
  }
  const objects = new Map()
  for (const object of value.objects) {
    if (!object || typeof object.path !== "string" || !["blob", "tree"].includes(object.type) ||
        !/^[0-9a-f]{40}$/u.test(object.oid ?? "") || objects.has(object.path)) {
      throw new Error("wikidot.py supported source lock object identity is invalid")
    }
    objects.set(object.path, [object.type, object.oid])
  }
  return { repository: value.repository, commit: value.commit, root_tree: value.root_tree, objects }
}

function pinnedWikidotPyAmcModules(wikidotPySource) {
  const result = spawnSync(
    GIT_EXECUTABLE,
    [
      "--no-replace-objects",
      `--git-dir=${WIKIDOT_PY_GIT_DIR}`,
      "grep",
      "-h",
      "-o",
      "-E",
      '"[A-Za-z0-9_/-]+Module"',
      wikidotPySource.commit,
      "--",
      "src/wikidot/module"
    ],
    {
      encoding: "utf8",
      env: GIT_ENVIRONMENT
    }
  )
  if (result.status !== 0) {
    throw new Error(`cannot read pinned wikidot.py modules: ${result.stderr.trim()}`)
  }
  const discovered = new Set(
    result.stdout
      .trim()
      .split("\n")
      .map((value) => value.slice(1, -1))
      .filter((value) => value.includes("/"))
  )
  for (const excluded of WIKIDOT_PY_AMC_MODULE_EXCLUSIONS) {
    if (!discovered.delete(excluded)) {
      throw new Error(`pinned wikidot.py no longer declares excluded AMC module: ${excluded}`)
    }
  }
  return [...discovered].sort()
}

function verifyPinnedWikidotPySource(wikidotPySource) {
  const identities = [
    [`${wikidotPySource.commit}^{tree}`, wikidotPySource.root_tree],
    ...[...wikidotPySource.objects].map(([objectPath, [, oid]]) => [
      `${wikidotPySource.commit}:${objectPath}`,
      oid
    ])
  ]
  for (const [revision, expected] of identities) {
    let actual
    try {
      actual = execFileSync(
        GIT_EXECUTABLE,
        ["--no-replace-objects", `--git-dir=${WIKIDOT_PY_GIT_DIR}`, "rev-parse", "--verify", revision],
        { encoding: "utf8", env: GIT_ENVIRONMENT, stdio: ["ignore", "pipe", "ignore"] }
      ).trim()
    } catch {
      throw new Error(`cannot resolve pinned wikidot.py source object: ${revision}`)
    }
    if (actual !== expected) {
      throw new Error(`pinned wikidot.py source object drift: ${revision}`)
    }
  }
}

const PHASE_STATUSES = {
  evidence: new Set(["available", "partial", "missing", "blocked"]),
  source: new Set(["implemented", "in_progress", "pending", "blocked"]),
  candidate: new Set(["passed", "failed", "pending", "blocked", "not_applicable"]),
  standing: new Set(["passed", "failed", "pending", "blocked", "not_applicable"]),
  closure: new Set(["closed", "open", "blocked"])
}
const LEDGER_STATUSES = new Set(["implemented", "in_progress", "pending", "blocked"])
const DOCUMENTATION_STATUSES = new Set([
  "documented",
  "documented-deprecated",
  "documented-negative",
  "documented-plan-capability",
  "high-level-documentation",
  "invocation-only"
])
const MISSING_PAGE_CONTROL_CONTRACTS = new Map([
  [
    "create",
    {
      operations: ["edit"],
      states: [
        "missing-page-settled",
        "editor-loading",
        "editor-settled",
        "save-loading",
        "save-success",
        "save-denial",
        "save-failure",
        "created-page-settled"
      ]
    }
  ],
  [
    "restore",
    {
      operations: ["deletedGet", "restore"],
      states: [
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
      ]
    }
  ]
])

function usage() {
  return `Usage: node ${path.basename(process.argv[1])} [--root REPOSITORY] [--output JSON] [--source-revision COMMIT]\n`
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT
  let output
  let sourceRevision
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--root") {
      root = path.resolve(requireValue(argv, ++index, "--root"))
    } else if (argument === "--output") {
      output = path.resolve(requireValue(argv, ++index, "--output"))
    } else if (argument === "--source-revision") {
      sourceRevision = requireValue(argv, ++index, "--source-revision")
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(usage())
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  const resolvedOutput = output ?? path.join(root, DEFAULT_OUTPUT)
  assertRepositoryPath(root, resolvedOutput)
  return {
    root,
    output: resolvedOutput,
    sourceRevision
  }
}

function requireValue(argv, index, option) {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`)
  return value
}

function toPosix(value) {
  return value.split(path.sep).join("/")
}

function relativeReference(root, absolutePath) {
  const relative = path.relative(root, absolutePath)
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`public reference is outside the repository: ${absolutePath}`)
  }
  return toPosix(relative)
}

function assertRepositoryPath(root, absolutePath) {
  const relative = path.relative(root, absolutePath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`public reference is outside the repository: ${absolutePath}`)
  }
}

async function readJson(root, relativePath) {
  const absolutePath = repositoryPath(root, relativePath)
  let source
  try {
    source = await fs.readFile(absolutePath, "utf8")
  } catch (error) {
    throw new Error(`cannot read ${relativePath}: ${error.message}`)
  }
  SOURCE_INPUTS.set(toPosix(relativePath), source)
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`invalid JSON in ${relativePath}: ${error.message}`)
  }
}

async function readText(root, relativePath) {
  try {
    const source = await fs.readFile(repositoryPath(root, relativePath), "utf8")
    SOURCE_INPUTS.set(toPosix(relativePath), source)
    return source
  } catch (error) {
    throw new Error(`cannot read ${relativePath}: ${error.message}`)
  }
}

function repositoryPath(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath)
  assertRepositoryPath(root, absolutePath)
  return absolutePath
}

async function writeRepositoryOutput(root, output, contents) {
  await fs.mkdir(path.dirname(output), { recursive: true })
  const rootRealPath = await fs.realpath(root)
  const parentRealPath = await fs.realpath(path.dirname(output))
  assertRepositoryPath(rootRealPath, parentRealPath)
  try {
    if ((await fs.lstat(output)).isSymbolicLink()) {
      throw new Error(`output must not be a symbolic link: ${output}`)
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const handle = await fs.open(
    output,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW
  )
  try {
    await handle.writeFile(contents)
  } finally {
    await handle.close()
  }
}

async function readAbsoluteText(root, absolutePath) {
  return readText(root, relativeReference(root, absolutePath))
}

function phase(status, references = []) {
  return { status, references: uniqueSortedStrings(references) }
}

function surface({
  surfaceId,
  kind,
  publicOwner,
  publicReference,
  issues = [],
  cases = [],
  tests = [],
  evidence = phase("missing"),
  source = phase("implemented"),
  candidate = phase("pending"),
  standing = phase("pending"),
  closure = phase("open"),
  implementationOwnerRecords = []
}) {
  return {
    surface_id: surfaceId,
    kind,
    public_owner: publicOwner,
    public_reference: uniqueSortedStrings(publicReference),
    existing_refs: {
      issues: [...new Set(issues)].sort((left, right) => left - right),
      cases: uniqueSortedStrings(cases),
      tests: uniqueSortedStrings(tests)
    },
    evidence,
    source,
    candidate,
    standing,
    closure,
    implementation_owner_records: implementationOwnerRecords
  }
}

function uniqueSortedStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value !== ""))].sort()
}

function auditedLinesSha256(lines) {
  return sha256(`${[...lines].sort().join("\n")}\n`)
}

function assertExactKeys(value, expected, context) {
  const actual = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : []
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${context} has missing or extra keys`)
  }
}

function assertCanonicalStrings(values, context) {
  if (!Array.isArray(values) || JSON.stringify(values) !== JSON.stringify(uniqueSortedStrings(values))) {
    throw new Error(`${context} must be a sorted unique string array`)
  }
}

function validateSemanticsRegistry(semantics) {
  assertExactKeys(semantics, [
    "schema",
    "ftml",
    "relationship_edge_types",
    "specification_owner_by_kind",
    "implementation_owners_by_legacy_owner",
    "specification_owner_keys",
    "implementation_owner_keys"
  ], SEMANTICS_REGISTRY)
  if (semantics.schema !== "wikijump.compatibility_surface_semantics.v1") {
    throw new Error(`${SEMANTICS_REGISTRY} has unknown schema`)
  }
  assertExactKeys(semantics.ftml, [
    "counts", "raw_surface_identities", "catalog_crosswalk"
  ], `${SEMANTICS_REGISTRY} ftml`)
  assertExactKeys(semantics.ftml.counts, [
    "lexer_rules", "parser_functions", "canonical_blocks", "block_aliases",
    "typed_modules", "ast_variants", "delayed_forms", "generated_runtime_kinds",
    "renderer_modules", "wikidot_fixtures", "total"
  ], `${SEMANTICS_REGISTRY} FTML counts`)
  if (!Array.isArray(semantics.ftml.raw_surface_identities)) {
    throw new Error(`${SEMANTICS_REGISTRY} has no FTML identities`)
  }
  for (const identity of semantics.ftml.raw_surface_identities) {
    assertExactKeys(identity, ["surface_id", "kind"], `${SEMANTICS_REGISTRY} FTML identity`)
  }
  const sortedIdentities = [...semantics.ftml.raw_surface_identities].sort((left, right) =>
    left.surface_id.localeCompare(right.surface_id, "en")
  )
  if (
    new Set(semantics.ftml.raw_surface_identities.map(({ surface_id: id }) => id)).size !==
      semantics.ftml.raw_surface_identities.length ||
    JSON.stringify(sortedIdentities) !== JSON.stringify(semantics.ftml.raw_surface_identities)
  ) {
    throw new Error(`${SEMANTICS_REGISTRY} FTML identities must be sorted and unique`)
  }
  if (!Array.isArray(semantics.ftml.catalog_crosswalk)) {
    throw new Error(`${SEMANTICS_REGISTRY} has no FTML crosswalk`)
  }
  for (const row of semantics.ftml.catalog_crosswalk) {
    assertExactKeys(row, [
      "feature_id", "parsed_by", "rendered_by", "tested_by", "ftml_surfaces", "runtime_owner"
    ], `${SEMANTICS_REGISTRY} FTML crosswalk row`)
    for (const field of ["parsed_by", "rendered_by", "tested_by", "ftml_surfaces"]) {
      assertCanonicalStrings(row[field], `${SEMANTICS_REGISTRY} ${row.feature_id} ${field}`)
    }
  }
  const crosswalkIds = semantics.ftml.catalog_crosswalk.map(({ feature_id: id }) => id)
  if (JSON.stringify(crosswalkIds) !== JSON.stringify(uniqueSortedStrings(crosswalkIds))) {
    throw new Error(`${SEMANTICS_REGISTRY} FTML crosswalk rows must be sorted and unique`)
  }
  assertCanonicalStrings(semantics.relationship_edge_types, `${SEMANTICS_REGISTRY} edge types`)
  assertCanonicalStrings(semantics.specification_owner_keys, `${SEMANTICS_REGISTRY} specification owners`)
  assertCanonicalStrings(semantics.implementation_owner_keys, `${SEMANTICS_REGISTRY} implementation owners`)
  if (
    !semantics.specification_owner_by_kind ||
    typeof semantics.specification_owner_by_kind !== "object" ||
    Array.isArray(semantics.specification_owner_by_kind) ||
    !semantics.implementation_owners_by_legacy_owner ||
    typeof semantics.implementation_owners_by_legacy_owner !== "object" ||
    Array.isArray(semantics.implementation_owners_by_legacy_owner)
  ) {
    throw new Error(`${SEMANTICS_REGISTRY} owner maps must be objects`)
  }
}

function isCanonicalRepositoryReference(reference) {
  if (typeof reference !== "string" || reference === "" || reference.trim() !== reference) {
    return false
  }
  const fragmentIndex = reference.indexOf("#")
  const referencePath = fragmentIndex < 0 ? reference : reference.slice(0, fragmentIndex)
  const fragment = fragmentIndex < 0 ? null : reference.slice(fragmentIndex + 1)
  const normalizedPath = toPosix(path.normalize(referencePath))
  return (
    referencePath !== "" &&
    !path.isAbsolute(referencePath) &&
    normalizedPath === referencePath &&
    normalizedPath !== "." &&
    normalizedPath !== ".." &&
    !normalizedPath.startsWith("../") &&
    fragment !== ""
  )
}

function validatedBrowserIntervalProof(proof, registryPath, controlId) {
  if (!proof || Array.isArray(proof) || typeof proof !== "object") {
    throw new Error(`${registryPath} ${controlId} has invalid browser_interval_proof`)
  }
  const keys = Object.keys(proof).sort()
  if (proof.status === "missing") {
    if (
      JSON.stringify(keys) !== JSON.stringify(["issue", "status"]) ||
      !Number.isInteger(proof.issue) ||
      proof.issue <= 0
    ) {
      throw new Error(`${registryPath} ${controlId} has invalid browser_interval_proof`)
    }
    return { status: "missing", issue: proof.issue }
  }
  if (proof.status === "available") {
    const references = proof.references
    if (
      JSON.stringify(keys) !== JSON.stringify(["references", "status"]) ||
      !Array.isArray(references) ||
      references.length === 0 ||
      references.some((reference) => !isCanonicalRepositoryReference(reference)) ||
      JSON.stringify(references) !== JSON.stringify(uniqueSortedStrings(references))
    ) {
      throw new Error(`${registryPath} ${controlId} has invalid browser_interval_proof`)
    }
    return { status: "available", references: [...references] }
  }
  throw new Error(`${registryPath} ${controlId} has invalid browser_interval_proof`)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function gitBlobOid(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex")
}

function sourceInputSetSha256(registries) {
  return sha256(
    JSON.stringify(
      registries.map(({ path: registryPath, sha256: digest }) => [registryPath, digest])
    )
  )
}

function resolveGitObject(gitArguments, revision, label) {
  let value
  try {
    value = execFileSync(
      GIT_EXECUTABLE,
      ["--no-replace-objects", ...gitArguments, "rev-parse", "--verify", revision],
      { encoding: "utf8", env: GIT_ENVIRONMENT, stdio: ["ignore", "pipe", "ignore"] }
    ).trim()
  } catch {
    throw new Error(`cannot resolve ${label}: ${revision}`)
  }
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} is not a Git object`)
  return value
}

async function sourceProvenance(root, sourceRevision) {
  const manifestPath = "deepwell/Cargo.toml"
  const lockPath = "deepwell/Cargo.lock"
  const [manifest, lock] = await Promise.all([
    readText(root, manifestPath),
    readText(root, lockPath)
  ])
  const manifestRevision = /ftml\s*=\s*\{[^\n]*\brev\s*=\s*"([0-9a-f]{40})"/u.exec(manifest)?.[1]
  const lockRevision = /git\+https:\/\/github\.com\/Rokurolize\/ftml\?rev=([0-9a-f]{40})#([0-9a-f]{40})/u.exec(lock)
  if (!manifestRevision || !lockRevision || lockRevision[1] !== manifestRevision || lockRevision[2] !== manifestRevision) {
    throw new Error("Deepwell FTML manifest and lock identities do not match")
  }
  let wikijump = null
  if (sourceRevision !== null) {
    if (!/^[0-9a-f]{40}$/u.test(sourceRevision ?? "")) {
      throw new Error("Wikijump source revision must be an exact commit")
    }
    const wikijumpCommit = resolveGitObject(
      ["-C", root],
      `${sourceRevision}^{commit}`,
      "Wikijump commit"
    )
    if (wikijumpCommit !== sourceRevision) {
      throw new Error("Wikijump source revision does not resolve to itself")
    }
    wikijump = {
      commit: wikijumpCommit,
      tree: resolveGitObject(["-C", root], `${wikijumpCommit}^{tree}`, "Wikijump tree")
    }
  }
  const ftmlCommit = resolveGitObject(
    [`--git-dir=${FTML_GIT_DIR}`],
    `${manifestRevision}^{commit}`,
    "FTML commit"
  )
  const ftmlTree = resolveGitObject(
    [`--git-dir=${FTML_GIT_DIR}`],
    `${ftmlCommit}^{tree}`,
    "FTML tree"
  )
  return {
    wikijump,
    ftml: { commit: ftmlCommit, tree: ftmlTree }
  }
}

function parseGitLsTree(output, label) {
  const entries = new Map()
  for (const row of output.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d+) ([a-z]+) ([0-9a-f]{40})\t(.+)$/u.exec(row)
    if (!match || match[2] !== "blob") continue
    const [, , , oid, objectPath] = match
    if (entries.has(objectPath)) throw new Error(`${label} contains duplicate path: ${objectPath}`)
    entries.set(objectPath, oid)
  }
  return entries
}

function listGitTreeBlobs(gitArguments, revision, label) {
  const listing = spawnSync(
    GIT_EXECUTABLE,
    ["--no-replace-objects", ...gitArguments, "ls-tree", "-r", "-z", revision],
    {
      env: GIT_ENVIRONMENT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    }
  )
  if (listing.status !== 0 || listing.error) {
    throw new Error(`cannot list ${label}: ${listing.error?.message ?? listing.stderr?.toString("utf8").trim() ?? "unknown error"}`)
  }
  return parseGitLsTree(listing.stdout, label)
}

function readGitBlobBatch(gitArguments, requests, label) {
  if (requests.length === 0) return new Map()
  const child = spawnSync(
    GIT_EXECUTABLE,
    ["--no-replace-objects", ...gitArguments, "cat-file", "--batch"],
    {
      input: `${requests.map(({ oid }) => oid).join("\n")}\n`,
      env: GIT_ENVIRONMENT,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"]
    }
  )
  if (child.status !== 0 || child.error) {
    const detail = child.error?.message ?? child.stderr?.toString("utf8").trim() ?? "unknown error"
    throw new Error(`cannot read ${label}: ${detail}`)
  }
  const output = child.stdout
  const result = new Map()
  let offset = 0
  for (const request of requests) {
    const newline = output.indexOf(0x0a, offset)
    if (newline < 0) throw new Error(`${label} batch response ended before ${request.path}`)
    const header = output.subarray(offset, newline).toString("utf8")
    const match = /^([0-9a-f]{40}) blob (\d+)$/u.exec(header)
    if (!match || match[1] !== request.oid) {
      throw new Error(`${label} batch identity drift for ${request.path}`)
    }
    const size = Number(match[2])
    const start = newline + 1
    const end = start + size
    if (!Number.isSafeInteger(size) || end >= output.length || output[end] !== 0x0a) {
      throw new Error(`${label} batch payload is truncated for ${request.path}`)
    }
    result.set(request.path, Buffer.from(output.subarray(start, end)))
    offset = end + 1
  }
  if (offset !== output.length) throw new Error(`${label} batch response has trailing bytes`)
  return result
}

function readGitSpecBatch(gitArguments, specs, label) {
  const uniqueSpecs = [...new Set(specs)]
  if (uniqueSpecs.length === 0) return new Map()
  const child = spawnSync(
    GIT_EXECUTABLE,
    ["--no-replace-objects", ...gitArguments, "cat-file", "--batch"],
    {
      input: `${uniqueSpecs.join("\n")}\n`,
      env: GIT_ENVIRONMENT,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"]
    }
  )
  if (child.status !== 0 || child.error) {
    const detail = child.error?.message ?? child.stderr?.toString("utf8").trim() ?? "unknown error"
    throw new Error(`cannot read ${label}: ${detail}`)
  }
  const output = child.stdout
  const result = new Map()
  let offset = 0
  for (const spec of uniqueSpecs) {
    const newline = output.indexOf(0x0a, offset)
    if (newline < 0) throw new Error(`${label} batch response ended before ${spec}`)
    const header = output.subarray(offset, newline).toString("utf8")
    if (header === `${spec} missing`) throw new Error(`${label} is missing ${spec}`)
    const match = /^([0-9a-f]{40}) ([a-z]+) (\d+)$/u.exec(header)
    if (!match || match[2] !== "blob") throw new Error(`${label} is not a blob: ${spec}`)
    const size = Number(match[3])
    const start = newline + 1
    const end = start + size
    if (!Number.isSafeInteger(size) || end >= output.length || output[end] !== 0x0a) {
      throw new Error(`${label} batch payload is truncated for ${spec}`)
    }
    result.set(spec, Buffer.from(output.subarray(start, end)))
    offset = end + 1
  }
  if (offset !== output.length) throw new Error(`${label} batch response has trailing bytes`)
  return result
}

function verifyRegistryBlobs(root, sourceRevision) {
  if (sourceRevision === null) return
  const tree = listGitTreeBlobs(["-C", root], sourceRevision, "pinned Wikijump tree")
  const requests = [...SOURCE_INPUTS.keys()].map((registryPath) => {
    const oid = tree.get(registryPath)
    if (!oid) throw new Error(`registry is missing from pinned revision: ${registryPath}`)
    return { path: registryPath, oid }
  })
  const blobs = readGitBlobBatch(["-C", root], requests, "pinned Wikijump registries")
  for (const [registryPath, source] of SOURCE_INPUTS) {
    if (sha256(blobs.get(registryPath)) !== sha256(source)) {
      throw new Error(`registry blob drift: ${registryPath}`)
    }
  }
}

function loadFtmlSnapshot(revision) {
  const tree = listGitTreeBlobs([`--git-dir=${FTML_GIT_DIR}`], revision, "pinned FTML tree")
  const moduleRoot = "src/parsing/rule/impls/block/blocks/module/modules/"
  const rendererRoot = "src/render/html/element/"
  const fixedPaths = new Set([
    "src/parsing/lexer.pest",
    "src/preproc/parser_functions/mod.rs",
    "conf/blocks.toml",
    "src/tree/element/object.rs",
    "src/delayed.rs",
    "src/render/html/element/mod.rs"
  ])
  const selected = [...tree.entries()]
    .filter(([objectPath]) =>
      fixedPaths.has(objectPath) ||
      (objectPath.startsWith(moduleRoot) && objectPath.endsWith(".rs") && !objectPath.endsWith("/mod.rs")) ||
      (objectPath.startsWith(rendererRoot) && objectPath.endsWith(".rs")) ||
      (objectPath.startsWith("test/") && objectPath.endsWith("/wikidot.html"))
    )
    .map(([path, oid]) => ({ path, oid }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"))
  for (const objectPath of fixedPaths) {
    if (!tree.has(objectPath)) throw new Error(`cannot read pinned FTML source: ${objectPath}`)
  }
  const blobs = readGitBlobBatch([`--git-dir=${FTML_GIT_DIR}`], selected, "pinned FTML source")
  const read = (objectPath, sources) => {
    const bytes = blobs.get(objectPath)
    const blob = tree.get(objectPath)
    if (!bytes || !blob) throw new Error(`cannot read pinned FTML source: ${objectPath}`)
    sources.set(objectPath, { path: objectPath, blob, sha256: sha256(bytes) })
    return bytes.toString("utf8")
  }
  const list = (prefix) => [...tree.keys()].filter((objectPath) => objectPath.startsWith(`${prefix}/`) || objectPath === prefix)
  return { read, list }
}

function rustEnumVariants(source, enumName, sourcePath) {
  const tokens = scanRustTokens(source, sourcePath)
  const enumIndex = tokens.findIndex(
    (token, index) => token.value === "enum" && tokens[index + 1]?.value === enumName
  )
  const start = tokens.findIndex((token, index) => index > enumIndex && token.value === "{")
  if (enumIndex < 0 || start < 0) throw new Error(`${sourcePath} has no ${enumName} enum`)
  const variants = []
  const depth = { "{": 1, "(": 0, "[": 0 }
  const closing = { "}": "{", ")": "(", "]": "[" }
  let expectVariant = true
  for (let index = start + 1; index < tokens.length && depth["{"] > 0; index += 1) {
    const token = tokens[index]
    if (token.value in depth) depth[token.value] += 1
    else if (token.value in closing) depth[closing[token.value]] -= 1
    else if (depth["{"] === 1 && depth["("] === 0 && depth["["] === 0 && token.value === ",") {
      expectVariant = true
    } else if (
      depth["{"] === 1 &&
      depth["("] === 0 &&
      depth["["] === 0 &&
      expectVariant &&
      token.kind === "identifier"
    ) {
      variants.push(token.value)
      expectVariant = false
    }
  }
  if (new Set(variants).size !== variants.length) {
    throw new Error(`${sourcePath} has duplicate ${enumName} variants`)
  }
  return variants
}

function ftmlRecord(surfaceId, kind, name, sourcePath, extra = {}) {
  return {
    surface_id: surfaceId,
    kind,
    name,
    source_reference: sourcePath,
    ...extra
  }
}

function buildFtmlCrosswalk(catalog, recordIds, semantics) {
  const nominated = catalog.features
    .filter((feature) =>
      (feature.suggested_tdd_seams ?? []).some((seam) => seam.includes("FTML public parse/render"))
    )
    .map(({ id }) => id)
    .sort()
  const rows = semantics.ftml?.catalog_crosswalk
  if (!Array.isArray(rows)) throw new Error(`${SEMANTICS_REGISTRY} has no FTML catalog crosswalk`)
  const featureIds = rows.map(({ feature_id: featureId }) => featureId)
  if (
    new Set(featureIds).size !== featureIds.length ||
    JSON.stringify([...featureIds].sort()) !== JSON.stringify(nominated)
  ) {
    throw new Error(`${SEMANTICS_REGISTRY} FTML crosswalk does not exactly match Catalog nominations`)
  }
  for (const row of rows) {
    const fields = ["parsed_by", "rendered_by", "tested_by"]
    if (fields.some((field) => !Array.isArray(row[field]))) {
      throw new Error(`${SEMANTICS_REGISTRY} has malformed FTML crosswalk row: ${row.feature_id}`)
    }
    const ftmlSurfaces = uniqueSortedStrings(fields.flatMap((field) => row[field]))
    if (JSON.stringify(ftmlSurfaces) !== JSON.stringify(row.ftml_surfaces)) {
      throw new Error(`${SEMANTICS_REGISTRY} has inconsistent FTML crosswalk row: ${row.feature_id}`)
    }
    for (const surfaceId of ftmlSurfaces) {
      if (!recordIds.has(surfaceId)) throw new Error(`${row.feature_id} links unknown FTML surface: ${surfaceId}`)
    }
    if (
      row.runtime_owner !== null &&
      row.runtime_owner !== `wikijump.runtime:${row.feature_id}`
    ) {
      throw new Error(`${SEMANTICS_REGISTRY} has invalid runtime owner: ${row.feature_id}`)
    }
  }
  return rows.map((row) => ({ ...row }))
}

function discoverFtmlRawSurfaceManifest(ftmlSource, catalog, semantics) {
  const revision = ftmlSource.commit
  const snapshot = loadFtmlSnapshot(revision)
  const sources = new Map()
  const records = []
  const add = (record) => records.push(record)

  const lexerPath = "src/parsing/lexer.pest"
  const lexer = snapshot.read(lexerPath, sources)
  for (const name of [...lexer.matchAll(/^([a-z_][a-z0-9_]*)\s*=/gmu)].map((match) => match[1])) {
    add(ftmlRecord(`ftml.tokenizer:${name}`, "lexer_rule", name, lexerPath))
  }

  const parserFunctionsPath = "src/preproc/parser_functions/mod.rs"
  const parserFunctions = snapshot.read(parserFunctionsPath, sources)
  for (const name of [...parserFunctions.matchAll(/^\s*"(if|ifexpr|expr)"\s*=>\s*ParserFunctionKind::/gmu)].map((match) => `#${match[1]}`)) {
    add(ftmlRecord(`ftml.preprocessor:${name}`, "parser_function", name, parserFunctionsPath))
  }

  const blocksPath = "conf/blocks.toml"
  const blocks = snapshot.read(blocksPath, sources)
  const sections = [...blocks.matchAll(/^\[([a-z0-9-]+)\]$/gmu)]
  for (const [index, section] of sections.entries()) {
    const name = section[1]
    add(ftmlRecord(`ftml.block:${name}`, "canonical_block", name, blocksPath))
    const end = sections[index + 1]?.index ?? blocks.length
    const aliases = /^aliases\s*=\s*(\[[^\n]*\])/mu.exec(blocks.slice(section.index, end))
    for (const alias of aliases ? JSON.parse(aliases[1]) : []) {
      add(ftmlRecord(`ftml.block-alias:${alias}->${name}`, "block_alias", alias, blocksPath, {
        canonical_surface: `ftml.block:${name}`
      }))
    }
  }

  const moduleRoot = "src/parsing/rule/impls/block/blocks/module/modules"
  for (const modulePath of snapshot.list(moduleRoot).filter((value) => value.endsWith(".rs") && !value.endsWith("/mod.rs"))) {
    const moduleSource = snapshot.read(modulePath, sources)
    const name = /accepts_names:\s*&\["([A-Za-z]+)"\]/u.exec(moduleSource)?.[1]
    if (!name) throw new Error(`${modulePath} has no typed module name`)
    add(ftmlRecord(`ftml.module:${name}`, "typed_module", name, modulePath))
  }

  const astPath = "src/tree/element/object.rs"
  const ast = snapshot.read(astPath, sources)
  for (const name of rustEnumVariants(ast, "Element", astPath)) {
    add(ftmlRecord(`ftml.ast:${name}`, "ast_variant", name, astPath))
  }

  const delayedPath = "src/delayed.rs"
  const delayed = snapshot.read(delayedPath, sources)
  for (const name of rustEnumVariants(delayed, "DelayedNode", delayedPath)) {
    add(ftmlRecord(`ftml.delayed:${name}`, "delayed_form", name, delayedPath))
  }
  for (const name of rustEnumVariants(delayed, "GeneratedKind", delayedPath)) {
    add(ftmlRecord(`ftml.generated:${name}`, "generated_runtime_kind", name, delayedPath))
  }

  const rendererRoot = "src/render/html/element"
  const rendererIndexPath = `${rendererRoot}/mod.rs`
  const rendererIndex = snapshot.read(rendererIndexPath, sources)
  add(ftmlRecord("ftml.renderer:dispatcher", "renderer_module", "dispatcher", rendererIndexPath))
  for (const name of [...rendererIndex.matchAll(/^mod\s+([a-z_]+);$/gmu)].map((match) => match[1])) {
    const rendererPath = `${rendererRoot}/${name}.rs`
    snapshot.read(rendererPath, sources)
    add(ftmlRecord(`ftml.renderer:${name}`, "renderer_module", name, rendererPath))
  }

  for (const fixturePath of snapshot.list("test").filter((value) => value.endsWith("/wikidot.html"))) {
    snapshot.read(fixturePath, sources)
    const name = fixturePath.slice(0, -"/wikidot.html".length)
    add(ftmlRecord(`ftml.fixture:${name}`, "wikidot_fixture", name, fixturePath))
  }

  const identifiers = records.map(({ surface_id: surfaceId }) => surfaceId)
  if (new Set(identifiers).size !== identifiers.length) throw new Error("duplicate FTML raw surface")
  const counts = {
    lexer_rules: records.filter(({ kind }) => kind === "lexer_rule").length,
    parser_functions: records.filter(({ kind }) => kind === "parser_function").length,
    canonical_blocks: records.filter(({ kind }) => kind === "canonical_block").length,
    block_aliases: records.filter(({ kind }) => kind === "block_alias").length,
    typed_modules: records.filter(({ kind }) => kind === "typed_module").length,
    ast_variants: records.filter(({ kind }) => kind === "ast_variant").length,
    delayed_forms: records.filter(({ kind }) => kind === "delayed_form").length,
    generated_runtime_kinds: records.filter(({ kind }) => kind === "generated_runtime_kind").length,
    renderer_modules: records.filter(({ kind }) => kind === "renderer_module").length,
    wikidot_fixtures: records.filter(({ kind }) => kind === "wikidot_fixture").length,
    total: records.length
  }
  if (JSON.stringify(counts) !== JSON.stringify(semantics.ftml?.counts)) {
    throw new Error(`pinned FTML raw surface denominator drift: ${JSON.stringify(counts)}`)
  }
  const identities = records
    .map(({ surface_id: surfaceId, kind }) => ({ surface_id: surfaceId, kind }))
    .sort((left, right) => left.surface_id.localeCompare(right.surface_id, "en"))
  const expectedIdentities = semantics.ftml?.raw_surface_identities
  if (
    !Array.isArray(expectedIdentities) ||
    JSON.stringify(identities) !== JSON.stringify(expectedIdentities)
  ) {
    throw new Error("pinned FTML raw surface identities drift")
  }
  const recordIds = new Set(identifiers)
  return {
    schema: "wikijump.ftml_raw_surface_manifest.v1",
    source: { ...ftmlSource },
    registries: [...sources.values()].sort((left, right) => left.path.localeCompare(right.path, "en")),
    counts,
    records: records.sort((left, right) => left.surface_id.localeCompare(right.surface_id, "en")),
    catalog_crosswalk: buildFtmlCrosswalk(catalog, recordIds, semantics)
  }
}

function testReferences(tests) {
  if (!Array.isArray(tests)) return []
  return tests.flatMap((entry) => {
    if (typeof entry === "string") return [entry]
    if (!entry || typeof entry !== "object") return []
    if (typeof entry.path !== "string") return []
    return [typeof entry.name === "string" ? `${entry.path}#${entry.name}` : entry.path]
  })
}

async function validateCatalogOwnerRecords(root, featureId, ledgerEntry, ownerManifest, ledgerPath) {
  assertExactKeys(ownerManifest, ["issue_scope", "owners"], `${ledgerPath} ${featureId}`)
  assertExactKeys(ownerManifest.issue_scope, ["status", "references"], `${ledgerPath} ${featureId} issue_scope`)
  if (!(ownerManifest.issue_scope.status === "resolved" || ownerManifest.issue_scope.status === "unresolved")) {
    throw new Error(`${ledgerPath} ${featureId} has an unknown issue scope status`)
  }
  const issueReferences = ownerManifest.issue_scope.references
  if (
    !Array.isArray(issueReferences) ||
    JSON.stringify(issueReferences) !== JSON.stringify([...new Set(issueReferences)].sort((left, right) => left - right)) ||
    issueReferences.some((issue) => !Number.isSafeInteger(issue) || issue <= 0) ||
    (ownerManifest.issue_scope.status === "unresolved" && issueReferences.length !== 0) ||
    (ownerManifest.issue_scope.status === "resolved" && issueReferences.length === 0)
  ) {
    throw new Error(`${ledgerPath} ${featureId} has invalid issue scope references`)
  }
  if (!Array.isArray(ownerManifest.owners)) {
    throw new Error(`${ledgerPath} ${featureId} owners must be an array`)
  }
  const sourceReferences = new Set(ledgerEntry.implementation_files ?? [])
  const testReferenceSet = new Set(testReferences(ledgerEntry.tests))
  const owners = new Set()
  for (const ownerRecord of ownerManifest.owners) {
    assertExactKeys(ownerRecord, ["owner", "source_references", "test_references"], `${ledgerPath} ${featureId} owner`)
    if (typeof ownerRecord.owner !== "string" || ownerRecord.owner === "" || owners.has(ownerRecord.owner)) {
      throw new Error(`${ledgerPath} ${featureId} has a missing or duplicate owner`)
    }
    owners.add(ownerRecord.owner)
    assertCanonicalStrings(ownerRecord.source_references, `${ledgerPath} ${featureId} ${ownerRecord.owner} source_references`)
    assertCanonicalStrings(ownerRecord.test_references, `${ledgerPath} ${featureId} ${ownerRecord.owner} test_references`)
    if (ownerRecord.source_references.length === 0 || ownerRecord.test_references.length === 0) {
      throw new Error(`${ledgerPath} ${featureId} ${ownerRecord.owner} must cite source and test identities`)
    }
    for (const sourceReference of ownerRecord.source_references) {
      if (!sourceReferences.has(sourceReference)) {
        throw new Error(`${ledgerPath} ${featureId} ${ownerRecord.owner} cites an unlisted source: ${sourceReference}`)
      }
      try {
        await fs.access(path.join(root, sourceReference))
      } catch {
        throw new Error(`${ledgerPath} ${featureId} cites a missing source: ${sourceReference}`)
      }
    }
    for (const testReference of ownerRecord.test_references) {
      if (!testReferenceSet.has(testReference)) {
        throw new Error(`${ledgerPath} ${featureId} ${ownerRecord.owner} cites an unlisted test: ${testReference}`)
      }
      for (const testPath of testReference.split("; ")
        .map((reference) => reference.split(/#|::/u, 1)[0])
        .filter((reference, index) => index === 0 || reference.includes("/"))) {
        try {
          await fs.access(path.join(root, testPath))
        } catch {
          throw new Error(`${ledgerPath} ${featureId} cites a missing test: ${testPath}`)
        }
      }
    }
  }
  return ownerManifest
}

async function discoverCatalogFeatures(root) {
  const catalogPath = "docs/wikidot-specifications/catalog.json"
  const ledgerPath = "docs/wikidot-specifications/implementation-ledger.json"
  const observationsPath = "docs/wikidot-specifications/live-observations.json"
  const coveragePath = "docs/wikidot-specifications/source-coverage.json"
  const [catalog, mirrorLedger, canonicalLedger, liveObservations, sourceCoverage] = await Promise.all([
    readJson(root, catalogPath),
    readJson(root, ledgerPath),
    readJson(root, CANONICAL_IMPLEMENTATION_LEDGER),
    readJson(root, observationsPath),
    readJson(root, coveragePath)
  ])
  if (SOURCE_INPUTS.get(ledgerPath) !== SOURCE_INPUTS.get(CANONICAL_IMPLEMENTATION_LEDGER)) {
    throw new Error(`${CANONICAL_IMPLEMENTATION_LEDGER} and ${ledgerPath} must be byte-identical`)
  }
  const ledger = canonicalLedger
  if (ledger.catalog_sha256 !== sha256(SOURCE_INPUTS.get(catalogPath))) {
    throw new Error(`${CANONICAL_IMPLEMENTATION_LEDGER} catalog_sha256 does not match ${catalogPath}`)
  }
  if (!Array.isArray(catalog.features)) throw new Error(`${catalogPath} features must be an array`)
  if (catalog.feature_count !== undefined && catalog.feature_count !== catalog.features.length) {
    throw new Error(`${catalogPath} feature_count does not match its feature denominator`)
  }
  if (!ledger.features || Array.isArray(ledger.features) || typeof ledger.features !== "object") {
    throw new Error(`${CANONICAL_IMPLEMENTATION_LEDGER} features must be an object`)
  }
  if (!Array.isArray(liveObservations.observations)) {
    throw new Error(`${observationsPath} observations must be an array`)
  }
  if (!Array.isArray(sourceCoverage.pages)) {
    throw new Error(`${coveragePath} pages must be an array`)
  }

  const ownerFeaturePrefixes = [
    DATA_FORM_SPECIFICATION_PREFIX,
    MODULE_SPECIFICATION_PREFIX,
    "docs/wikidot-specifications/specifications/site-structure/"
  ]
  const ownerFeatures = catalog.features.filter(({ specification }) =>
    ownerFeaturePrefixes.some((prefix) =>
      path.posix.join("docs/wikidot-specifications", specification).startsWith(prefix)
    )
  )
  const ownerManifests = ledger.implementation_owner_records ?? {}
  const ownerManifestIds = Object.keys(ownerManifests).sort()
  const ownerFeatureIds = ownerFeatures.map(({ id }) => id).sort()
  if (JSON.stringify(ownerManifestIds) !== JSON.stringify(ownerFeatureIds)) {
    throw new Error(`${CANONICAL_IMPLEMENTATION_LEDGER} implementation_owner_records must exactly cover owned catalog groups`)
  }

  const catalogIds = new Set()
  const records = []
  for (const feature of catalog.features) {
    if (!feature || typeof feature.id !== "string" || feature.id === "") {
      throw new Error(`${catalogPath} contains a feature without an id`)
    }
    if (catalogIds.has(feature.id)) throw new Error(`duplicate catalog feature: ${feature.id}`)
    catalogIds.add(feature.id)
    if (!DOCUMENTATION_STATUSES.has(feature.documentation_status)) {
      throw new Error(
        `unknown documentation status for ${feature.id}: ${feature.documentation_status}`
      )
    }
    if (typeof feature.specification !== "string" || feature.specification === "") {
      throw new Error(`missing public reference for catalog feature: ${feature.id}`)
    }
    const ledgerEntry = ledger.features[feature.id]
    if (!ledgerEntry) throw new Error(`catalog feature has no ledger entry: ${feature.id}`)
    if (!LEDGER_STATUSES.has(ledgerEntry.status)) {
      throw new Error(`unknown ledger status for ${feature.id}: ${ledgerEntry.status}`)
    }
    const specification = path.posix.join("docs/wikidot-specifications", feature.specification)
    const documentationEvidence = (ledgerEntry.documentation_evidence ?? []).map((entry) =>
      entry.startsWith("docs/")
        ? entry
        : path.posix.join("docs/wikidot-specifications", entry)
    )
    const ownerManifest = ownerFeaturePrefixes.some((prefix) => specification.startsWith(prefix))
      ? await validateCatalogOwnerRecords(
        root,
        feature.id,
        ledgerEntry,
        ownerManifests[feature.id],
        CANONICAL_IMPLEMENTATION_LEDGER
      )
      : null
    records.push(
      surface({
        surfaceId: `catalog-feature:${feature.id}`,
        kind: "catalog_feature",
        publicOwner: "docs/wikidot-specifications",
        publicReference: [specification],
        issues: ownerManifest?.issue_scope.references ?? [],
        tests: testReferences(ledgerEntry.tests),
        evidence: phase("available", [specification, ...documentationEvidence, ...(ledgerEntry.live_oracle_evidence ?? [])]),
        source: phase(ledgerEntry.status, ledgerEntry.implementation_files ?? []),
        implementationOwnerRecords: ownerManifest?.owners ?? []
      })
    )
  }
  for (const ledgerId of Object.keys(ledger.features)) {
    if (!catalogIds.has(ledgerId)) throw new Error(`orphan ledger feature: ${ledgerId}`)
  }

  const coveragePages = new Map()
  for (const page of sourceCoverage.pages) {
    if (!page || typeof page.source_path !== "string" || page.source_path === "") {
      throw new Error(`${coveragePath} contains a page without source_path`)
    }
    if (coveragePages.has(page.source_path)) {
      throw new Error(`${coveragePath} contains duplicate page: ${page.source_path}`)
    }
    if (!/^[0-9a-f]{64}$/u.test(page.source_sha256 ?? "")) {
      throw new Error(`${coveragePath} has invalid source hash: ${page.source_path}`)
    }
    if (!Array.isArray(page.feature_ids)) {
      throw new Error(`${coveragePath} ${page.source_path} feature_ids must be an array`)
    }
    if (new Set(page.feature_ids).size !== page.feature_ids.length) {
      throw new Error(`${coveragePath} ${page.source_path} has duplicate feature edges`)
    }
    for (const featureId of page.feature_ids) {
      if (!catalogIds.has(featureId)) throw new Error(`${coveragePath} links unknown feature: ${featureId}`)
    }
    coveragePages.set(page.source_path, page)
  }
  if (sourceCoverage.listed_page_count !== sourceCoverage.pages.length) {
    throw new Error(`${coveragePath} listed_page_count does not match its page denominator`)
  }
  if (
    sourceCoverage.page_count !==
    sourceCoverage.listed_page_count + sourceCoverage.excluded_data_record_count
  ) {
    throw new Error(`${coveragePath} page_count does not match listed and excluded pages`)
  }
  const classifiedPageCount = Object.values(sourceCoverage.classification_counts ?? {}).reduce(
    (sum, count) => sum + count,
    0
  )
  if (classifiedPageCount !== sourceCoverage.page_count || sourceCoverage.unclassified_count !== 0) {
    throw new Error(`${coveragePath} classification denominator does not match`)
  }
  for (const feature of catalog.features) {
    const sourceEdges = new Set()
    for (const source of feature.sources ?? []) {
      const sourceEdge = JSON.stringify([
        source.path,
        source.start_line ?? null,
        source.end_line ?? null,
        source.role ?? null
      ])
      if (sourceEdges.has(sourceEdge)) {
        throw new Error(`catalog feature ${feature.id} has duplicate source edge: ${source.path}`)
      }
      sourceEdges.add(sourceEdge)
      const coveragePage = coveragePages.get(source.path)
      if (!coveragePage || coveragePage.source_sha256 !== source.source_sha256) {
        throw new Error(`catalog feature ${feature.id} source coverage drift: ${source.path}`)
      }
      if (!coveragePage.feature_ids.includes(feature.id)) {
        throw new Error(`catalog feature ${feature.id} source edge is missing from coverage: ${source.path}`)
      }
    }
  }

  const observationsById = new Map()
  for (const observation of liveObservations.observations) {
    if (!observation || typeof observation.id !== "string" || observation.id === "") {
      throw new Error(`${observationsPath} contains an observation without an id`)
    }
    if (observationsById.has(observation.id)) {
      throw new Error(`duplicate live observation: ${observation.id}`)
    }
    if (!Array.isArray(observation.feature_ids)) {
      throw new Error(`live observation ${observation.id} feature_ids must be an array`)
    }
    const featureIds = new Set()
    for (const featureId of observation.feature_ids) {
      if (featureIds.has(featureId)) {
        throw new Error(`live observation ${observation.id} has duplicate feature link: ${featureId}`)
      }
      featureIds.add(featureId)
      if (!catalogIds.has(featureId)) throw new Error(`unknown catalog feature: ${featureId}`)
    }
    observationsById.set(observation.id, featureIds)
  }

  for (const feature of catalog.features) {
    if (!Array.isArray(feature.live_observation_ids)) {
      throw new Error(`catalog feature ${feature.id} live_observation_ids must be an array`)
    }
    const observationIds = new Set()
    for (const observationId of feature.live_observation_ids) {
      if (observationIds.has(observationId)) {
        throw new Error(`catalog feature ${feature.id} has duplicate observation link: ${observationId}`)
      }
      observationIds.add(observationId)
      const featureIds = observationsById.get(observationId)
      if (!featureIds) throw new Error(`unknown live observation: ${observationId}`)
      if (!featureIds.has(feature.id)) {
        throw new Error(`catalog ${feature.id} links ${observationId} without a reverse link`)
      }
    }
  }
  for (const [observationId, featureIds] of observationsById) {
    for (const featureId of featureIds) {
      const feature = catalog.features.find(({ id }) => id === featureId)
      if (!feature.live_observation_ids.includes(observationId)) {
        throw new Error(`live observation ${observationId} links ${featureId} without a reverse link`)
      }
    }
  }
  return records
}

async function discoverDeepwellJsonRpc(root) {
  const registryPath = "deepwell/src/api.rs"
  const manifestPath = "docs/development/deepwell-jsonrpc-contract-manifest.json"
  const [sourceText, manifest] = await Promise.all([
    readText(root, registryPath),
    readJson(root, manifestPath)
  ])
  const methods = [...sourceText.matchAll(/register!\s*\(\s*"([^"]+)"\s*,/gu)].map(
    (match) => match[1]
  )
  if (methods.length === 0) throw new Error(`${registryPath} declares no JSON-RPC methods`)
  if (new Set(methods).size !== methods.length) {
    const seen = new Set()
    const duplicate = methods.find((method) => {
      if (seen.has(method)) return true
      seen.add(method)
      return false
    })
    throw new Error(`duplicate surface_id: deepwell-jsonrpc:${duplicate}`)
  }
  if (
    manifest.schema !== "wikijump.deepwell_jsonrpc_contract_manifest.v1" ||
    manifest.method_count !== methods.length ||
    !Array.isArray(manifest.methods) ||
    manifest.methods.length !== methods.length
  ) {
    throw new Error(`${manifestPath} does not match the Deepwell method denominator`)
  }
  if (
    manifest.source_identities?.jsonrpc_registry?.path !== registryPath ||
    manifest.source_identities.jsonrpc_registry.sha256 !== sha256(sourceText)
  ) {
    throw new Error(`${manifestPath} JSON-RPC registry identity drift`)
  }
  const contractByMethod = new Map()
  for (const contract of manifest.methods) {
    if (!contract || typeof contract.method !== "string" || contract.method === "") {
      throw new Error(`${manifestPath} contains a method without an identity`)
    }
    if (contractByMethod.has(contract.method)) {
      throw new Error(`${manifestPath} contains duplicate method ${contract.method}`)
    }
    contractByMethod.set(contract.method, contract)
  }
  if (
    contractByMethod.size !== methods.length ||
    methods.some((method) => !contractByMethod.has(method))
  ) {
    throw new Error(`${manifestPath} method identities do not match ${registryPath}`)
  }
  const sourceCache = new Map()
  const readOwnerSource = async (sourceReference) => {
    const sourcePath = sourceReference.split("#", 1)[0]
    if (!sourceCache.has(sourcePath)) sourceCache.set(sourcePath, await readText(root, sourcePath))
    return sourceCache.get(sourcePath)
  }
  const records = []
  for (const method of methods) {
    const contract = contractByMethod.get(method)
    const owner = contract.endpoint_owner
    if (
      owner?.component !== "deepwell" ||
      typeof owner.source !== "string" ||
      !isCanonicalRepositoryReference(owner.source) ||
      !/^[0-9a-f]{64}$/u.test(owner.source_sha256 ?? "")
    ) {
      throw new Error(`${manifestPath} has invalid endpoint ownership for ${method}`)
    }
    if (sha256(await readOwnerSource(owner.source)) !== owner.source_sha256) {
      throw new Error(`${manifestPath} endpoint source identity drift for ${method}`)
    }
    const witness = contract.test_witness
    if (
      !witness ||
      !["source_contract_only", "endpoint_behavioral", "rpc_behavioral"].includes(witness.kind) ||
      typeof witness.reference !== "string" ||
      witness.reference === ""
    ) {
      throw new Error(`${manifestPath} has invalid test witness for ${method}`)
    }
    const behavioralTests =
      witness.kind === "source_contract_only"
        ? [
            "install/local/wikidot-verification/tests/deepwell-jsonrpc-contract-manifest.test.mjs#Deepwell JSON-RPC manifest exactly covers the current registered contract"
          ]
        : [witness.reference]
    records.push(surface({
      surfaceId: `deepwell-jsonrpc:${method}`,
      kind: "deepwell_jsonrpc_method",
      publicOwner: "deepwell",
      publicReference: [`${registryPath}#register:${method}`, owner.source],
      tests: behavioralTests,
      evidence: phase("available", [manifestPath]),
      source: phase("implemented", [owner.source.split("#", 1)[0]])
    }))
  }
  return records
}

async function declaredPageActions(root, sourcePath) {
  const sourceText = await readText(root, sourcePath)
  const lexicalSource = maskTypeScriptCommentsAndLiterals(sourceText, sourcePath)
  const candidates = [...lexicalSource.matchAll(/\bexport\s+const\s+pageActions\s*=\s*/gu)]
  const declarations = candidates.filter((candidate) => {
    const lineStart = lexicalSource.lastIndexOf("\n", candidate.index) + 1
    return /^[ \t]*$/u.test(lexicalSource.slice(lineStart, candidate.index))
  })
  if (candidates.length > 1) throw new Error(`${sourcePath} has duplicate exported pageActions declarations`)
  if (declarations.length !== candidates.length) throw new Error(`${sourcePath} has declaration-shaped text outside a supported top-level declaration`)
  const [declaration] = declarations
  if (!declaration) throw new Error(`${sourcePath} has no exported pageActions declaration`)
  const expressionStart = declaration.index + declaration[0].length
  if (lexicalSource[expressionStart] !== "{") {
    throw new Error(`${sourcePath}#pageActions is not an object literal`)
  }
  const lexicalExpression = extractBalanced(lexicalSource, expressionStart, "{", "}")
  const expression = sourceText.slice(expressionStart, expressionStart + lexicalExpression.length)
  const names = objectPropertyNames(expression, `${sourcePath}#pageActions`)
  if (new Set(names).size !== names.length) {
    throw new Error(`${sourcePath}#pageActions contains duplicate declarations`)
  }
  return new Set(names)
}

async function discoverFramerailRoutes(root) {
  return (
    await discoverFramerailRouteDescriptors(root, {
      readAbsoluteText: (absolutePath) => readAbsoluteText(root, absolutePath)
    })
  ).map((descriptor) => surface(descriptor))
}

const PINNED_TEXT_CACHE = new Map()
const PINNED_TREE_CACHE = new Map()

function preloadPinnedRevisionTexts(root, revision, sourcePaths) {
  if (revision === null) {
    for (const sourcePath of uniqueSortedStrings(sourcePaths)) {
      const key = `${root}\0WORKTREE\0${sourcePath}`
      if (PINNED_TEXT_CACHE.has(key)) continue
      let source = null
      try {
        source = readFileSync(repositoryPath(root, sourcePath), "utf8")
      } catch {
        source = null
      }
      PINNED_TEXT_CACHE.set(key, source)
    }
    return
  }
  const treeKey = `${root}\0${revision}`
  let tree = PINNED_TREE_CACHE.get(treeKey)
  if (!tree) {
    tree = listGitTreeBlobs(["-C", root], revision, `pinned source tree ${revision}`)
    PINNED_TREE_CACHE.set(treeKey, tree)
  }
  const requests = []
  for (const sourcePath of uniqueSortedStrings(sourcePaths)) {
    const key = `${root}\0${revision}\0${sourcePath}`
    if (PINNED_TEXT_CACHE.has(key)) continue
    const oid = tree.get(sourcePath)
    if (!oid) {
      PINNED_TEXT_CACHE.set(key, null)
      continue
    }
    requests.push({ path: sourcePath, oid })
  }
  const blobs = readGitBlobBatch(["-C", root], requests, `pinned source texts ${revision}`)
  for (const request of requests) {
    PINNED_TEXT_CACHE.set(
      `${root}\0${revision}\0${request.path}`,
      blobs.get(request.path)?.toString("utf8") ?? null
    )
  }
}

function pinnedRevisionText(root, revision, sourcePath) {
  const key = `${root}\0${revision ?? "WORKTREE"}\0${sourcePath}`
  if (PINNED_TEXT_CACHE.has(key)) return PINNED_TEXT_CACHE.get(key)
  preloadPinnedRevisionTexts(root, revision, [sourcePath])
  return PINNED_TEXT_CACHE.get(key) ?? null
}

function gitRevisionContains(root, revision, sourcePath, literal) {
  return pinnedRevisionText(root, revision, sourcePath)?.includes(literal) === true
}

async function applyFramerailRouteActionEvidence(root, records, sourceRevision) {
  const registryPath = "docs/development/framerail-route-action-evidence.json"
  const registry = await readJson(root, registryPath)
  if (
    registry.schema !== "wikijump.framerail_route_action_evidence.v1" ||
    !/^[0-9a-f]{40}$/u.test(registry.source_revision ?? "") ||
    !Array.isArray(registry.records) ||
    registry.records.length !== records.length
  ) {
    throw new Error(
      `${registryPath} has an invalid route/action evidence contract ` +
        `(registry_records=${Array.isArray(registry.records) ? registry.records.length : "invalid"}, ` +
        `discovered_records=${records.length})`
    )
  }
  const recordIds = records.map(({ surface_id: surfaceId }) => surfaceId).sort()
  const evidenceIds = registry.records.map(({ surface_id: surfaceId }) => surfaceId).sort()
  if (
    new Set(evidenceIds).size !== evidenceIds.length ||
    JSON.stringify(evidenceIds) !== JSON.stringify(recordIds)
  ) {
    throw new Error(`${registryPath} does not exactly match the current route/action denominator`)
  }
  const evidenceById = new Map(
    registry.records.map((record) => [record.surface_id, record])
  )
  preloadPinnedRevisionTexts(
    root,
    sourceRevision,
    registry.records.flatMap((record) =>
      Array.isArray(record.tests)
        ? record.tests.flatMap((reference) => {
            if (typeof reference !== "string") return []
            const separator = reference.indexOf("::")
            return separator > 0 ? [reference.slice(0, separator)] : []
          })
        : []
    )
  )
  let linked = 0
  let gaps = 0
  const projected = []
  for (const record of records) {
    const evidenceRecord = evidenceById.get(record.surface_id)
    if (
      !Array.isArray(evidenceRecord.tests) ||
      !Array.isArray(evidenceRecord.tracking) ||
      evidenceRecord.tracking.length === 0 ||
      !Array.isArray(evidenceRecord.temporal)
    ) {
      throw new Error(`${registryPath} has an invalid row for ${record.surface_id}`)
    }
    if (
      evidenceRecord.tracking.some(
        ({ issue }) => !Number.isSafeInteger(issue) || issue <= 0
      )
    ) {
      throw new Error(`${registryPath} has invalid tracking for ${record.surface_id}`)
    }
    const tests = []
    for (const reference of evidenceRecord.tests) {
      if (typeof reference !== "string") {
        throw new Error(`${registryPath} has an invalid test reference for ${record.surface_id}`)
      }
      const separator = reference.indexOf("::")
      if (separator <= 0 || reference.endsWith("::")) {
        throw new Error(`${registryPath} has an invalid test reference for ${record.surface_id}`)
      }
      const testPath = reference.slice(0, separator)
      const testName = reference.slice(separator + 2)
      if (
        !isCanonicalRepositoryReference(testPath) ||
        !gitRevisionContains(root, sourceRevision, testPath, testName)
      ) {
        throw new Error(`${registryPath} has a stale current test reference: ${reference}`)
      }
      tests.push(`${testPath}#${testName}`)
    }
    if (tests.length > 0) linked += 1
    else gaps += 1
    projected.push({
      ...record,
      existing_refs: {
        ...record.existing_refs,
        tests: uniqueSortedStrings(tests)
      }
    })
  }
  if (linked !== records.length || gaps !== 0) {
    throw new Error(`${registryPath} current test-link counts drifted`)
  }
  return projected
}

function stringConstant(sourceText, name, reference) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*["']([^"']+)["']`, "u").exec(sourceText)
  if (!match) throw new Error(`missing ${name} in ${reference}`)
  return match[1]
}

function stringSet(sourceText, name, reference) {
  const marker = new RegExp(`const\\s+${name}\\s*=\\s*new\\s+Set\\s*\\(`, "u").exec(sourceText)
  if (!marker) throw new Error(`missing ${name} in ${reference}`)
  const expressionStart = marker.index + marker[0].length - 1
  const expression = extractBalanced(sourceText, expressionStart, "(", ")")
  return [...expression.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1])
}

function moduleMapShapes(sourceText, constantName, reference) {
  const marker = new RegExp(
    `const\\s+${constantName}\\s*=\\s*new\\s+Map\\s*\\(`,
    "u"
  ).exec(sourceText)
  if (!marker) throw new Error(`missing ${constantName} in ${reference}`)
  const mapStart = marker.index + marker[0].length - 1
  const mapExpression = extractBalanced(sourceText, mapStart, "(", ")")
  const arrayStart = mapExpression.indexOf("[")
  if (arrayStart < 0) throw new Error(`module registry is not an array in ${reference}`)
  const entriesExpression = extractBalanced(mapExpression, arrayStart, "[", "]")
  const shapes = []
  for (const entry of splitTopLevel(entriesExpression.slice(1, -1))) {
    const moduleName = entry.match(/^\[\s*["']([^"']+)["']/u)?.[1]
    if (!moduleName) throw new Error(`unsupported module entry in ${constantName}: ${entry}`)
    const parameterSets = [...entry.matchAll(/new\s+Set\s*\(([^)]*)\)/gu)]
    if (parameterSets.length === 0) throw new Error(`module has no parameter shape: ${moduleName}`)
    for (const parameterSet of parameterSets) {
      const parameters = [...parameterSet[1].matchAll(/["']([^"']+)["']/gu)]
        .map((match) => match[1])
        .sort()
      shapes.push({ moduleName, parameters })
    }
  }
  return shapes
}

function amcModuleSurface(registryPath, moduleName, parameters, selector = "parameters") {
  const shape = parameters.length === 0 ? "(none)" : parameters.join(",")
  return surface({
    surfaceId: `framerail-amc-module:${moduleName}:${selector}=${shape}`,
    kind: "framerail_amc_module_shape",
    publicOwner: "framerail",
    publicReference: [`${registryPath}#module:${moduleName};${selector}=${shape}`]
  })
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`SiteChanges evidence has invalid ${label}`)
  }
}

function requireExactStrings(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`SiteChanges evidence ${label} drifted`)
  }
}

const SITE_CHANGES_FORMS = Object.freeze({
  "q1035-sitechanges-page-one": { categoryId: "", moduleName: "changes/SiteChangesListModule", options: '{"all":true}', page: 1, pageId: 74503778, perpage: 20 },
  "q1035-sitechanges-page-two": { categoryId: "", moduleName: "changes/SiteChangesListModule", options: '{"all":true}', page: 2, pageId: 74503778, perpage: 20 },
  "q1035-sitechanges-page-three": { categoryId: "", moduleName: "changes/SiteChangesListModule", options: '{"all":true}', page: 3, pageId: 74503778, perpage: 20 },
  "q1035-sitechanges-page-out": { categoryId: "", moduleName: "changes/SiteChangesListModule", options: '{"all":true}', page: 999999, pageId: 74503778, perpage: 20 },
  "q1035-sitechanges-source": { categoryId: "", moduleName: "changes/SiteChangesListModule", options: '{"source":true}', page: 1, pageId: 74503778, perpage: 20 },
  "q1035-sitechanges-files": { categoryId: "", moduleName: "changes/SiteChangesListModule", options: '{"files":true}', page: 1, pageId: 74503778, perpage: 20 },
  "q1035-sitechanges-empty-options": { categoryId: "", moduleName: "changes/SiteChangesListModule", options: "{}", page: 1, pageId: 74503778, perpage: 20 },
  "q1035-sitechanges-missing-category": { categoryId: "999999999", moduleName: "changes/SiteChangesListModule", options: '{"all":true}', page: 1, pageId: 74503778, perpage: 20 }
})

async function verifySiteChangesExternalEvidence(artifact) {
  const externalRoot = artifact.external_evidence_root
  const sumsPath = path.join(externalRoot, "SHA256SUMS")
  try {
    const sumsBytes = await fs.readFile(sumsPath)
    if (sha256(sumsBytes) !== SITE_CHANGES_EXTERNAL_SHA256SUMS) {
      throw new Error("SiteChanges evidence external SHA256SUMS drifted")
    }
    const sums = new Map(
      sumsBytes
        .toString("utf8")
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s{2,}/u))
        .filter(([digest, name]) => digest && name)
        .map(([digest, name]) => [name, digest])
    )
    const index = JSON.parse(await fs.readFile(path.join(externalRoot, "anonymous-index.json"), "utf8"))
    for (const [caseId, rawSha, responseSha] of SITE_CHANGES_CASES) {
      const entry = index.entries?.find(({ case_id: id }) => id === caseId)
      const rawName = `raw/${caseId}.json`
      if (!entry || entry.path !== path.join(externalRoot, rawName) || entry.sha256 !== rawSha) {
        throw new Error(`SiteChanges evidence raw index drifted: ${caseId}`)
      }
      if (sums.get(rawName) !== rawSha || sha256(await fs.readFile(path.join(externalRoot, rawName))) !== entry.sha256) {
        throw new Error(`SiteChanges evidence raw provenance drifted: ${caseId}`)
      }
      const capture = JSON.parse(await fs.readFile(path.join(externalRoot, rawName), "utf8"))
      if (
        capture.schema !== "wikijump.open43.readonly_live_response.v1" ||
        capture.actor_class !== "anonymous" ||
        capture.authenticated !== false ||
        capture.mutated !== false ||
        capture.request?.method !== "POST" ||
        capture.request?.url !== "https://scp-wiki.wikidot.com/ajax-module-connector.php" ||
        JSON.stringify(capture.request.form) !== JSON.stringify(SITE_CHANGES_FORMS[caseId]) ||
        capture.response?.status !== 200 ||
        capture.response?.headers?.["content-type"] !== "text/plain; charset=UTF-8" ||
        capture.response?.body_sha256 !== responseSha
      ) {
        throw new Error(`SiteChanges evidence response contract drifted: ${caseId}`)
      }
      const envelope = JSON.parse(capture.response.body)
      if (envelope.status !== "ok" || typeof envelope.body !== "string") {
        throw new Error(`SiteChanges evidence success envelope drifted: ${caseId}`)
      }
    }
    return "verified"
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return "unavailable"
    throw error
  }
}

async function applySiteChangesEvidence(root, records) {
  const artifact = await readJson(root, SITE_CHANGES_EVIDENCE_ARTIFACT)
  if (sha256(SOURCE_INPUTS.get(SITE_CHANGES_EVIDENCE_ARTIFACT)) !== SITE_CHANGES_ARTIFACT_SHA256) {
    throw new Error("SiteChanges evidence artifact blob drifted")
  }
  if (
    artifact.schema !== "wikijump.open43.readonly_live_evidence.v1" ||
    artifact.captured_at !== "2026-08-10" ||
    artifact.mutated !== false ||
    !artifact.actor_classes?.includes("anonymous") ||
    artifact.privacy?.credentials_or_cookie_hits !== 0 ||
    JSON.stringify(artifact.privacy?.stored_response_headers_exclude) !==
      JSON.stringify(["authorization", "cookie", "set-cookie"]) ||
    artifact.external_evidence_root !== SITE_CHANGES_EXTERNAL_ROOT ||
    artifact.external_sha256s?.path !== `${SITE_CHANGES_EXTERNAL_ROOT}/SHA256SUMS` ||
    artifact.external_sha256s?.sha256 !== SITE_CHANGES_EXTERNAL_SHA256SUMS
  ) {
    throw new Error("SiteChanges evidence provenance drifted")
  }
  const expectedIndices = [
    ["anonymous-index.json", SITE_CHANGES_ANONYMOUS_INDEX_SHA256, 77],
    ["authenticated-index.json", SITE_CHANGES_AUTHENTICATED_INDEX_SHA256, 24],
    ["flickr-index.json", SITE_CHANGES_FLICKR_INDEX_SHA256, 12]
  ]
  if (
    !Array.isArray(artifact.external_indices) ||
    JSON.stringify(artifact.external_indices.map(({ path: indexPath, sha256: digest, cases }) => [path.basename(indexPath), digest, cases])) !==
      JSON.stringify(expectedIndices)
  ) {
    throw new Error("SiteChanges evidence index provenance drifted")
  }
  const rule = artifact.general_rules?.find(({ evidence_id: evidenceId }) => evidenceId === SITE_CHANGES_EVIDENCE_ID)
  if (!rule) throw new Error("SiteChanges evidence rule is missing")
  requireExactStrings(rule.case_ids, SITE_CHANGES_CASES.map(([caseId]) => caseId), "case IDs")
  if (
    rule.positive_controls !== 5 ||
    rule.negative_controls !== 2 ||
    rule.observation !== "changes/SiteChangesListModule accepts page, perpage, pageId, categoryId, and JSON options. Pages 1 through 3 render distinct ordered rows and pager state. source and files select their revision kinds. An out-of-range page and a nonexistent category return Sorry, no revisions matching your criteria."
  ) {
    throw new Error("SiteChanges evidence control summary drifted")
  }
  for (const [caseId, rawSha, responseSha] of SITE_CHANGES_CASES) {
    requireSha256(rawSha, `${caseId} raw hash`)
    requireSha256(responseSha, `${caseId} response hash`)
  }
  // The Git-tracked artifact above is the durable authority input.  When the
  // original wjlab evidence is present, cross-check it byte-for-byte; its
  // absence must not make one Git tree generate a different inventory in CI.
  await verifySiteChangesExternalEvidence(artifact)
  return records.map((record) =>
    record.surface_id === SITE_CHANGES_SURFACE_ID
      ? { ...record, evidence: phase("available", [`${SITE_CHANGES_EVIDENCE_ARTIFACT}#${SITE_CHANGES_EVIDENCE_ID}`]) }
      : record
  )
}

async function discoverFramerailAmc(root) {
  const registryPath = "framerail/src/lib/server/ajax-module-connector.js"
  const wireContractPath = "docs/development/framerail-amc-wire-contracts.json"
  const sourceText = await readText(root, registryPath)
  const wireContract = await readJson(root, wireContractPath)
  if (wireContract.schema !== "wikijump.framerail_amc_wire_contracts.v1") {
    throw new Error(`unknown Framerail AMC wire contract schema: ${wireContract.schema}`)
  }
  if (!Array.isArray(wireContract.modules)) {
    throw new Error(`${wireContractPath} modules must be an array`)
  }
  const siteChangesClassifierPath =
    "framerail/src/lib/server/wikidot-site-changes.js"
  const siteChangesClassifierText = await readText(root, siteChangesClassifierPath)
  const records = moduleMapShapes(
    sourceText,
    "FORUM_READ_MODULE_PARAMETERS",
    registryPath
  ).map(({ moduleName, parameters }) => amcModuleSurface(registryPath, moduleName, parameters))
  for (const { moduleName, parameters } of moduleMapShapes(
    sourceText,
    "PAGE_READ_MODULE_PARAMETERS",
    registryPath
  )) {
    records.push(amcModuleSurface(registryPath, moduleName, parameters))
  }
  const siteChangesModule = stringConstant(sourceText, "SITE_CHANGES_MODULE", registryPath)
  for (const fieldSet of ["BROWSER_FIELDS", "WIKIDOT_PY_FIELDS"]) {
    records.push(
      amcModuleSurface(
        siteChangesClassifierPath,
        siteChangesModule,
        stringSet(siteChangesClassifierText, fieldSet, siteChangesClassifierPath).sort()
      )
    )
  }
  const membersListModule = stringConstant(sourceText, "MEMBERS_LIST_MODULE", registryPath)
  records.push(
    amcModuleSurface(
      registryPath,
      membersListModule,
      stringSet(sourceText, "MEMBERS_LIST_PARAMETERS", registryPath).sort()
    )
  )
  records.push(
    amcModuleSurface(
      registryPath,
      membersListModule,
      stringSet(sourceText, "MEMBERS_LIST_DEFAULT_PARAMETERS", registryPath).sort()
    )
  )
  const listPagesModule = sourceText.match(/moduleName\s*!==\s*["']([^"']*ListPagesModule)["']/u)?.[1]
  if (!listPagesModule) throw new Error(`missing ListPages module allowlist entry in ${registryPath}`)
  const listPagesContract = wireContract.modules.find(
    ({ module_name: moduleName }) => moduleName === listPagesModule
  )
  if (!listPagesContract) {
    throw new Error(`${wireContractPath} has no contract for ${listPagesModule}`)
  }
  const sourceParameters = stringSet(sourceText, "LIST_PAGES_PARAMETERS", registryPath).sort()
  const contractParameters = uniqueSortedStrings(listPagesContract.allowed_parameters ?? [])
  if (
    contractParameters.length !== listPagesContract.allowed_parameters?.length ||
    JSON.stringify(contractParameters) !== JSON.stringify(sourceParameters)
  ) {
    throw new Error(`${wireContractPath} ${listPagesModule} allowed_parameters do not match source`)
  }
  if (JSON.stringify(listPagesContract.required_fields) !== JSON.stringify([])) {
    throw new Error(`${wireContractPath} ${listPagesModule} must not require fields`)
  }
  if (listPagesContract.module_body !== "optional_default_template") {
    throw new Error(`${wireContractPath} ${listPagesModule} must default an omitted module_body`)
  }
  records.push(
    surface({
      surfaceId: `framerail-amc-module:${listPagesModule}:parameters=${contractParameters.join(",")};module_body=${listPagesContract.module_body}`,
      kind: "framerail_amc_module_shape",
      publicOwner: "framerail",
      publicReference: [wireContractPath, registryPath, ...listPagesContract.implementation_references]
    })
  )
  for (const [field, selector] of [
    ["parameter_order", "parameter-order"],
    ["duplicate_fields", "duplicate-fields"],
    ["unknown_parameters", "unknown-parameters"],
    ["value_type", "value-type"],
    ["callback_index", "callback-index"],
    ["authentication", "authentication"],
    ["success_envelope", "success-envelope"]
  ]) {
    const value = listPagesContract[field]
    if (typeof value !== "string" || value === "") {
      throw new Error(`${wireContractPath} ${listPagesModule} has invalid ${field}`)
    }
    records.push(
      surface({
        surfaceId: `framerail-amc-module:${listPagesModule}:${selector}=${value}`,
        kind: "framerail_amc_module_shape",
        publicOwner: "framerail",
        publicReference: [wireContractPath, registryPath, ...listPagesContract.implementation_references]
      })
    )
  }
  if (
    !Array.isArray(listPagesContract.failure_envelopes) ||
    listPagesContract.failure_envelopes.length === 0 ||
    listPagesContract.failure_envelopes.some((value) => typeof value !== "string" || value === "")
  ) {
    throw new Error(`${wireContractPath} ${listPagesModule} has invalid failure_envelopes`)
  }
  records.push(
    surface({
      surfaceId: `framerail-amc-module:${listPagesModule}:failure-envelopes=${listPagesContract.failure_envelopes.join("|")}`,
      kind: "framerail_amc_module_shape",
      publicOwner: "framerail",
      publicReference: [wireContractPath, registryPath, ...listPagesContract.implementation_references]
    })
  )

  for (const [actionName, eventName] of [
    ["NEWPAGE_ACTION", "NEWPAGE_EVENT"],
    ["PAGE_DISCUSSION_ACTION", "PAGE_DISCUSSION_EVENT"]
  ]) {
    const action = stringConstant(sourceText, actionName, registryPath)
    const event = stringConstant(sourceText, eventName, registryPath)
    records.push(
      surface({
        surfaceId: `framerail-amc-action:${action}:${event}`,
        kind: "framerail_amc_action_shape",
        publicOwner: "framerail",
        publicReference: [`${registryPath}#action:${action};event=${event}`]
      })
    )
  }
  return records
}

const FRAMERAIL_AMC_TEST_PATH = "framerail/tests/ajax-module-connector.test.js"
const FRAMERAIL_AMC_TESTS = new Map([
  [
    "framerail-amc-action:ForumAction:createPageDiscussionThread",
    [
      "dispatches Wikidot page discussion creation and preserves its wire envelope",
      "page discussion creation uses Wikidot no_page and stable failure boundaries"
    ]
  ],
  [
    "framerail-amc-action:misc/NewPageHelperAction:createNewPage",
    [
      "dispatches NewPage helper default action with Wikidot edit-routing fields",
      "dispatches NewPage template and category action fields like Wikidot"
    ]
  ],
  [
    "framerail-amc-module:changes/SiteChangesListModule:parameters=categoryId,options,page,pageId,perpage",
    ["dispatches the sealed SiteChanges control-browser-shape matrix with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:changes/SiteChangesListModule:parameters=options,page,perpage",
    ["SiteChanges accepts wikidot.py client-page-one-default without browser host fields"]
  ],
  [
    "framerail-amc-module:files/PageFilesModule:parameters=page_id",
    ["dispatches wikidot.py page reads without rewriting their request fields"]
  ],
  [
    "framerail-amc-module:forum/ForumCommentsListModule:parameters=order,pageId",
    ["dispatches the sealed page comments reads without adding mutation authority"]
  ],
  [
    "framerail-amc-module:forum/ForumCommentsListModule:parameters=pageId",
    ["dispatches the sealed page comments reads without adding mutation authority"]
  ],
  [
    "framerail-amc-module:forum/ForumRecentPostsListModule:parameters=categoryId,page",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumStartModule:parameters=(none)",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumStartModule:parameters=hidden",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumViewCategoryModule:parameters=c,p",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumViewThreadModule:parameters=t",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:forum/ForumViewThreadPostsModule:parameters=pageNo,t",
    ["dispatches the sealed read-only forum modules with Wikidot metadata"]
  ],
  [
    "framerail-amc-module:history/PageRevisionListModule:parameters=options,page_id,perpage",
    ["dispatches the exact wikidot.py page revision list shape"]
  ],
  [
    "framerail-amc-module:history/PageSourceModule:parameters=revision_id",
    ["dispatches the exact wikidot.py historical source and version shapes"]
  ],
  [
    "framerail-amc-module:history/PageVersionModule:parameters=revision_id",
    ["dispatches the exact wikidot.py historical source and version shapes"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:duplicate-fields=last_value",
    ["ListPages keeps the later URL-form value for duplicate scalar fields", "ListPages keeps later module names while other modules reject duplicates"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:authentication=cookies_ignored;wikidot_token7_accepted_ignored",
    ["ListPages validates the public token but excludes controls from render parameters"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:callback-index=accepted_ignored",
    ["ListPages validates the public token but excludes controls from render parameters"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:failure-envelopes=render_failure:status=not_ok;message=Unable to render ListPages module",
    ["converts Deepwell failures to a stable Wikidot error envelope"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:parameter-order=insignificant",
    ["ListPages validates the public token but excludes controls from render parameters"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:parameters=category,created_at,created_by,createdat,createdby,full_slug,fullname,fullslug,limit,name,offset,order,p,page-type,page_type,pagetype,parent,per_page,perpage,range,rating,rss,rssdescription,rsshome,rsslimit,rssonly,rsstitle,score,separate,tag,tags,updated_at,updatedat,wrapper;module_body=optional_default_template",
    ["dispatches ListPages forms and returns the Wikidot JSON envelope", "ListPages omits module_body for Deepwell's default row template"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:unknown-parameters=non_data_form_ignored;leading_underscore_rejected",
    ["ListPages ignores unknown non-data-form selectors while recognized selectors apply", "ListPages retains fail-closed boundaries for dynamic selectors and invalid UTF-8"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:success-envelope=status=ok;body=string",
    ["dispatches ListPages forms and returns the Wikidot JSON envelope"]
  ],
  [
    "framerail-amc-module:list/ListPagesModule:value-type=urlencoded_utf8_string",
    ["dispatches ListPages forms and returns the Wikidot JSON envelope"]
  ],
  [
    "framerail-amc-module:membership/MembersListModule:parameters=group,order,page",
    ["dispatches only the observed MembersListModule read shape"]
  ],
  [
    "framerail-amc-module:membership/MembersListModule:parameters=group,page",
    ["accepts the wikidot.py MembersList default and applies Wikidot joined order"]
  ],
  [
    "framerail-amc-module:pagerate/WhoRatedPageModule:parameters=pageId",
    ["dispatches only the canonical wikidot.py WhoRated shape"]
  ],
  [
    "framerail-amc-module:viewsource/ViewSourceModule:parameters=page_id",
    [
      "dispatches wikidot.py page reads without rewriting their request fields",
      "returns the observed no_page envelope for a missing ViewSource page"
    ]
  ]
])

function applyFramerailAmcTests(root, records, sourceRevision) {
  const recordIds = new Set(records.map(({ surface_id: surfaceId }) => surfaceId))
  for (const surfaceId of FRAMERAIL_AMC_TESTS.keys()) {
    if (!recordIds.has(surfaceId)) {
      throw new Error(`Framerail AMC test mapping targets an unknown surface: ${surfaceId}`)
    }
  }
  preloadPinnedRevisionTexts(root, sourceRevision, [FRAMERAIL_AMC_TEST_PATH])
  let linked = 0
  const projected = records.map((record) => {
    const testNames = FRAMERAIL_AMC_TESTS.get(record.surface_id) ?? []
    for (const testName of testNames) {
      if (!gitRevisionContains(root, sourceRevision, FRAMERAIL_AMC_TEST_PATH, testName)) {
        throw new Error(`stale Framerail AMC public test: ${record.surface_id} -> ${testName}`)
      }
    }
    if (testNames.length > 0) linked += 1
    return {
      ...record,
      existing_refs: {
        ...record.existing_refs,
        tests: testNames.map((testName) => `${FRAMERAIL_AMC_TEST_PATH}#${testName}`)
      }
    }
  })
  if (linked !== 29 || projected.length - linked !== 0) {
    throw new Error("Framerail AMC public-test coverage counts drifted")
  }
  return projected
}

async function discoverWikidotPyAmc(root, wikidotPySource) {
  const contractPath = "docs/development/wikidot-py-amc-client-parity.json"
  const contract = await readJson(root, contractPath)
  if (contract.schema !== "wikijump.wikidot_py_amc_client_parity.v1") {
    throw new Error(`unknown Wikidot.py AMC contract schema: ${contract.schema}`)
  }
  const objects = contract.source?.objects
  const objectPaths = Array.isArray(objects) ? objects.map(({ path: objectPath }) => objectPath) : []
  if (
    contract.source?.repository !== wikidotPySource.repository ||
    contract.source?.commit !== wikidotPySource.commit ||
    contract.source?.root_tree !== wikidotPySource.root_tree ||
    !Array.isArray(objects) ||
    objects.length !== wikidotPySource.objects.size ||
    new Set(objectPaths).size !== objectPaths.length ||
    objects.some(({ path: objectPath, type, oid }) => {
      const expected = wikidotPySource.objects.get(objectPath)
      return expected?.[0] !== type || expected?.[1] !== oid
    })
  ) {
    throw new Error(`${contractPath} source identity drift`)
  }
  if (!Array.isArray(contract.modules)) {
    throw new Error(`${contractPath} modules must be an array`)
  }
  verifyPinnedWikidotPySource(wikidotPySource)
  const moduleNames = contract.modules.map(({ module_name: moduleName }) => moduleName)
  if (
    new Set(moduleNames).size !== moduleNames.length ||
    JSON.stringify([...new Set(moduleNames)].sort()) !== JSON.stringify(pinnedWikidotPyAmcModules(wikidotPySource))
  ) {
    throw new Error(`${contractPath} module denominator drift`)
  }

  return contract.modules.map((module) => {
    if (typeof module.module_name !== "string" || module.module_name === "") {
      throw new Error(`${contractPath} contains a module without module_name`)
    }
    if (
      !Array.isArray(module.parameters) ||
      module.parameters.some((parameter) => typeof parameter !== "string")
    ) {
      throw new Error(`${contractPath} ${module.module_name} parameters must be strings`)
    }
    if (!["supported", "unsupported_unevidenced"].includes(module.status)) {
      throw new Error(
        `${contractPath} ${module.module_name} has unknown status: ${module.status}`
      )
    }
    if (module.status === "unsupported_unevidenced" && !module.gap) {
      throw new Error(`${contractPath} ${module.module_name} has no actionable gap`)
    }
    const shape = module.parameters.length === 0 ? "(none)" : module.parameters.join(",")
    return surface({
      surfaceId: `wikidot-py-amc-module:${module.module_name}:parameters=${shape}`,
      kind: "wikidot_py_amc_module_shape",
      publicOwner: "Rokurolize/wikidot.py",
      publicReference: [
        `${contractPath}#module:${module.module_name};parameters=${shape}`
      ],
      tests:
        module.status === "supported"
          ? [
              "install/local/wikidot-verification/tests/wikidot-py-amc-client-parity.test.mjs#supported wikidot.py request bodies behave identically when only the target changes"
            ]
          : [],
      evidence: phase("partial", [contractPath]),
      source: phase(module.status === "supported" ? "implemented" : "pending")
    })
  })
}

async function discoverFramerailXmlRpc(root) {
  const registryPath = "framerail/src/lib/server/xmlrpc/methods.ts"
  const sourceText = await readText(root, registryPath)
  const marker = /const\s+METHOD_DEFINITIONS\b/u.exec(sourceText)
  if (!marker) throw new Error(`missing METHOD_DEFINITIONS in ${registryPath}`)
  const equals = sourceText.indexOf("=", marker.index + marker[0].length)
  const objectStart = sourceText.indexOf("{", equals + 1)
  if (equals < 0 || objectStart < 0) throw new Error(`invalid METHOD_DEFINITIONS in ${registryPath}`)
  const definition = extractBalanced(sourceText, objectStart, "{", "}")
  const methods = objectPropertyNames(definition, `${registryPath}#METHOD_DEFINITIONS`)
  if (methods.length === 0) throw new Error(`${registryPath} declares no XML-RPC methods`)
  return methods.map((method) =>
    surface({
      surfaceId: `framerail-xmlrpc:${method}`,
      kind: "framerail_xmlrpc_method",
      publicOwner: "framerail",
      publicReference: [`${registryPath}#method:${method}`]
    })
  )
}

async function discoverPageActionSurfaces(root) {
  const registryPath = "docs/development/wikidot-page-action-surfaces.json"
  const registry = await readJson(root, registryPath)
  if (registry.schema !== "wikijump.wikidot_page_action_surface_registry.v2") {
    throw new Error(`${registryPath} has an unsupported schema`)
  }
  if (!Array.isArray(registry.evidence_references) || registry.evidence_references.length === 0) {
    throw new Error(`${registryPath} must declare evidence_references`)
  }
  if (!Array.isArray(registry.surfaces) || registry.surfaces.length === 0) {
    throw new Error(`${registryPath} must declare surfaces`)
  }
  if (!Array.isArray(registry.missing_page_controls)) {
    throw new Error(`${registryPath} must declare missing_page_controls`)
  }
  const pageActions = registry.surfaces.map((entry) => {
    if (!entry || !/^[a-z][a-z0-9-]+$/u.test(entry.action_id ?? "")) {
      throw new Error(`${registryPath} contains an invalid action_id`)
    }
    if (!LEDGER_STATUSES.has(entry.source_status)) {
      throw new Error(`${registryPath} has an unknown source status for ${entry.action_id}`)
    }
    const standingStatus = entry.standing_status ?? "pending"
    if (!PHASE_STATUSES.standing.has(standingStatus)) {
      throw new Error(`${registryPath} has an unknown standing status for ${entry.action_id}`)
    }
    return surface({
      surfaceId: `page-action:${entry.action_id}`,
      kind: "page_action",
      publicOwner: "framerail",
      publicReference: [registryPath, ...(entry.public_references ?? [])],
      issues: entry.issues ?? [],
      tests: entry.test_references ?? [],
      evidence: phase("partial", registry.evidence_references),
      source: phase(entry.source_status, entry.public_references ?? []),
      standing: phase(standingStatus)
    })
  })
  const controlIds = registry.missing_page_controls.map((entry) => entry?.control_id)
  if (
    new Set(controlIds).size !== controlIds.length ||
    JSON.stringify([...controlIds].sort()) !==
      JSON.stringify([...MISSING_PAGE_CONTROL_CONTRACTS.keys()].sort())
  ) {
    throw new Error(`${registryPath} must declare exactly one create and one restore control`)
  }
  const missingPageControls = []
  const pageActionDeclarations = new Map()
  for (const entry of registry.missing_page_controls) {
    const contract = MISSING_PAGE_CONTROL_CONTRACTS.get(entry.control_id)
    if (!LEDGER_STATUSES.has(entry.source_status)) {
      throw new Error(
        `${registryPath} has an unknown source status for missing-page ${entry.control_id}`
      )
    }
    if (!Array.isArray(entry.operation_bindings)) {
      throw new Error(`${registryPath} ${entry.control_id} operation_bindings must be an array`)
    }
    const operationIds = entry.operation_bindings.map((binding) => binding?.operation_id)
    if (
      new Set(operationIds).size !== operationIds.length ||
      JSON.stringify(operationIds) !== JSON.stringify(contract.operations)
    ) {
      throw new Error(
        `${registryPath} ${entry.control_id} operations must be ${contract.operations.join(",")}`
      )
    }
    const operationBindings = entry.operation_bindings.map((binding) => {
      if (
        !Array.isArray(binding.public_references) ||
        binding.public_references.length === 0 ||
        binding.public_references.some(
          (reference) => {
            if (typeof reference !== "string") return true
            const parts = reference.split("#")
            return (
              parts.length !== 2 ||
              !isCanonicalRepositoryReference(reference) ||
              parts[1] !== `action:${binding.operation_id}`
            )
          }
        )
      ) {
        throw new Error(
          `${registryPath} ${entry.control_id} ${binding.operation_id} has invalid public references`
        )
      }
      return {
        operation_id: binding.operation_id,
        public_references: uniqueSortedStrings(binding.public_references)
      }
    })
    if (JSON.stringify(entry.observable_states) !== JSON.stringify(contract.states)) {
      throw new Error(
        `${registryPath} ${entry.control_id} observable_states do not match the closed contract`
      )
    }
    const proof = validatedBrowserIntervalProof(
      entry.browser_interval_proof,
      registryPath,
      entry.control_id
    )
    if (!Array.isArray(entry.source_identities) || entry.source_identities.length === 0) {
      throw new Error(`${registryPath} ${entry.control_id} must declare source_identities`)
    }
    const identityPaths = new Set()
    const sourceIdentities = []
    for (const identity of entry.source_identities) {
      const normalizedIdentityPath =
        typeof identity?.path === "string" ? toPosix(path.normalize(identity.path)) : ""
      if (
        !identity ||
        typeof identity.path !== "string" ||
        identity.path === "" ||
        path.isAbsolute(identity.path) ||
        normalizedIdentityPath !== identity.path ||
        normalizedIdentityPath === ".." ||
        normalizedIdentityPath.startsWith("../") ||
        !/^[0-9a-f]{64}$/u.test(identity.sha256 ?? "")
      ) {
        throw new Error(`${registryPath} ${entry.control_id} has an invalid source identity`)
      }
      if (identityPaths.has(identity.path)) {
        throw new Error(
          `${registryPath} ${entry.control_id} has duplicate source identity ${identity.path}`
        )
      }
      identityPaths.add(identity.path)
      const sourceText = await readText(root, identity.path)
      if (sha256(sourceText) !== identity.sha256) {
        throw new Error(
          `${registryPath} ${entry.control_id} source identity is stale: ${identity.path}`
        )
      }
      sourceIdentities.push({ path: identity.path, sha256: identity.sha256 })
    }
    for (const binding of operationBindings) {
      for (const reference of binding.public_references) {
        const sourcePath = reference.split("#", 1)[0]
        if (!identityPaths.has(sourcePath)) {
          throw new Error(
            `${registryPath} ${entry.control_id} operation reference lacks a source identity: ${sourcePath}`
          )
        }
        let declarations = pageActionDeclarations.get(sourcePath)
        if (!declarations) {
          declarations = await declaredPageActions(root, sourcePath)
          pageActionDeclarations.set(sourcePath, declarations)
        }
        if (!declarations.has(binding.operation_id)) {
          throw new Error(
            `${registryPath} ${entry.control_id} ${binding.operation_id} is not declared by ${sourcePath}#pageActions`
          )
        }
      }
    }
    const base = surface({
      surfaceId: `missing-page-control:${entry.control_id}`,
      kind: "missing_page_control",
      publicOwner: "framerail",
      publicReference: [
        registryPath,
        ...sourceIdentities.map(({ path: sourcePath }) => sourcePath),
        ...operationBindings.flatMap(({ public_references: references }) => references)
      ],
      issues: entry.issues ?? [],
      tests: entry.test_references ?? [],
      evidence: phase(
        proof.status,
        proof.status === "available" ? proof.references : []
      ),
      source: phase(entry.source_status, sourceIdentities.map(({ path: sourcePath }) => sourcePath))
    })
    missingPageControls.push({
      ...base,
      operation_bindings: operationBindings,
      observable_states: [...entry.observable_states],
      browser_interval_proof: proof,
      source_identities: sourceIdentities
    })
  }
  return [...pageActions, ...missingPageControls]
}

async function discoverWwsRoutes(root) {
  const registryPath = "wws/src/route.rs"
  const sourceText = await readText(root, registryPath)
  return discoverWwsRouteRecords(sourceText, registryPath).map(({ method, routePath, reference }) =>
    surface({
      surfaceId: `wws-route:${method}:${routePath}`,
      kind: "wws_route",
      publicOwner: "wws",
      publicReference: [reference]
    })
  )
}

async function applyWwsContractEvidence(root, records, sourceRevision) {
  const denominatorPath = "docs/development/wws-route-registration-denominator.json"
  const denominator = await readJson(root, denominatorPath)
  if (
    denominator.schema !== "wikijump.wws_route_registration_denominator.v2" ||
    !Array.isArray(denominator.registrations) ||
    denominator.counts?.registrations !== denominator.registrations.length ||
    !Array.isArray(denominator.behavior_records)
  ) {
    throw new Error(`${denominatorPath} has an invalid denominator contract`)
  }
  if (!Array.isArray(denominator.source?.inputs) || denominator.source.inputs.length === 0) {
    throw new Error(`${denominatorPath} has no source identities`)
  }
  for (const input of denominator.source.inputs) {
    if (
      typeof input?.path !== "string" ||
      !isCanonicalRepositoryReference(input.path) ||
      !/^[0-9a-f]{40}$/u.test(input.git_blob ?? "") ||
      !/^[0-9a-f]{64}$/u.test(input.sha256 ?? "")
    ) {
      throw new Error(`${denominatorPath} has an invalid source identity`)
    }
    const sourceBytes = await fs.readFile(path.join(root, input.path))
    if (sha256(sourceBytes) !== input.sha256) {
      throw new Error(`${denominatorPath} source identity drift: ${input.path}`)
    }
    const sourceBlob = sourceRevision === null
      ? gitBlobOid(sourceBytes)
      : resolveGitObject(["-C", root], `${sourceRevision}:${input.path}`, "WWS source blob")
    if (sourceBlob !== input.git_blob) {
      throw new Error(`${denominatorPath} pinned source identity drift: ${input.path}`)
    }
  }
  if (
    typeof denominator.generator?.path !== "string" ||
    !/^[0-9a-f]{64}$/u.test(denominator.generator.sha256 ?? "") ||
    sha256(await readText(root, denominator.generator.path)) !== denominator.generator.sha256
  ) {
    throw new Error(`${denominatorPath} generator identity drift`)
  }
  if (
    typeof denominator.behavior_evidence?.path !== "string" ||
    !/^[0-9a-f]{64}$/u.test(denominator.behavior_evidence.sha256 ?? "") ||
    sha256(await readText(root, denominator.behavior_evidence.path)) !==
      denominator.behavior_evidence.sha256
  ) {
    throw new Error(`${denominatorPath} behavior evidence identity drift`)
  }

  const registrations = new Map()
  for (const registration of denominator.registrations) {
    const expectedId =
      `wws-route-registration:${registration.declared_method_class}:${registration.path}`
    if (
      registration.registration_id !== expectedId ||
      !["ANY", "GET"].includes(registration.declared_method_class) ||
      registrations.has(registration.registration_id)
    ) {
      throw new Error(`${denominatorPath} has an invalid or duplicate registration`)
    }
    registrations.set(registration.registration_id, registration)
  }
  const behaviorsByRegistration = new Map()
  for (const behavior of denominator.behavior_records) {
    if (
      typeof behavior?.id !== "string" ||
      !["implemented", "not_faithfully_mapped"].includes(behavior.status) ||
      !Array.isArray(behavior.registration_ids) ||
      typeof behavior.public_test !== "string" ||
      behavior.public_test === ""
    ) {
      throw new Error(`${denominatorPath} has an invalid behavior record`)
    }
    for (const registrationId of behavior.registration_ids) {
      if (!registrations.has(registrationId)) {
        throw new Error(`${denominatorPath} behavior references an unknown registration`)
      }
      const behaviors = behaviorsByRegistration.get(registrationId) ?? []
      behaviors.push(behavior)
      behaviorsByRegistration.set(registrationId, behaviors)
    }
    if (behavior.historical_evidence_receipt) {
      const receipt = await readText(root, behavior.historical_evidence_receipt)
      if (
        !/^[0-9a-f]{64}$/u.test(behavior.historical_evidence_sha256 ?? "") ||
        sha256(receipt) !== behavior.historical_evidence_sha256
      ) {
        throw new Error(`${denominatorPath} historical evidence identity drift for ${behavior.id}`)
      }
    }
  }

  const registrationForSurface = (surfaceId) => {
    const match = /^wws-route:(ANY|GET|HEAD|FALLBACK):(.*)$/u.exec(surfaceId)
    if (!match) throw new Error(`invalid WWS dispatch surface: ${surfaceId}`)
    const [, method, routePath] = match
    if (method === "ANY") return `wws-route-registration:ANY:${routePath}`
    if (method === "GET" || method === "HEAD") {
      return `wws-route-registration:GET:${routePath}`
    }
    const anyId = `wws-route-registration:ANY:${routePath}`
    return registrations.has(anyId)
      ? anyId
      : `wws-route-registration:GET:${routePath}`
  }

  const usedRegistrations = new Set()
  const projected = records.map((record) => {
    const registrationId = registrationForSurface(record.surface_id)
    if (!registrations.has(registrationId)) {
      throw new Error(`${denominatorPath} has no registration for ${record.surface_id}`)
    }
    usedRegistrations.add(registrationId)
    const behaviors = behaviorsByRegistration.get(registrationId) ?? []
    const partial = behaviors.some(({ status }) => status === "not_faithfully_mapped")
    const evidenceReferences = [
      denominatorPath,
      ...behaviors.flatMap((behavior) =>
        behavior.status === "implemented"
          ? [denominator.behavior_evidence.path]
          : [behavior.historical_evidence_receipt]
      )
    ]
    return {
      ...record,
      existing_refs: {
        ...record.existing_refs,
        tests: uniqueSortedStrings(
          behaviors.length > 0
            ? behaviors.map(({ public_test: publicTest }) => publicTest)
            : [
                "install/local/wikidot-verification/tests/wws-route-registration-denominator-cli.test.mjs#CLI writes the exact current 34-registration WWS denominator with source ownership"
              ]
        )
      },
      evidence: phase(partial ? "partial" : "available", evidenceReferences)
    }
  })
  if ([...registrations.keys()].some((registrationId) => !usedRegistrations.has(registrationId))) {
    throw new Error(`${denominatorPath} has a registration without a dispatch surface`)
  }
  return projected
}


async function discoverOpen43AuditCases(root) {
  return discoverOpen43AuditCasesFromSource(root, {
    readJson: (selectedRoot, relativePath) => readJson(selectedRoot, relativePath),
    readText: (selectedRoot, relativePath) => readText(selectedRoot, relativePath),
    readGitSpecBatch
  })
}

function normalizeSurfaceOwners(surfaces, catalogCrosswalk, semantics, auditedOwnershipActive) {
  const specificationKinds = uniqueSortedStrings(
    surfaces
      .filter(({ kind }) => kind !== "catalog_feature" && kind !== "open43_audit_case")
      .map(({ kind }) => kind)
  )
  const mappedSpecificationKinds = Object.keys(semantics.specification_owner_by_kind ?? {}).sort()
  if (JSON.stringify(mappedSpecificationKinds) !== JSON.stringify(specificationKinds)) {
    throw new Error(`${SEMANTICS_REGISTRY} has missing or unused specification owner kinds`)
  }
  const legacyOwners = uniqueSortedStrings(surfaces.map(({ public_owner: owner }) => owner))
  const mappedLegacyOwners = Object.keys(semantics.implementation_owners_by_legacy_owner ?? {}).sort()
  if (JSON.stringify(mappedLegacyOwners) !== JSON.stringify(legacyOwners)) {
    throw new Error(`${SEMANTICS_REGISTRY} has missing or unused legacy owner keys`)
  }
  const declaredImplementationOwners = new Set(semantics.implementation_owner_keys)
  for (const [legacyOwner, owners] of Object.entries(semantics.implementation_owners_by_legacy_owner)) {
    assertCanonicalStrings(owners, `${SEMANTICS_REGISTRY} legacy owner ${legacyOwner}`)
    if (owners.some((owner) => !declaredImplementationOwners.has(owner))) {
      throw new Error(`${SEMANTICS_REGISTRY} legacy owner ${legacyOwner} has an undeclared owner`)
    }
  }
  const crosswalkByFeature = new Map(
    catalogCrosswalk.map((row) => [row.feature_id, row])
  )
  const implementationOwnersFromSource = (record) => {
    const owners = new Set()
    for (const reference of record.source?.references ?? []) {
      if (reference.startsWith("deepwell/")) owners.add("wikijump.deepwell")
      else if (reference.startsWith("framerail/")) owners.add("wikijump.framerail")
      else if (reference.startsWith("wws/")) owners.add("wikijump.wws")
    }
    return uniqueSortedStrings([...owners])
  }
  const normalizedSurfaces = surfaces.map((record) => {
    const {
      public_owner: legacyOwner,
      implementation_owner_records: implementationOwnerRecords,
      ...normalized
    } = record
    let specificationOwner
    let implementationOwners
    if (record.kind === "catalog_feature") {
      const featureId = record.surface_id.slice("catalog-feature:".length)
      const crosswalk = crosswalkByFeature.get(featureId)
      specificationOwner = `catalog.feature:${featureId}`
      if (crosswalk) {
        implementationOwners = uniqueSortedStrings(["ftml", crosswalk.runtime_owner])
      } else if (DEFERRED_XMLRPC_CATALOG_FEATURES.has(record.surface_id)) {
        implementationOwners = []
      } else if (implementationOwnerRecords.length > 0) {
        implementationOwners = uniqueSortedStrings(
          implementationOwnerRecords.map(({ owner }) => owner)
        )
      } else if (auditedOwnershipActive) {
        implementationOwners = implementationOwnersFromSource(record)
        if (implementationOwners.length === 0) {
          throw new Error(`audited catalog feature has no concrete implementation owner: ${record.surface_id}`)
        }
      } else {
        implementationOwners = []
      }
    } else if (record.kind === "open43_audit_case") {
      const caseId = record.surface_id.slice("open43-audit-case:".length)
      specificationOwner = `open43.case:${caseId}`
      implementationOwners = semantics.implementation_owners_by_legacy_owner?.[legacyOwner]
    } else {
      specificationOwner = semantics.specification_owner_by_kind?.[record.kind]
      implementationOwners = semantics.implementation_owners_by_legacy_owner?.[legacyOwner]
    }
    if (!specificationOwner) {
      throw new Error(`unknown specification owner kind for ${record.surface_id}: ${record.kind}`)
    }
    if (!implementationOwners) {
      throw new Error(`unknown implementation owner for ${record.surface_id}: ${legacyOwner}`)
    }
    return {
      ...normalized,
      specification_owner: specificationOwner,
      implementation_owners: uniqueSortedStrings(implementationOwners)
    }
  })
  if (auditedOwnershipActive) {
    const fallbackRows = surfaces.filter((record) => {
      if (record.kind !== "catalog_feature") return false
      const featureId = record.surface_id.slice("catalog-feature:".length)
      return !crosswalkByFeature.has(featureId) &&
        !DEFERRED_XMLRPC_CATALOG_FEATURES.has(record.surface_id) &&
        record.implementation_owner_records.length === 0
    })
    const fallbackIds = fallbackRows.map(({ surface_id: surfaceId }) => surfaceId)
    const fallbackMapping = normalizedSurfaces
      .filter(({ surface_id: surfaceId }) => fallbackIds.includes(surfaceId))
      .map(({ surface_id: surfaceId, implementation_owners: owners }) => `${surfaceId}\t${owners.join(",")}`)
    if (
      fallbackRows.length !== AUDITED_CATALOG_FALLBACK.count ||
      auditedLinesSha256(fallbackIds) !== AUDITED_CATALOG_FALLBACK.surface_ids_sha256 ||
      auditedLinesSha256(fallbackMapping) !== AUDITED_CATALOG_FALLBACK.mapping_sha256
    ) {
      throw new Error(
        `audited catalog implementation ownership drift: count=${fallbackRows.length} ` +
          `surface_ids_sha256=${auditedLinesSha256(fallbackIds)} ` +
          `mapping_sha256=${auditedLinesSha256(fallbackMapping)}`
      )
    }
  }
  return normalizedSurfaces
}

function applyFtmlCatalogSourceProjection(surfaces, ftmlRawSurfaceManifest) {
  const rawById = new Map(
    ftmlRawSurfaceManifest.records.map((record) => [record.surface_id, record])
  )
  const pureFtmlByFeature = new Map(
    ftmlRawSurfaceManifest.catalog_crosswalk
      .filter(({ runtime_owner: runtimeOwner }) => runtimeOwner === null)
      .map((row) => [row.feature_id, row])
  )
  const revision = ftmlRawSurfaceManifest.source?.commit
  if (!/^[0-9a-f]{40}$/u.test(revision ?? "")) {
    throw new Error("pinned FTML catalog source projection has no exact revision")
  }
  return surfaces.map((record) => {
    if (record.kind !== "catalog_feature") return record
    const featureId = record.surface_id.slice("catalog-feature:".length)
    const crosswalk = pureFtmlByFeature.get(featureId)
    if (!crosswalk) return record
    const ownerIds = uniqueSortedStrings([
      ...crosswalk.parsed_by,
      ...crosswalk.rendered_by
    ])
    if (ownerIds.length === 0) {
      throw new Error(`pure FTML catalog feature has no implementation source: ${featureId}`)
    }
    const references = ownerIds.map((surfaceId) => {
      const owner = rawById.get(surfaceId)
      if (!owner || typeof owner.source_reference !== "string" || owner.source_reference === "") {
        throw new Error(`pure FTML catalog feature has an unknown source owner: ${featureId} -> ${surfaceId}`)
      }
      return `Rokurolize/ftml@${revision}:${owner.source_reference}`
    })
    const tests = FTML_PUBLIC_PREVIEW_TEST_FEATURES.has(featureId)
      ? uniqueSortedStrings([
          ...(record.existing_refs?.tests ?? []),
          FTML_PUBLIC_PREVIEW_TEST
        ])
      : record.existing_refs?.tests ?? []
    return {
      ...record,
      existing_refs: {
        ...record.existing_refs,
        tests
      },
      source: phase("implemented", references)
    }
  })
}

async function applyCatalogSourceAttribution(root, surfaces, sourceRevision) {
  const registry = await readJson(root, CATALOG_SOURCE_ATTRIBUTION)
  if (
    registry.schema !== "wikijump.compatibility_catalog_source_attribution.v1" ||
    !Array.isArray(registry.records)
  ) {
    throw new Error(`${CATALOG_SOURCE_ATTRIBUTION} has an invalid contract`)
  }
  const surfaceIds = new Set(
    surfaces
      .filter(({ kind }) => kind === "catalog_feature")
      .map(({ surface_id: surfaceId }) => surfaceId)
  )
  const recordIds = registry.records.map(({ surface_id: surfaceId }) => surfaceId)
  if (new Set(recordIds).size !== recordIds.length) {
    throw new Error(`${CATALOG_SOURCE_ATTRIBUTION} has duplicate surface ids`)
  }
  preloadPinnedRevisionTexts(
    root,
    sourceRevision,
    registry.records.flatMap((record) =>
      [...(Array.isArray(record.sources) ? record.sources : []), ...(Array.isArray(record.tests) ? record.tests : [])]
        .flatMap((witness) =>
          typeof witness?.path === "string" && witness.path !== "" && !path.isAbsolute(witness.path)
            ? [witness.path]
            : []
        )
    )
  )
  const verified = new Map()
  for (const record of registry.records) {
    if (
      typeof record.surface_id !== "string" ||
      !surfaceIds.has(record.surface_id) ||
      DEFERRED_XMLRPC_CATALOG_FEATURES.has(record.surface_id) ||
      !Array.isArray(record.sources) ||
      record.sources.length === 0 ||
      !Array.isArray(record.tests) ||
      record.tests.length === 0
    ) {
      throw new Error(`${CATALOG_SOURCE_ATTRIBUTION} has an invalid row for ${record.surface_id}`)
    }
    const verifyWitnesses = (witnesses, kind) => witnesses.map((witness) => {
      if (
        typeof witness?.path !== "string" ||
        witness.path === "" ||
        path.isAbsolute(witness.path) ||
        witness.path.split("/").includes("..") ||
        typeof witness.anchor !== "string" ||
        witness.anchor === ""
      ) {
        throw new Error(`${CATALOG_SOURCE_ATTRIBUTION} has invalid ${kind} witness for ${record.surface_id}`)
      }
      if (!gitRevisionContains(root, sourceRevision, witness.path, witness.anchor)) {
        throw new Error(
          `${CATALOG_SOURCE_ATTRIBUTION} ${kind} witness drifted for ${record.surface_id}: ${witness.path}#${witness.anchor}`
        )
      }
      return `${witness.path}#${witness.anchor}`
    })
    verified.set(record.surface_id, {
      sources: verifyWitnesses(record.sources, "source"),
      tests: verifyWitnesses(record.tests, "test")
    })
  }
  return surfaces.map((record) => {
    const attribution = verified.get(record.surface_id)
    if (!attribution) return record
    return {
      ...record,
      source: phase("implemented", [...record.source.references, ...attribution.sources]),
      existing_refs: {
        ...record.existing_refs,
        tests: uniqueSortedStrings([...record.existing_refs.tests, ...attribution.tests])
      }
    }
  })
}

function framerailAmcModuleIssue(surfaceId) {
  const moduleName = surfaceId.slice("framerail-amc-module:".length).split(":")[0]
  if (moduleName === "pagerate/WhoRatedPageModule") return 1030
  if (moduleName === "membership/MembersListModule") return 1032
  if (moduleName.startsWith("forum/")) return 1034
  if (moduleName === "changes/SiteChangesListModule") return 1035
  if (moduleName === "files/PageFilesModule") return 1039
  if (moduleName === "viewsource/ViewSourceModule") return 1041
  if (moduleName.startsWith("history/")) return 1063
  if (moduleName === "list/ListPagesModule") return 1374
  throw new Error(`missing audited Framerail AMC module issue: ${surfaceId}`)
}

function auditedIssueForSurface(record) {
  switch (record.kind) {
    case "catalog_feature":
      if (DEFERRED_XMLRPC_CATALOG_FEATURES.has(record.surface_id)) return null
      return CATALOG_FEATURE_ISSUE_EXCEPTIONS.get(record.surface_id) ??
        AUDITED_CURRENT_CATALOG_ISSUES.fallback_issue
    case "deepwell_jsonrpc_method":
      return 1368
    case "wws_route":
      return record.surface_id.includes("/local--html/{page_slug}/{id}/{domain}") ? 1370 : 1369
    case "wikidot_py_amc_module_shape":
      return 1376
    case "framerail_xmlrpc_method":
      return 1375
    case "framerail_route":
      return FRAMERAIL_ROUTE_ISSUE_EXCEPTIONS.get(record.surface_id) ?? 1372
    case "framerail_server_action":
      return record.surface_id === "framerail-server-action:/-/settings?/display" ? 1063 : 1372
    case "framerail_amc_action_shape":
      if (record.surface_id === "framerail-amc-action:ForumAction:createPageDiscussionThread") return 839
      if (record.surface_id === "framerail-amc-action:misc/NewPageHelperAction:createNewPage") return 1371
      throw new Error(`missing audited Framerail AMC action issue: ${record.surface_id}`)
    case "framerail_amc_module_shape":
      return framerailAmcModuleIssue(record.surface_id)
    case "page_action": {
      const issue = PAGE_ACTION_ISSUES.get(record.surface_id)
      if (!issue) throw new Error(`missing audited page action issue: ${record.surface_id}`)
      return issue
    }
    default:
      return null
  }
}

function applyAuditedIssueOwnership(surfaces, auditedOwnershipActive) {
  if (!auditedOwnershipActive) return surfaces
  const assigned = surfaces.map((record) => {
    const issue = auditedIssueForSurface(record)
    if (issue === null) return record
    const existing = record.existing_refs.issues
    if (existing.length > 0 && (existing.length !== 1 || existing[0] !== issue)) {
      throw new Error(`audited issue conflicts with existing issue for ${record.surface_id}`)
    }
    return {
      ...record,
      existing_refs: {
        ...record.existing_refs,
        issues: [issue]
      }
    }
  })
  for (const [kind, expected] of Object.entries(AUDITED_ISSUE_GROUPS)) {
    const rows = assigned.filter((record) => record.kind === kind)
    const ids = rows.map(({ surface_id: surfaceId }) => surfaceId)
    const mapping = rows.map(({ surface_id: surfaceId, existing_refs: existingRefs }) =>
      `${surfaceId}\t${existingRefs.issues.join(",")}`
    )
    if (
      rows.length !== expected.count ||
      auditedLinesSha256(ids) !== expected.surface_ids_sha256 ||
      auditedLinesSha256(mapping) !== expected.mapping_sha256
    ) {
      throw new Error(`audited issue ownership drift for ${kind}`)
    }
  }
  const currentCatalogRows = assigned.filter((record) =>
    record.kind === "catalog_feature" && !DEFERRED_XMLRPC_CATALOG_FEATURES.has(record.surface_id)
  )
  const currentCatalogIds = currentCatalogRows.map(({ surface_id: surfaceId }) => surfaceId)
  const currentCatalogMapping = currentCatalogRows.map(
    ({ surface_id: surfaceId, existing_refs: existingRefs }) =>
      `${surfaceId}\t${existingRefs.issues.join(",")}`
  )
  const fallbackCatalogRows = currentCatalogRows.filter(
    ({ surface_id: surfaceId }) => !CATALOG_FEATURE_ISSUE_EXCEPTIONS.has(surfaceId)
  )
  const fallbackCatalogIds = fallbackCatalogRows.map(({ surface_id: surfaceId }) => surfaceId)
  const fallbackCatalogMapping = fallbackCatalogRows.map(
    ({ surface_id: surfaceId, existing_refs: existingRefs }) =>
      `${surfaceId}\t${existingRefs.issues.join(",")}`
  )
  if (
    currentCatalogRows.length !== AUDITED_CURRENT_CATALOG_ISSUES.count ||
    auditedLinesSha256(currentCatalogIds) !== AUDITED_CURRENT_CATALOG_ISSUES.surface_ids_sha256 ||
    auditedLinesSha256(currentCatalogMapping) !== AUDITED_CURRENT_CATALOG_ISSUES.mapping_sha256 ||
    fallbackCatalogRows.length !== AUDITED_CURRENT_CATALOG_ISSUES.fallback_count ||
    auditedLinesSha256(fallbackCatalogIds) !==
      AUDITED_CURRENT_CATALOG_ISSUES.fallback_surface_ids_sha256 ||
    auditedLinesSha256(fallbackCatalogMapping) !==
      AUDITED_CURRENT_CATALOG_ISSUES.fallback_mapping_sha256
  ) {
    throw new Error("audited current catalog issue ownership drift")
  }
  return assigned
}

function buildRelationshipModel(surfaces, ftmlRawSurfaceManifest, semantics) {
  const publicIds = new Set(surfaces.map(({ surface_id: surfaceId }) => surfaceId))
  if (publicIds.size !== surfaces.length) {
    const seen = new Set()
    const duplicate = surfaces.find(({ surface_id: surfaceId }) => {
      if (seen.has(surfaceId)) return true
      seen.add(surfaceId)
      return false
    })
    throw new Error(`duplicate surface_id: ${duplicate.surface_id}`)
  }
  const rawIds = new Set(
    ftmlRawSurfaceManifest.records.map(({ surface_id: surfaceId }) => surfaceId)
  )
  for (const surfaceId of rawIds) {
    if (publicIds.has(surfaceId)) throw new Error(`FTML raw surface is double-counted: ${surfaceId}`)
  }

  const specificationOwners = semantics.specification_owner_keys
  const implementationOwners = semantics.implementation_owner_keys
  for (const [name, owners] of [
    ["specification", specificationOwners],
    ["implementation", implementationOwners]
  ]) {
    if (!Array.isArray(owners) || new Set(owners).size !== owners.length) {
      throw new Error(`${SEMANTICS_REGISTRY} has missing or duplicate ${name} owner keys`)
    }
  }
  const usedSpecificationOwners = uniqueSortedStrings(
    surfaces.map(({ specification_owner: owner }) => owner)
  )
  const usedImplementationOwners = uniqueSortedStrings(
    surfaces.flatMap(({ implementation_owners: owners }) => owners)
  )
  if (JSON.stringify(specificationOwners) !== JSON.stringify(usedSpecificationOwners)) {
    throw new Error(`${SEMANTICS_REGISTRY} has missing or unused specification owner keys`)
  }
  if (JSON.stringify(implementationOwners) !== JSON.stringify(usedImplementationOwners)) {
    throw new Error(
      `${SEMANTICS_REGISTRY} has missing or unused implementation owner keys: expected ${JSON.stringify(implementationOwners)}, discovered ${JSON.stringify(usedImplementationOwners)}`
    )
  }
  const implementationOwnerSet = new Set(implementationOwners)
  const edges = []
  for (const record of surfaces) {
    for (const owner of record.implementation_owners) {
      edges.push({ source: record.surface_id, type: "implemented_by", target: owner })
    }
  }
  for (const row of ftmlRawSurfaceManifest.catalog_crosswalk) {
    const source = `catalog-feature:${row.feature_id}`
    if (!publicIds.has(source)) throw new Error(`FTML crosswalk has unknown catalog feature: ${source}`)
    for (const [field, type] of [
      ["parsed_by", "parsed_by"],
      ["rendered_by", "rendered_by"],
      ["tested_by", "tested_by"]
    ]) {
      for (const target of row[field]) edges.push({ source, type, target })
    }
  }
  for (const record of ftmlRawSurfaceManifest.records) {
    if (record.kind === "block_alias") {
      edges.push({ source: record.surface_id, type: "alias", target: record.canonical_surface })
    }
  }

  const edgeKeys = new Set()
  const edgeTypes = semantics.relationship_edge_types
  if (
    !Array.isArray(edgeTypes) ||
    new Set(edgeTypes).size !== edgeTypes.length ||
    edgeTypes.some((type) => !SUPPORTED_RELATIONSHIP_EDGE_TYPES.has(type)) ||
    [...SUPPORTED_RELATIONSHIP_EDGE_TYPES].some((type) => !edgeTypes.includes(type))
  ) {
    throw new Error(`${SEMANTICS_REGISTRY} has missing, duplicate, or unknown relationship edge types`)
  }
  const edgeTypeSet = new Set(edgeTypes)
  for (const edge of edges) {
    const key = `${edge.source}\u0000${edge.type}\u0000${edge.target}`
    if (edgeKeys.has(key)) throw new Error(`duplicate relationship edge: ${key}`)
    edgeKeys.add(key)
    if (!edgeTypeSet.has(edge.type)) throw new Error(`unknown relationship edge type: ${edge.type}`)
    if (!publicIds.has(edge.source) && !rawIds.has(edge.source)) {
      throw new Error(`relationship edge has unknown source: ${edge.source}`)
    }
    if (edge.type === "implemented_by") {
      if (!implementationOwnerSet.has(edge.target)) {
        throw new Error(`relationship edge has unknown implementation owner: ${edge.target}`)
      }
    } else if (!rawIds.has(edge.target)) {
      throw new Error(`relationship edge has unknown FTML target: ${edge.target}`)
    }
  }
  return {
    owner_keys: {
      specification: specificationOwners,
      implementation: implementationOwners
    },
    relationship_edges: edges.sort((left, right) =>
      `${left.source}\u0000${left.type}\u0000${left.target}`.localeCompare(
        `${right.source}\u0000${right.type}\u0000${right.target}`,
        "en"
      )
    )
  }
}

function validateInventory(surfaces, ownerKeys) {
  const identifiers = new Set()
  const specificationOwners = new Set(ownerKeys.specification)
  const implementationOwners = new Set(ownerKeys.implementation)
  for (const record of surfaces) {
    if (typeof record.surface_id !== "string" || record.surface_id === "") {
      throw new Error("compatibility surface is missing surface_id")
    }
    if (identifiers.has(record.surface_id)) {
      throw new Error(`duplicate surface_id: ${record.surface_id}`)
    }
    identifiers.add(record.surface_id)
    if (!specificationOwners.has(record.specification_owner)) {
      throw new Error(`unknown specification owner for ${record.surface_id}`)
    }
    if (
      !Array.isArray(record.implementation_owners) ||
      record.implementation_owners.some((owner) => !implementationOwners.has(owner))
    ) {
      throw new Error(`unknown implementation owner for ${record.surface_id}`)
    }
    if (!Array.isArray(record.public_reference) || record.public_reference.length === 0) {
      throw new Error(`missing public reference for ${record.surface_id}`)
    }
    for (const field of Object.keys(PHASE_STATUSES)) {
      const status = record[field]?.status
      if (!PHASE_STATUSES[field].has(status)) {
        throw new Error(`unknown ${field} status for ${record.surface_id}: ${status}`)
      }
    }
  }
}

async function buildInventory(root, sourceRevision) {
  SOURCE_INPUTS.clear()
  const wikidotPySource = await loadSupportedWikidotPySource(root)
  const [
    provenance,
    catalog,
    deepwell,
    framerailRoutes,
    amc,
    wikidotPyAmc,
    xmlRpc,
    pageActions,
    wws,
    open43,
    semantics
  ] =
    await Promise.all([
      sourceProvenance(root, sourceRevision),
      discoverCatalogFeatures(root),
      discoverDeepwellJsonRpc(root),
      discoverFramerailRoutes(root),
      discoverFramerailAmc(root),
      discoverWikidotPyAmc(root, wikidotPySource),
      discoverFramerailXmlRpc(root),
      discoverPageActionSurfaces(root),
      discoverWwsRoutes(root),
      discoverOpen43AuditCases(root),
      readJson(root, SEMANTICS_REGISTRY)
    ])
  validateSemanticsRegistry(semantics)
  const ftmlRawSurfaceManifest = discoverFtmlRawSurfaceManifest(
    provenance.ftml,
    JSON.parse(SOURCE_INPUTS.get("docs/wikidot-specifications/catalog.json")),
    semantics
  )
  const auditedOwnershipActive =
    sha256(SOURCE_INPUTS.get("docs/wikidot-specifications/catalog.json")) === AUDITED_CATALOG_SHA256
  const projectedFramerailRoutes = auditedOwnershipActive
    ? await applyFramerailRouteActionEvidence(
        root,
        framerailRoutes,
        sourceRevision
      )
    : framerailRoutes
  const projectedAmcEvidence = await applySiteChangesEvidence(root, amc)
  const projectedAmc = auditedOwnershipActive
    ? applyFramerailAmcTests(root, projectedAmcEvidence, sourceRevision)
    : projectedAmcEvidence
  const projectedWws = auditedOwnershipActive
    ? await applyWwsContractEvidence(root, wws, sourceRevision)
    : wws
  verifyRegistryBlobs(root, sourceRevision)
  const ftmlProjectedSources = applyFtmlCatalogSourceProjection([
    ...catalog,
    ...deepwell,
    ...projectedFramerailRoutes,
    ...projectedAmc,
    ...wikidotPyAmc,
    ...xmlRpc,
    ...pageActions,
    ...projectedWws,
    ...open43.records
  ].sort((left, right) => left.surface_id.localeCompare(right.surface_id, "en")), ftmlRawSurfaceManifest)
  const projectedSources = await applyCatalogSourceAttribution(
    root,
    ftmlProjectedSources,
    sourceRevision
  )
  const surfaces = normalizeSurfaceOwners(
    applyAuditedIssueOwnership(projectedSources, auditedOwnershipActive),
    ftmlRawSurfaceManifest.catalog_crosswalk,
    semantics,
    auditedOwnershipActive
  )
  const relationshipModel = buildRelationshipModel(surfaces, ftmlRawSurfaceManifest, semantics)
  validateInventory(surfaces, relationshipModel.owner_keys)
  const byKind = {}
  for (const kind of uniqueSortedStrings(surfaces.map(({ kind }) => kind))) {
    byKind[kind] = surfaces.filter((surfaceRecord) => surfaceRecord.kind === kind).length
  }
  const registries = [...SOURCE_INPUTS]
    .map(([registryPath, source]) => ({ path: registryPath, sha256: sha256(source) }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"))
  return {
    schema: SCHEMA,
    relationship_edge_types: [...semantics.relationship_edge_types],
    ...relationshipModel,
    ftml_raw_surface_manifest: ftmlRawSurfaceManifest,
    provenance: {
      wikijump: {
        source_input_set_sha256: sourceInputSetSha256(registries)
      },
      ftml: provenance.ftml,
      registries
    },
    sources: {
      catalog: "docs/wikidot-specifications/catalog.json",
      live_observations: "docs/wikidot-specifications/live-observations.json",
      implementation_ledger: CANONICAL_IMPLEMENTATION_LEDGER,
      implementation_ledger_mirror: "docs/wikidot-specifications/implementation-ledger.json",
      source_coverage: "docs/wikidot-specifications/source-coverage.json",
      compatibility_surface_semantics: SEMANTICS_REGISTRY,
      compatibility_catalog_source_attribution: CATALOG_SOURCE_ATTRIBUTION,
      audited_ownership_reports: AUDITED_OWNERSHIP_REPORTS,
      deepwell_jsonrpc_registry: "deepwell/src/api.rs",
      framerail_routes_root: "framerail/src/routes",
      framerail_amc_registry: "framerail/src/lib/server/ajax-module-connector.js",
      framerail_amc_wire_contracts: "docs/development/framerail-amc-wire-contracts.json",
      framerail_amc_live_evidence: SITE_CHANGES_EVIDENCE_ARTIFACT,
      wikidot_py_amc_contract: "docs/development/wikidot-py-amc-client-parity.json",
      wikidot_py_source: {
        repository: wikidotPySource.repository,
        commit: wikidotPySource.commit,
        root_tree: wikidotPySource.root_tree,
        objects: [...wikidotPySource.objects].map(([objectPath, [type, oid]]) => ({
          path: objectPath,
          type,
          oid
        }))
      },
      framerail_xmlrpc_registry: "framerail/src/lib/server/xmlrpc/methods.ts",
      page_action_registry: "docs/development/wikidot-page-action-surfaces.json",
      wws_route_registry: "wws/src/route.rs",
      open43_audits: open43.auditPaths
    },
    counts: { total: surfaces.length, by_kind: byKind },
    surfaces
  }
}

async function pinnedSourceRevision(root, requestedRevision) {
  if (requestedRevision) return requestedRevision
  return null
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const sourceRevision = await pinnedSourceRevision(options.root, options.sourceRevision)
  const inventory = await buildInventory(options.root, sourceRevision)
  await writeRepositoryOutput(options.root, options.output, `${JSON.stringify(inventory, null, 2)}\n`)
  const outputReference = path.relative(options.root, options.output)
  process.stdout.write(
    `wrote ${inventory.counts.total} compatibility surfaces to ${
      outputReference.startsWith("..") ? options.output : toPosix(outputReference)
    }\n`
  )
}

main().catch((error) => {
  process.stderr.write(`compatibility inventory failed: ${error.message}\n`)
  process.exitCode = 1
})
