#!/usr/bin/env node

import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const SCHEMA = "wikijump.compatibility_surface_inventory.v2"
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../../..")
const DEFAULT_OUTPUT = "docs/development/compatibility-surface-inventory.json"
const SEMANTICS_REGISTRY = "docs/development/compatibility-surface-semantics.json"
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
const WIKIDOT_PY_SOURCE = {
  repository: "Rokurolize/wikidot.py",
  commit: "9f33c0f450de9daf333b068e8d70527e033fc07c",
  root_tree: "7511e9dc88e5f585ff44f58a6275ff2634c34e3c",
  objects: new Map([
    ["src/wikidot", ["tree", "e4c0e5299b6b68c771a2bf263c656d73f2ffdd38"]],
    ["src/wikidot/module", ["tree", "514e1dfe6cada07f123f4f922c815fafe71ccc4b"]],
    ["src/wikidot/connector", ["tree", "5e53e6b1bb4cc3591055100c99fcc8ed53ef0a7f"]],
    ["src/wikidot/connector/ajax.py", ["blob", "9566f18a37cee098c371519963eeaadb56121e81"]],
    ["pyproject.toml", ["blob", "7d2ed894e868994ce41af5fa83b4494fcb43cd07"]],
    ["uv.lock", ["blob", "30a21e269683d755c5715cc937e332c8442143aa"]]
  ])
}
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
const AUDITED_CATALOG_SHA256 = "f79aee6963a4c4428261b1bb0b4b8f0411a39cebc9d944f064f1b118153e5090"
const AUDITED_CATALOG_FALLBACK = Object.freeze({
  count: 95,
  surface_ids_sha256: "82cce4db95e2a070f1bbdd192dcce8254f7ded92632969781771ac81f902d6a5",
  mapping_sha256: "b00d1e43079102c83db2af1bab96584d46c12ce41218b12fa0ea36b427e3fb4e"
})
const AUDITED_CURRENT_CATALOG_ISSUES = Object.freeze({
  count: 195,
  surface_ids_sha256: "3a2cf09c168b37eb4539336cca7807f06585ece006a3327c2b2093b327424377",
  mapping_sha256: "bf8c3ed6eebb5592cef108488dcc6c285d9b39eaf5224f8616a71f4b30708082",
  fallback_issue: 1387,
  fallback_count: 183,
  fallback_surface_ids_sha256: "099e4b58d64be1758cb0df253e224419032a52b6066f911fe8e21fec5b796074",
  fallback_mapping_sha256: "db854ca4e40491f39575e2fe35d4925590abecb0058200db7e48f1dbb1256dd8"
})
const AUDITED_ISSUE_GROUPS = Object.freeze({
  deepwell_jsonrpc_method: Object.freeze({ count: 163, surface_ids_sha256: "307624e11c494a0fc894236e9f1c3da6665833ec7778418afe1116f39eea1a12", mapping_sha256: "4db63ea2576db5fa7df9993c3d1a56d646d5f089b65ad18b69a262494039e297" }),
  framerail_route: Object.freeze({ count: 28, surface_ids_sha256: "df0699905bb6b1c0a333c910f934d96d9ef1914a0d71e00659522d6be17280cc", mapping_sha256: "51b480159bbc424faf3199e75f50650b1f23d9a3eea0bdee1682ae89adc47a3d" }),
  framerail_server_action: Object.freeze({ count: 97, surface_ids_sha256: "f1d6baa4652c07e181839c8efb90709c35c76154e95f0b71f15c94c0cd9f2dfc", mapping_sha256: "3cc1f313532c1664c989c02e121b4476f25642b48f55a6f5958fc92c97d513a3" }),
  framerail_amc_action_shape: Object.freeze({ count: 2, surface_ids_sha256: "69e643ef40a7efffbcc2cea03dc0f864aa0fb62d51ab8fd0c6062c74af9bee49", mapping_sha256: "945b06829bdf00f44c78040b1b2a4f793bb3e67325c98a94cffee4079c008646" }),
  framerail_amc_module_shape: Object.freeze({ count: 26, surface_ids_sha256: "171e867231c0bf70f6b9078393c6be28877cafa9b21233195e1c4fdbdc3f0f24", mapping_sha256: "a62ecebad82b6cfd8cf114e65d39bdfd5f23b02d32e2f63cfe06876d20e60398" }),
  page_action: Object.freeze({ count: 25, surface_ids_sha256: "7650ecd18142446eb1c4f557ad13bc525cdd541b31dcbc982ea1f92288f0e206", mapping_sha256: "98ebacfd535793c5c4996797ea2c206f3edea85852520705b01a3f9dd03faad6" }),
  framerail_xmlrpc_method: Object.freeze({ count: 17, surface_ids_sha256: "862b1daa07ba126424e6021d306854f2c431073c024e1497a0ed5ab65b0d118d", mapping_sha256: "8862712f0d5acc1e73ff31f873d4ed8a8e7d2c01afc74ce988894e38508f9a34" }),
  wws_route: Object.freeze({ count: 47, surface_ids_sha256: "ab5f11a51af87a193c5f3b032a3b79c2e0c3ea1f787c35bb8c9d4d1c474569ab", mapping_sha256: "3cbd7115f9f7a4463abca2965c29a44418dd28013df29c5f396c52a562841bfa" }),
  wikidot_py_amc_module_shape: Object.freeze({ count: 22, surface_ids_sha256: "4af71683f0059a07403b6cba86cb1d8961e9b9b4c1b2f3be158b2e7bd2918123", mapping_sha256: "a7cd9e3f642420977c413a97231131d38f56e0374e3440955e081b417e3ac48f" })
})
const CATALOG_SPLIT_IMPLEMENTATION_OWNERS = new Set([
  "catalog-feature:module-countpages",
  "catalog-feature:module-listpages",
  "catalog-feature:page-inclusions",
  "catalog-feature:syntax-engine"
])
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
  ["catalog-feature:module-comments", 1034],
  ["catalog-feature:module-forumcategory", 1034],
  ["catalog-feature:module-forumnewthread", 1034],
  ["catalog-feature:module-forumstart", 1034],
  ["catalog-feature:module-forumthread", 1034],
  ["catalog-feature:module-frontforum", 1034],
  ["catalog-feature:module-managesite", 1038],
  ["catalog-feature:module-members", 1032],
  ["catalog-feature:module-petitionadmin", 1038],
  ["catalog-feature:module-recentposts", 1034],
  ["catalog-feature:module-recentthreads", 1034],
  ["catalog-feature:module-sitechanges", 1035]
])

function pinnedWikidotPyAmcModules() {
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
      WIKIDOT_PY_SOURCE.commit,
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

function verifyPinnedWikidotPySource() {
  const identities = [
    [`${WIKIDOT_PY_SOURCE.commit}^{tree}`, WIKIDOT_PY_SOURCE.root_tree],
    ...[...WIKIDOT_PY_SOURCE.objects].map(([objectPath, [, oid]]) => [
      `${WIKIDOT_PY_SOURCE.commit}:${objectPath}`,
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
const AUDIT_CLASSIFICATIONS = new Set([
  "source_ready",
  "needs_source",
  "candidate_required",
  "blocked_evidence"
])
const BLOCKED_ROUTE_CLASSES = new Set([
  "anonymous_read_only",
  "authenticated_read_only",
  "run_owned_mutation",
  "local_candidate",
  "live_browser_only",
  "missing_public_producer",
  "missing_architecture_domain_authority",
  "missing_security_policy"
])
const BLOCKED_ROUTE_STATUSES = new Set([
  "not_attempted_not_safe",
  "partial_evidence_acquired",
  "blocked_no_positive_fixture",
  "blocked_missing_domain_authority",
  "blocked_no_provider_success",
  "blocked_no_mapping"
])
const HTTP_METHOD_NAMES = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
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
  return {
    root,
    output: output ?? path.join(root, DEFAULT_OUTPUT),
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

async function readJson(root, relativePath) {
  const absolutePath = path.join(root, relativePath)
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
    const source = await fs.readFile(path.join(root, relativePath), "utf8")
    SOURCE_INPUTS.set(toPosix(relativePath), source)
    return source
  } catch (error) {
    throw new Error(`cannot read ${relativePath}: ${error.message}`)
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
  const wikijumpTree = resolveGitObject(["-C", root], `${wikijumpCommit}^{tree}`, "Wikijump tree")
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
    wikijump: { commit: wikijumpCommit, tree: wikijumpTree },
    ftml: { commit: ftmlCommit, tree: ftmlTree }
  }
}

function verifyRegistryBlobs(root, sourceRevision) {
  for (const [registryPath, source] of SOURCE_INPUTS) {
    let pinnedSource
    try {
      pinnedSource = execFileSync(
        GIT_EXECUTABLE,
        ["--no-replace-objects", "-C", root, "show", `${sourceRevision}:${registryPath}`],
        { env: GIT_ENVIRONMENT, stdio: ["ignore", "pipe", "ignore"] }
      )
    } catch {
      throw new Error(`registry is missing from pinned revision: ${registryPath}`)
    }
    if (sha256(pinnedSource) !== sha256(source)) {
      throw new Error(`registry blob drift: ${registryPath}`)
    }
  }
}

function readFtmlObject(revision, objectPath, sources) {
  let bytes
  try {
    bytes = execFileSync(
      GIT_EXECUTABLE,
      ["--no-replace-objects", `--git-dir=${FTML_GIT_DIR}`, "show", `${revision}:${objectPath}`],
      { env: GIT_ENVIRONMENT, stdio: ["ignore", "pipe", "ignore"] }
    )
  } catch {
    throw new Error(`cannot read pinned FTML source: ${objectPath}`)
  }
  const blob = resolveGitObject(
    [`--git-dir=${FTML_GIT_DIR}`],
    `${revision}:${objectPath}`,
    `FTML source ${objectPath}`
  )
  sources.set(objectPath, { path: objectPath, blob, sha256: sha256(bytes) })
  return bytes.toString("utf8")
}

function listFtmlFiles(revision, prefix) {
  let output
  try {
    output = execFileSync(
      GIT_EXECUTABLE,
      [
        "--no-replace-objects",
        `--git-dir=${FTML_GIT_DIR}`,
        "ls-tree",
        "-r",
        "--name-only",
        revision,
        "--",
        prefix
      ],
      { encoding: "utf8", env: GIT_ENVIRONMENT, stdio: ["ignore", "pipe", "ignore"] }
    )
  } catch {
    throw new Error(`cannot list pinned FTML source: ${prefix}`)
  }
  return output.trim().split("\n").filter(Boolean)
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
  const sources = new Map()
  const records = []
  const add = (record) => records.push(record)

  const lexerPath = "src/parsing/lexer.pest"
  const lexer = readFtmlObject(revision, lexerPath, sources)
  for (const name of [...lexer.matchAll(/^([a-z_][a-z0-9_]*)\s*=/gmu)].map((match) => match[1])) {
    add(ftmlRecord(`ftml.tokenizer:${name}`, "lexer_rule", name, lexerPath))
  }

  const parserFunctionsPath = "src/preproc/parser_functions/mod.rs"
  const parserFunctions = readFtmlObject(revision, parserFunctionsPath, sources)
  for (const name of [...parserFunctions.matchAll(/^\s*"(if|ifexpr|expr)"\s*=>\s*ParserFunctionKind::/gmu)].map((match) => `#${match[1]}`)) {
    add(ftmlRecord(`ftml.preprocessor:${name}`, "parser_function", name, parserFunctionsPath))
  }

  const blocksPath = "conf/blocks.toml"
  const blocks = readFtmlObject(revision, blocksPath, sources)
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
  for (const modulePath of listFtmlFiles(revision, moduleRoot).filter((value) => value.endsWith(".rs") && !value.endsWith("/mod.rs"))) {
    const moduleSource = readFtmlObject(revision, modulePath, sources)
    const name = /accepts_names:\s*&\["([A-Za-z]+)"\]/u.exec(moduleSource)?.[1]
    if (!name) throw new Error(`${modulePath} has no typed module name`)
    add(ftmlRecord(`ftml.module:${name}`, "typed_module", name, modulePath))
  }

  const astPath = "src/tree/element/object.rs"
  const ast = readFtmlObject(revision, astPath, sources)
  for (const name of rustEnumVariants(ast, "Element", astPath)) {
    add(ftmlRecord(`ftml.ast:${name}`, "ast_variant", name, astPath))
  }

  const delayedPath = "src/delayed.rs"
  const delayed = readFtmlObject(revision, delayedPath, sources)
  for (const name of rustEnumVariants(delayed, "DelayedNode", delayedPath)) {
    add(ftmlRecord(`ftml.delayed:${name}`, "delayed_form", name, delayedPath))
  }
  for (const name of rustEnumVariants(delayed, "GeneratedKind", delayedPath)) {
    add(ftmlRecord(`ftml.generated:${name}`, "generated_runtime_kind", name, delayedPath))
  }

  const rendererRoot = "src/render/html/element"
  const rendererIndexPath = `${rendererRoot}/mod.rs`
  const rendererIndex = readFtmlObject(revision, rendererIndexPath, sources)
  add(ftmlRecord("ftml.renderer:dispatcher", "renderer_module", "dispatcher", rendererIndexPath))
  for (const name of [...rendererIndex.matchAll(/^mod\s+([a-z_]+);$/gmu)].map((match) => match[1])) {
    const rendererPath = `${rendererRoot}/${name}.rs`
    readFtmlObject(revision, rendererPath, sources)
    add(ftmlRecord(`ftml.renderer:${name}`, "renderer_module", name, rendererPath))
  }

  for (const fixturePath of listFtmlFiles(revision, "test").filter((value) => value.endsWith("/wikidot.html"))) {
    readFtmlObject(revision, fixturePath, sources)
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

function classificationCounts(rows) {
  return Object.fromEntries(
    [...AUDIT_CLASSIFICATIONS].map((classification) => [
      classification,
      rows.filter((row) => row.classification === classification).length
    ])
  )
}

function assertSameCounts(actual, expected, context) {
  for (const key of AUDIT_CLASSIFICATIONS) {
    if (expected?.[key] !== actual[key]) {
      throw new Error(`${context} ${key} count does not match: expected ${actual[key]}`)
    }
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
  const sourceText = await readText(root, registryPath)
  const methods = [...sourceText.matchAll(/register!\s*\(\s*"([^"]+)"\s*,/gu)].map(
    (match) => match[1]
  )
  if (methods.length === 0) throw new Error(`${registryPath} declares no JSON-RPC methods`)
  return methods.map((method) =>
    surface({
      surfaceId: `deepwell-jsonrpc:${method}`,
      kind: "deepwell_jsonrpc_method",
      publicOwner: "deepwell",
      publicReference: [`${registryPath}#register:${method}`]
    })
  )
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(target)))
    else if (entry.isFile()) files.push(target)
  }
  return files
}

function routeSegment(segment) {
  return segment
    .replaceAll(/\[x\+([0-9a-fA-F]{2})\]/gu, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replaceAll(/\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]/gu, "{*$1}")
    .replaceAll(/\[([A-Za-z_][A-Za-z0-9_]*)(?:=[^\]]+)?\]/gu, "{$1}")
}

function routePathFromDirectory(routesRoot, directory) {
  const relative = path.relative(routesRoot, directory)
  if (relative === "") return "/"
  return `/${relative.split(path.sep).map(routeSegment).join("/")}`
}

function extractBalanced(sourceText, start, openCharacter, closeCharacter) {
  if (sourceText[start] !== openCharacter) {
    throw new Error(`expected ${openCharacter} at registry expression offset ${start}`)
  }
  let depth = 0
  let quote = null
  let escaped = false
  for (let index = start; index < sourceText.length; index += 1) {
    const character = sourceText[index]
    if (quote !== null) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character
      continue
    }
    if (character === openCharacter) depth += 1
    else if (character === closeCharacter) {
      depth -= 1
      if (depth === 0) return sourceText.slice(start, index + 1)
    }
  }
  throw new Error(`unterminated ${openCharacter}${closeCharacter} registry expression`)
}

function splitTopLevel(sourceText) {
  const entries = []
  let start = 0
  let quote = null
  let escaped = false
  const depths = { "(": 0, "[": 0, "{": 0 }
  const closing = { ")": "(", "]": "[", "}": "{" }
  for (let index = 0; index < sourceText.length; index += 1) {
    const character = sourceText[index]
    if (quote !== null) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character
      continue
    }
    if (Object.hasOwn(depths, character)) depths[character] += 1
    else if (Object.hasOwn(closing, character)) depths[closing[character]] -= 1
    else if (character === "," && Object.values(depths).every((depth) => depth === 0)) {
      entries.push(sourceText.slice(start, index).trim())
      start = index + 1
    }
  }
  const finalEntry = sourceText.slice(start).trim()
  if (finalEntry !== "") entries.push(finalEntry)
  return entries
}

function objectPropertyNames(objectExpression, declaration) {
  const body = objectExpression.slice(1, -1)
  return splitTopLevel(body).map((entry) => {
    const match = entry.match(/^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/u)
    if (!match) throw new Error(`unsupported property in ${declaration}: ${entry}`)
    return match[1] ?? match[2] ?? match[3]
  })
}

function maskTypeScriptCommentsAndLiterals(sourceText, reference) {
  const masked = sourceText.split("")
  const blank = (start, end) => {
    for (let index = start; index < end; index += 1) {
      if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " "
    }
  }
  let index = 0
  while (index < sourceText.length) {
    if (sourceText.startsWith("//", index)) {
      const newline = sourceText.indexOf("\n", index + 2)
      const end = newline < 0 ? sourceText.length : newline
      blank(index, end)
      index = end
      continue
    }
    if (sourceText.startsWith("/*", index)) {
      const close = sourceText.indexOf("*/", index + 2)
      if (close < 0) throw new Error(`${reference} contains an unterminated block comment`)
      const end = close + 2
      blank(index, end)
      index = end
      continue
    }
    const quote = sourceText[index]
    if (quote === '"' || quote === "'" || quote === "`") {
      let cursor = index + 1
      let escaped = false
      while (cursor < sourceText.length) {
        const character = sourceText[cursor]
        if (escaped) escaped = false
        else if (character === "\\") escaped = true
        else if (character === quote) break
        cursor += 1
      }
      if (cursor >= sourceText.length) {
        throw new Error(`${reference} contains an unterminated TypeScript literal`)
      }
      blank(index + 1, cursor)
      index = cursor + 1
      continue
    }
    index += 1
  }
  return masked.join("")
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

async function resolveModulePath(root, fromPath, specifier) {
  const base = specifier.startsWith("$lib/")
    ? path.join(root, "framerail/src/lib", specifier.slice("$lib/".length))
    : path.resolve(path.dirname(fromPath), specifier)
  const candidates = [base, `${base}.ts`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.js")]
  for (const candidate of candidates) {
    try {
      const metadata = await fs.stat(candidate)
      if (metadata.isFile()) return candidate
    } catch {
      // Continue through the finite SvelteKit module resolution candidates.
    }
  }
  throw new Error(`cannot resolve action registry ${specifier} from ${relativeReference(root, fromPath)}`)
}

function importedBinding(sourceText, localName) {
  for (const match of sourceText.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/gu)) {
    for (const binding of match[1].split(",")) {
      const parts = binding.trim().split(/\s+as\s+/u)
      const imported = parts[0]?.trim()
      const local = (parts[1] ?? parts[0])?.trim()
      if (local === localName) return { imported, specifier: match[2] }
    }
  }
  return null
}

async function resolveNamedActionObject(root, filePath, exportName, visited) {
  const visitKey = `${filePath}:${exportName}`
  if (visited.has(visitKey)) throw new Error(`cyclic action registry export: ${visitKey}`)
  visited.add(visitKey)
  const sourceText = await readAbsoluteText(root, filePath)
  const declaration = new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*`, "u").exec(sourceText)
  if (declaration) {
    const expressionStart = declaration.index + declaration[0].length
    if (sourceText[expressionStart] !== "{") {
      throw new Error(`action registry ${relativeReference(root, filePath)}#${exportName} is not an object literal`)
    }
    const expression = extractBalanced(sourceText, expressionStart, "{", "}")
    return {
      names: objectPropertyNames(expression, `${relativeReference(root, filePath)}#${exportName}`),
      references: [relativeReference(root, filePath)]
    }
  }
  throw new Error(`missing exported action registry ${relativeReference(root, filePath)}#${exportName}`)
}

async function resolveRouteActions(root, filePath, visited = new Set()) {
  const sourceText = await readAbsoluteText(root, filePath)
  const direct = /export\s+const\s+actions\s*=\s*/u.exec(sourceText)
  if (direct) {
    const expressionStart = direct.index + direct[0].length
    if (sourceText[expressionStart] === "{") {
      const expression = extractBalanced(sourceText, expressionStart, "{", "}")
      return {
        names: objectPropertyNames(expression, `${relativeReference(root, filePath)}#actions`),
        references: [relativeReference(root, filePath)]
      }
    }
    const alias = sourceText.slice(expressionStart).match(/^([A-Za-z_$][A-Za-z0-9_$]*)/u)?.[1]
    if (!alias) throw new Error(`unsupported actions declaration in ${relativeReference(root, filePath)}`)
    const binding = importedBinding(sourceText, alias)
    if (!binding) throw new Error(`unresolved actions alias ${alias} in ${relativeReference(root, filePath)}`)
    const target = await resolveModulePath(root, filePath, binding.specifier)
    const resolved = await resolveNamedActionObject(root, target, binding.imported, visited)
    return {
      names: resolved.names,
      references: uniqueSortedStrings([relativeReference(root, filePath), ...resolved.references])
    }
  }
  const reexport = /export\s*\{([^}]*\bactions\b[^}]*)\}\s*from\s*["']([^"']+)["']/u.exec(sourceText)
  if (reexport) {
    const target = await resolveModulePath(root, filePath, reexport[2])
    const resolved = await resolveRouteActions(root, target, visited)
    return {
      names: resolved.names,
      references: uniqueSortedStrings([relativeReference(root, filePath), ...resolved.references])
    }
  }
  return { names: [], references: [] }
}

function serverRouteMethods(sourceText, reference) {
  const methods = HTTP_METHOD_NAMES.filter((method) =>
    new RegExp(`export\\s+(?:async\\s+function|const)\\s+${method}\\b`, "u").test(sourceText)
  )
  if (methods.length === 0) throw new Error(`${reference} declares no public HTTP method`)
  return methods
}

async function discoverFramerailRoutes(root) {
  const routesRoot = path.join(root, "framerail/src/routes")
  const allFiles = await listFiles(routesRoot)
  const routeFiles = allFiles.filter((filePath) =>
    /\+(?:page\.svelte|page\.server\.(?:ts|js)|server\.(?:ts|js))$/u.test(filePath)
  )
  const routes = new Map()
  const actionRecords = []
  for (const filePath of routeFiles.sort()) {
    const sourceText = await readAbsoluteText(root, filePath)
    const directory = path.dirname(filePath)
    const routePath = routePathFromDirectory(routesRoot, directory)
    const reference = relativeReference(root, filePath)
    const directoryReference = relativeReference(root, directory)
    const current = routes.get(routePath)
    if (current && current.directoryReference !== directoryReference) {
      throw new Error(`duplicate Framerail route after path decoding: ${routePath}`)
    }
    const route = current ?? {
      directoryReference,
      references: [],
      methods: new Set()
    }
    route.references.push(reference)
    if (/\+server\.(?:ts|js)$/u.test(filePath)) {
      for (const method of serverRouteMethods(sourceText, reference)) route.methods.add(method)
    } else {
      route.methods.add("GET")
    }
    routes.set(routePath, route)

    if (/\+page\.server\.(?:ts|js)$/u.test(filePath)) {
      const actionRegistry = await resolveRouteActions(root, filePath)
      for (const actionName of actionRegistry.names) {
        actionRecords.push(
          surface({
            surfaceId: `framerail-server-action:${routePath}?/${actionName}`,
            kind: "framerail_server_action",
            publicOwner: "framerail",
            publicReference: actionRegistry.references.map(
              (actionReference) => `${actionReference}#action:${actionName}`
            )
          })
        )
      }
    }
  }

  const routeRecords = [...routes.entries()].map(([routePath, route]) =>
    surface({
      surfaceId: `framerail-route:${routePath}`,
      kind: "framerail_route",
      publicOwner: "framerail",
      publicReference: route.references.map(
        (reference) => `${reference}#methods:${[...route.methods].sort().join(",")}`
      )
    })
  )
  return [...routeRecords, ...actionRecords]
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
  if (JSON.stringify(listPagesContract.required_fields) !== JSON.stringify(["module_body"])) {
    throw new Error(`${wireContractPath} ${listPagesModule} must require module_body`)
  }
  records.push(
    surface({
      surfaceId: `framerail-amc-module:${listPagesModule}:parameters=${contractParameters.join(",")};module_body=required`,
      kind: "framerail_amc_module_shape",
      publicOwner: "framerail",
      publicReference: [wireContractPath, registryPath, ...listPagesContract.implementation_references]
    })
  )
  for (const [field, selector] of [
    ["parameter_order", "parameter-order"],
    ["duplicate_fields", "duplicate-fields"],
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

async function discoverWikidotPyAmc(root) {
  const contractPath = "docs/development/wikidot-py-amc-client-parity.json"
  const contract = await readJson(root, contractPath)
  if (contract.schema !== "wikijump.wikidot_py_amc_client_parity.v1") {
    throw new Error(`unknown Wikidot.py AMC contract schema: ${contract.schema}`)
  }
  const objects = contract.source?.objects
  const objectPaths = Array.isArray(objects) ? objects.map(({ path: objectPath }) => objectPath) : []
  if (
    contract.source?.repository !== WIKIDOT_PY_SOURCE.repository ||
    contract.source?.commit !== WIKIDOT_PY_SOURCE.commit ||
    contract.source?.root_tree !== WIKIDOT_PY_SOURCE.root_tree ||
    !Array.isArray(objects) ||
    objects.length !== WIKIDOT_PY_SOURCE.objects.size ||
    new Set(objectPaths).size !== objectPaths.length ||
    objects.some(({ path: objectPath, type, oid }) => {
      const expected = WIKIDOT_PY_SOURCE.objects.get(objectPath)
      return expected?.[0] !== type || expected?.[1] !== oid
    })
  ) {
    throw new Error(`${contractPath} source identity drift`)
  }
  if (!Array.isArray(contract.modules)) {
    throw new Error(`${contractPath} modules must be an array`)
  }
  verifyPinnedWikidotPySource()
  const moduleNames = contract.modules.map(({ module_name: moduleName }) => moduleName)
  if (
    new Set(moduleNames).size !== moduleNames.length ||
    JSON.stringify([...new Set(moduleNames)].sort()) !== JSON.stringify(pinnedWikidotPyAmcModules())
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

const WWS_DIRECT_METHODS = new Map([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["patch", "PATCH"],
  ["delete", "DELETE"],
  ["head", "HEAD"],
  ["options", "OPTIONS"]
])
const WWS_METHOD_FILTERS = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE"
])
const RUST_DELIMITER_PAIRS = new Map([["(", ")"], ["[", "]"], ["{", "}"]])

function scanRustTokens(sourceText, reference) {
  const tokens = []
  let index = 0
  while (index < sourceText.length) {
    const character = sourceText[index]
    if (/\s/u.test(character)) {
      index += 1
      continue
    }
    if (sourceText.startsWith("//", index)) {
      const newline = sourceText.indexOf("\n", index + 2)
      index = newline < 0 ? sourceText.length : newline + 1
      continue
    }
    if (sourceText.startsWith("/*", index)) {
      let depth = 1
      let cursor = index + 2
      while (cursor < sourceText.length && depth > 0) {
        if (sourceText.startsWith("/*", cursor)) {
          depth += 1
          cursor += 2
        } else if (sourceText.startsWith("*/", cursor)) {
          depth -= 1
          cursor += 2
        } else {
          cursor += 1
        }
      }
      if (depth !== 0) throw new Error(`${reference} contains an unterminated block comment`)
      index = cursor
      continue
    }

    const rawString = /^(?:b|c)?r(#+)?"/u.exec(sourceText.slice(index))
    if (rawString) {
      const hashes = rawString[1] ?? ""
      const contentStart = index + rawString[0].length
      const terminator = `"${hashes}`
      const end = sourceText.indexOf(terminator, contentStart)
      if (end < 0) throw new Error(`${reference} contains an unterminated raw string`)
      tokens.push({
        kind: "string",
        value: sourceText.slice(contentStart, end)
      })
      index = end + terminator.length
      continue
    }

    const stringPrefixLength = (character === "b" || character === "c") && sourceText[index + 1] === '"' ? 1 : 0
    if (character === '"' || stringPrefixLength === 1) {
      const quote = index + stringPrefixLength
      let cursor = quote + 1
      let escaped = false
      while (cursor < sourceText.length) {
        const current = sourceText[cursor]
        if (escaped) escaped = false
        else if (current === "\\") escaped = true
        else if (current === '"') break
        cursor += 1
      }
      if (cursor >= sourceText.length) throw new Error(`${reference} contains an unterminated string`)
      tokens.push({
        kind: "string",
        value: sourceText.slice(quote + 1, cursor)
      })
      index = cursor + 1
      continue
    }

    if (character === "'") {
      let cursor = index + 1
      if (sourceText[cursor] === "\\") {
        cursor += 1
        if (sourceText[cursor] === "u" && sourceText[cursor + 1] === "{") {
          const unicodeClose = sourceText.indexOf("}", cursor + 2)
          cursor = unicodeClose < 0 ? sourceText.length : unicodeClose + 1
        } else if (sourceText[cursor] === "x") {
          cursor += 3
        } else {
          cursor += 1
        }
      } else {
        const codePoint = sourceText.codePointAt(cursor)
        if (codePoint !== undefined) cursor += String.fromCodePoint(codePoint).length
      }
      if (sourceText[cursor] === "'") {
        tokens.push({ kind: "character", value: "" })
        index = cursor + 1
      } else {
        tokens.push({ kind: "punctuation", value: character })
        index += 1
      }
      continue
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(sourceText.slice(index))
    if (identifier) {
      tokens.push({
        kind: "identifier",
        value: identifier[0]
      })
      index += identifier[0].length
      continue
    }
    tokens.push({ kind: "punctuation", value: character })
    index += 1
  }
  return tokens
}

function productionRustTokens(tokens, reference) {
  const testAttribute = ["#", "[", "cfg", "(", "test", ")", "]"]
  const production = []
  for (let index = 0; index < tokens.length;) {
    if (testAttribute.every((value, offset) => tokens[index + offset]?.value === value)) {
      const moduleIndex = index + testAttribute.length
      if (tokens[moduleIndex]?.value !== "mod" || tokens[moduleIndex + 1]?.kind !== "identifier") {
        throw new Error(`${reference} contains an unsupported cfg(test) item`)
      }
      const moduleBodyIndex = moduleIndex + 2
      if (tokens[moduleBodyIndex]?.value === ";") {
        index = moduleBodyIndex + 1
        continue
      }
      if (tokens[moduleBodyIndex]?.value !== "{") {
        throw new Error(`${reference} contains an unsupported cfg(test) item`)
      }
      index = matchingRustDelimiter(tokens, moduleBodyIndex, reference) + 1
      continue
    }
    production.push(tokens[index])
    index += 1
  }
  return production
}

function matchingRustDelimiter(tokens, openIndex, reference) {
  const expectedClose = RUST_DELIMITER_PAIRS.get(tokens[openIndex]?.value)
  if (!expectedClose) throw new Error(`${reference} contains an unsupported route declaration`)
  const stack = [expectedClose]
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    const value = tokens[index].value
    const close = RUST_DELIMITER_PAIRS.get(value)
    if (close) stack.push(close)
    else if ([")", "]", "}"].includes(value)) {
      if (value !== stack.at(-1)) {
        throw new Error(`${reference} contains an unbalanced route declaration`)
      }
      stack.pop()
      if (stack.length === 0) return index
    }
  }
  throw new Error(`${reference} contains an unterminated route declaration`)
}

function splitRustArguments(tokens, reference) {
  const argumentsList = []
  let start = 0
  const stack = []
  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value
    const close = RUST_DELIMITER_PAIRS.get(value)
    if (close) stack.push(close)
    else if ([")", "]", "}"].includes(value)) {
      if (value !== stack.at(-1)) {
        throw new Error(`${reference} contains an unbalanced route declaration`)
      }
      stack.pop()
    } else if (value === "," && stack.length === 0) {
      argumentsList.push(tokens.slice(start, index))
      start = index + 1
    }
  }
  if (stack.length !== 0) throw new Error(`${reference} contains an unbalanced route declaration`)
  argumentsList.push(tokens.slice(start))
  if (argumentsList.at(-1).length === 0) argumentsList.pop()
  return argumentsList
}

function rustPath(tokens) {
  if (tokens.length === 0 || tokens[0].kind !== "identifier") return null
  let value = tokens[0].value
  for (let index = 1; index < tokens.length; index += 3) {
    if (
      tokens[index]?.value !== ":" ||
      tokens[index + 1]?.value !== ":" ||
      tokens[index + 2]?.kind !== "identifier"
    ) {
      return null
    }
    value += `::${tokens[index + 2].value}`
  }
  return value
}

function parseWwsMethodFilter(tokens) {
  if (
    tokens[0]?.value !== "MethodFilter" ||
    tokens[1]?.value !== ":" ||
    tokens[2]?.value !== ":" ||
    !WWS_METHOD_FILTERS.has(tokens[3]?.value)
  ) {
    return null
  }
  const methods = [tokens[3].value]
  let index = 4
  while (index < tokens.length) {
    if (tokens[index]?.value !== "." || tokens[index + 1]?.value !== "or" || tokens[index + 2]?.value !== "(") {
      return null
    }
    const close = matchingRustDelimiter(tokens, index + 2, "WWS MethodFilter")
    const nested = parseWwsMethodFilter(tokens.slice(index + 3, close))
    if (!nested) return null
    methods.push(...nested)
    index = close + 1
  }
  return [...new Set(methods)]
}

function parseWwsCall(tokens) {
  if (tokens[0]?.kind !== "identifier" || tokens[1]?.value !== "(") return null
  const close = matchingRustDelimiter(tokens, 1, "WWS endpoint")
  return {
    name: tokens[0].value,
    argumentsList: splitRustArguments(tokens.slice(2, close), "WWS endpoint"),
    tail: tokens.slice(close + 1)
  }
}

function wwsReference(registryPath, declaration, method, implicitHead = false) {
  const className = declaration.className ?? method
  return `${registryPath}#${className.toLowerCase()}:${declaration.routePath}:${declaration.handler}${implicitHead ? ":implicit-head" : ""}`
}

function parseWwsEndpoint(tokens, routePath, registryPath) {
  const call = parseWwsCall(tokens)
  if (!call) throw new Error(`${registryPath} contains an unsupported route declaration`)
  const handler = call.argumentsList.length === 1 ? rustPath(call.argumentsList[0]) : null
  if (call.name === "any" && handler && call.tail.length === 0) {
    return { routePath, all: { routePath, handler, className: "ANY" }, fixed: [], fallback: null }
  }
  const directMethod = WWS_DIRECT_METHODS.get(call.name)
  if (directMethod && handler && call.tail.length === 0) {
    return {
      routePath,
      all: null,
      fixed: [{ method: directMethod, routePath, handler, className: directMethod }],
      fallback: null
    }
  }
  if (call.name !== "on" || call.argumentsList.length !== 2) {
    throw new Error(`${registryPath} contains an unsupported route declaration`)
  }
  const methods = parseWwsMethodFilter(call.argumentsList[0])
  const onHandler = rustPath(call.argumentsList[1])
  if (!methods || !onHandler) {
    throw new Error(`${registryPath} contains an unsupported route declaration`)
  }
  const fallbackCall = parseWwsCall(call.tail.slice(1))
  const hasFallbackPrefix = call.tail[0]?.value === "."
  const fallbackHandler = fallbackCall?.argumentsList.length === 1
    ? rustPath(fallbackCall.argumentsList[0])
    : null
  if (
    !hasFallbackPrefix ||
    fallbackCall?.name !== "fallback" ||
    !fallbackHandler ||
    fallbackCall.tail.length !== 0
  ) {
    throw new Error(`${registryPath} contains an unsupported route declaration`)
  }
  return {
    routePath,
    all: null,
    fixed: methods.map((method) => ({
      method,
      routePath,
      handler: onHandler,
      className: `ON-${methods.join("+")}`
    })),
    fallback: { routePath, handler: fallbackHandler, className: "FALLBACK" }
  }
}

function extractWwsRouteDeclarations(tokens, registryPath) {
  const declarations = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "." || tokens[index + 1]?.value !== "route") continue
    if (tokens[index + 2]?.value !== "(") {
      throw new Error(`${registryPath} contains an unsupported route declaration`)
    }
    const close = matchingRustDelimiter(tokens, index + 2, registryPath)
    const argumentsList = splitRustArguments(tokens.slice(index + 3, close), registryPath)
    if (
      argumentsList.length !== 2 ||
      argumentsList[0].length !== 1 ||
      argumentsList[0][0].kind !== "string" ||
      argumentsList[0][0].value.includes("\\")
    ) {
      throw new Error(`${registryPath} contains an unsupported route declaration`)
    }
    const routePath = argumentsList[0][0].value
    declarations.push(parseWwsEndpoint(argumentsList[1], routePath, registryPath))
    index = close
  }
  return declarations
}

function aggregateWwsDispatch(declarations, registryPath) {
  const routes = new Map()
  for (const declaration of declarations) {
    const route = routes.get(declaration.routePath) ?? {
      fixed: new Map(),
      all: [],
      fallback: []
    }
    for (const fixed of declaration.fixed) {
      if (route.fixed.has(fixed.method)) {
        throw new Error(`${registryPath} contains a duplicate ${fixed.method} route for ${declaration.routePath}`)
      }
      route.fixed.set(fixed.method, fixed)
    }
    if (declaration.all) route.all.push(declaration.all)
    if (declaration.fallback) route.fallback.push(declaration.fallback)
    routes.set(declaration.routePath, route)
  }

  const records = []
  for (const [routePath, route] of routes) {
    if (route.fixed.size === 0 && route.fallback.length === 0) {
      if (route.all.length !== 1) {
        throw new Error(`${registryPath} contains duplicate all-method routes for ${routePath}`)
      }
      const declaration = route.all[0]
      records.push({ method: "ANY", routePath, reference: wwsReference(registryPath, declaration, "ANY") })
      continue
    }
    const unmatched = [...route.all, ...route.fallback]
    if (unmatched.length > 1) {
      throw new Error(`${registryPath} contains duplicate unmatched-method routes for ${routePath}`)
    }
    for (const [method, declaration] of route.fixed) {
      records.push({ method, routePath, reference: wwsReference(registryPath, declaration, method) })
    }
    if (route.fixed.has("GET") && !route.fixed.has("HEAD")) {
      const declaration = route.fixed.get("GET")
      records.push({
        method: "HEAD",
        routePath,
        reference: wwsReference(registryPath, declaration, "HEAD", true)
      })
    }
    if (unmatched.length === 1) {
      const declaration = unmatched[0]
      records.push({
        method: "FALLBACK",
        routePath,
        reference: wwsReference(registryPath, declaration, "FALLBACK")
      })
    }
  }
  return records
}

async function discoverWwsRoutes(root) {
  const registryPath = "wws/src/route.rs"
  const sourceText = await readText(root, registryPath)
  const tokens = productionRustTokens(scanRustTokens(sourceText, registryPath), registryPath)
  const declarations = extractWwsRouteDeclarations(tokens, registryPath)
  if (declarations.length === 0) throw new Error(`${registryPath} declares no WWS routes`)
  return aggregateWwsDispatch(declarations, registryPath).map(({ method, routePath, reference }) =>
    surface({
      surfaceId: `wws-route:${method}:${routePath}`,
      kind: "wws_route",
      publicOwner: "wws",
      publicReference: [reference]
    })
  )
}

function auditTests(row) {
  return uniqueSortedStrings([
    ...testReferences(row.tests),
    ...testReferences(row.public_tests),
    ...testReferences(row.existing_tests)
  ])
}

function auditCompletion(classification) {
  if (!AUDIT_CLASSIFICATIONS.has(classification)) {
    throw new Error(`unknown Open43 audit classification: ${classification}`)
  }
  if (classification === "blocked_evidence") {
    return {
      evidence: phase("blocked"),
      source: phase("blocked"),
      candidate: phase("blocked"),
      standing: phase("blocked"),
      closure: phase("blocked")
    }
  }
  return {
    evidence: phase("available"),
    source: phase(classification === "needs_source" ? "pending" : "implemented"),
    candidate: phase("pending"),
    standing: phase("pending"),
    closure: phase("open")
  }
}

function validateNestedAuditSources(root, auditPath, audit, sourceRevision) {
  if (!/^[0-9a-f]{40}$/u.test(sourceRevision ?? "")) {
    throw new Error(`${auditPath} has no source_revision`)
  }
  const visit = (value) => {
    if (!value || typeof value !== "object") return
    if (!Array.isArray(value) && typeof value.path === "string" && value.sha256 !== undefined) {
      if (!/^[0-9a-f]{64}$/u.test(value.sha256)) {
        throw new Error(`${auditPath} has an invalid nested source digest for ${value.path}`)
      }
      // Absolute evidence and ftml@REV:path are not objects in this Git repository.
      if (!path.isAbsolute(value.path) && !/^ftml@[0-9a-f]{40}:/u.test(value.path)) {
        if (!isCanonicalRepositoryReference(value.path) || value.path.includes("#")) {
          throw new Error(`${auditPath} has an invalid nested source path: ${value.path}`)
        }
        const revision = value.source_revision ?? sourceRevision
        if (!/^[0-9a-f]{40}$/u.test(revision)) {
          throw new Error(`${auditPath} ${value.path} has invalid source_revision`)
        }
        if (value.source_revision === sourceRevision) {
          throw new Error(`${auditPath} ${value.path} has a redundant source_revision`)
        }
        let source
        try {
          source = execFileSync(GIT_EXECUTABLE, ["-C", root, "show", `${revision}:${value.path}`], {
            env: GIT_ENVIRONMENT,
            stdio: ["ignore", "pipe", "ignore"]
          })
        } catch {
          throw new Error(`${auditPath} cannot read nested source ${revision}:${value.path}`)
        }
        if (sha256(source) !== value.sha256) {
          throw new Error(`${auditPath} nested source digest does not match ${revision}:${value.path}`)
        }
      }
    }
    for (const nested of Object.values(value)) visit(nested)
  }
  visit(audit)
}

async function discoverOpen43AuditCases(root) {
  const routingPath = "docs/development/open43-blocked-evidence-routing.json"
  const reconciliationPath =
    "docs/development/open43-closure-audit-ownership-reconciliation.json"
  const routing = await readJson(root, routingPath)
  const reconciliation = await readJson(root, reconciliationPath)
  if (routing.schema !== "wikijump.open43.blocked_evidence_routing.v1") {
    throw new Error(`${routingPath} has an unsupported schema`)
  }
  if (reconciliation.schema !== "wikijump.open43.closure_audit_ownership_reconciliation.v1") {
    throw new Error(`${reconciliationPath} has an unsupported schema`)
  }
  if (!Array.isArray(routing.source_audits) || routing.source_audits.length !== 7) {
    throw new Error(`${routingPath} must declare exactly seven source audits`)
  }
  if (new Set(routing.source_audits).size !== routing.source_audits.length) {
    throw new Error(`${routingPath} contains a duplicate source audit`)
  }

  if (
    !routing.route_classes ||
    Array.isArray(routing.route_classes) ||
    new Set(Object.keys(routing.route_classes)).size !== BLOCKED_ROUTE_CLASSES.size ||
    [...BLOCKED_ROUTE_CLASSES].some((routeClass) =>
      typeof routing.route_classes[routeClass] !== "string" ||
      routing.route_classes[routeClass] === ""
    )
  ) {
    throw new Error(`${routingPath} route_classes do not match the closed vocabulary`)
  }
  if (!Array.isArray(routing.rows)) throw new Error(`${routingPath} rows must be an array`)
  if (!Array.isArray(reconciliation.closure_audits)) {
    throw new Error(`${reconciliationPath} closure_audits must be an array`)
  }
  const reconciliationAudits = new Map(
    reconciliation.closure_audits.map((entry) => [entry.path, entry])
  )
  if (
    reconciliationAudits.size !== routing.source_audits.length ||
    routing.source_audits.some((auditPath) => !reconciliationAudits.has(auditPath))
  ) {
    throw new Error(`${reconciliationPath} does not own the same seven source audits`)
  }

  const records = []
  const auditRows = []
  for (const auditPath of routing.source_audits) {
    if (typeof auditPath !== "string" || !auditPath.startsWith("docs/development/")) {
      throw new Error(`${routingPath} contains an invalid source audit path`)
    }
    const auditText = await readText(root, auditPath)
    let audit
    try {
      audit = JSON.parse(auditText)
    } catch (error) {
      throw new Error(`invalid JSON in ${auditPath}: ${error.message}`)
    }
    if (!Array.isArray(audit.issues)) throw new Error(`${auditPath} issues must be an array`)
    const reconciliationAudit = reconciliationAudits.get(auditPath)
    if (reconciliationAudit.sha256 !== sha256(auditText)) {
      throw new Error(`${auditPath} reconciliation digest does not match`)
    }
    validateNestedAuditSources(root, auditPath, audit, reconciliationAudit.source_revision)
    const currentAuditRows = []
    const fallbackOwner = typeof audit.schema === "string" ? audit.schema : "open43-audit"
    for (const issue of audit.issues) {
      const issueNumber = issue.issue ?? issue.number
      if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
        throw new Error(`${auditPath} contains an audit case without an issue owner`)
      }
      const classifiedRows = []
      if (Array.isArray(issue.subrows)) {
        for (const row of issue.subrows) {
          classifiedRows.push({ row, classification: row.classification ?? row.status })
        }
      } else {
        for (const classification of AUDIT_CLASSIFICATIONS) {
          const rows = issue[classification] ?? []
          if (!Array.isArray(rows)) {
            throw new Error(`${auditPath} issue ${issueNumber} ${classification} must be an array`)
          }
          for (const row of rows) classifiedRows.push({ row, classification })
        }
      }
      for (const { row, classification } of classifiedRows) {
        if (!row || typeof row.case_id !== "string" || row.case_id === "") {
          throw new Error(`${auditPath} issue ${issueNumber} contains a case without case_id`)
        }
        const auditRow = { caseId: row.case_id, classification, issueNumber }
        currentAuditRows.push(auditRow)
        auditRows.push(auditRow)
        records.push(
          surface({
            surfaceId: `open43-audit-case:${row.case_id}`,
            kind: "open43_audit_case",
            publicOwner:
              typeof row.owner === "string" && row.owner !== "" ? row.owner : fallbackOwner,
            publicReference: [`${auditPath}#${row.case_id}`],
            issues: [issueNumber],
            cases: [row.case_id],
            tests: auditTests(row),
            ...auditCompletion(classification)
          })
        )
      }
    }
    if (reconciliationAudit.issue_count !== audit.issues.length) {
      throw new Error(`${auditPath} reconciliation issue_count does not match`)
    }
    if (reconciliationAudit.case_count !== currentAuditRows.length) {
      throw new Error(`${auditPath} reconciliation case_count does not match`)
    }
    assertSameCounts(
      classificationCounts(currentAuditRows),
      reconciliationAudit.classification_counts,
      `${auditPath} reconciliation`
    )
    if (Array.isArray(reconciliationAudit.issue_summaries)) {
      if (reconciliationAudit.issue_summaries.length !== audit.issues.length) {
        throw new Error(`${auditPath} reconciliation issue_summaries do not match`)
      }
      for (const summary of reconciliationAudit.issue_summaries) {
        const issueRows = currentAuditRows.filter((row) => row.issueNumber === summary.issue)
        if (summary.case_count !== issueRows.length) {
          throw new Error(`${auditPath} issue ${summary.issue} reconciliation case_count does not match`)
        }
        assertSameCounts(
          classificationCounts(issueRows),
          summary.classification_counts,
          `${auditPath} issue ${summary.issue} reconciliation`
        )
      }
    }
  }

  const caseIds = auditRows.map(({ caseId }) => caseId)
  const uniqueCaseIds = new Set(caseIds)
  const duplicateCaseIds = uniqueSortedStrings(
    caseIds.filter((caseId, index) => caseIds.indexOf(caseId) !== index)
  )
  if (
    reconciliation.after?.case_count !== auditRows.length ||
    reconciliation.after?.unique_case_count !== uniqueCaseIds.size ||
    JSON.stringify(uniqueSortedStrings(reconciliation.after?.duplicate_case_ids ?? [])) !==
      JSON.stringify(duplicateCaseIds)
  ) {
    throw new Error(`${reconciliationPath} aggregate case denominator does not match`)
  }
  assertSameCounts(
    classificationCounts(auditRows),
    reconciliation.after?.classification_counts,
    `${reconciliationPath} aggregate`
  )
  if ((reconciliation.after?.unknown_classifications ?? []).length !== 0) {
    throw new Error(`${reconciliationPath} records unknown classifications`)
  }

  const blockedCaseIds = uniqueSortedStrings(
    auditRows
      .filter(({ classification }) => classification === "blocked_evidence")
      .map(({ caseId }) => caseId)
  )
  const routedCaseIds = []
  const routedCounts = Object.fromEntries([...BLOCKED_ROUTE_CLASSES].map((name) => [name, 0]))
  for (const row of routing.rows) {
    if (!row || typeof row.case_id !== "string" || row.case_id === "") {
      throw new Error(`${routingPath} contains a row without case_id`)
    }
    if (!BLOCKED_ROUTE_CLASSES.has(row.route_class)) {
      throw new Error(`${routingPath} has unknown route_class for ${row.case_id}`)
    }
    if (!BLOCKED_ROUTE_STATUSES.has(row.status)) {
      throw new Error(`${routingPath} has unknown status for ${row.case_id}`)
    }
    if (typeof row.reason !== "string" || row.reason === "") {
      throw new Error(`${routingPath} has no reason for ${row.case_id}`)
    }
    routedCaseIds.push(row.case_id)
    routedCounts[row.route_class] += 1
  }
  if (
    new Set(routedCaseIds).size !== routedCaseIds.length ||
    JSON.stringify(uniqueSortedStrings(routedCaseIds)) !== JSON.stringify(blockedCaseIds)
  ) {
    throw new Error(`${routingPath} routing rows do not exactly match blocked_evidence cases`)
  }
  for (const routeClass of BLOCKED_ROUTE_CLASSES) {
    if (routing.counts?.[routeClass] !== routedCounts[routeClass]) {
      throw new Error(`${routingPath} ${routeClass} count does not match`)
    }
  }
  if (routing.counts?.total !== routedCaseIds.length) {
    throw new Error(`${routingPath} total count does not match`)
  }
  if (
    routing.integration_base !== undefined &&
    reconciliation.source?.integration_base !== undefined &&
    routing.integration_base !== reconciliation.source.integration_base
  ) {
    throw new Error(`${routingPath} and ${reconciliationPath} integration_base do not match`)
  }
  return { records, auditPaths: [...routing.source_audits] }
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
      } else if (auditedOwnershipActive && CATALOG_SPLIT_IMPLEMENTATION_OWNERS.has(record.surface_id)) {
        implementationOwners = ["ftml", "wikijump"]
      } else if (auditedOwnershipActive) {
        implementationOwners = ["wikijump"]
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
      throw new Error("audited catalog implementation ownership drift")
    }
  }
  return normalizedSurfaces
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
    throw new Error(`${SEMANTICS_REGISTRY} has missing or unused implementation owner keys`)
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
      discoverWikidotPyAmc(root),
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
  verifyRegistryBlobs(root, provenance.wikijump.commit)
  const surfaces = normalizeSurfaceOwners(applyAuditedIssueOwnership([
    ...catalog,
    ...deepwell,
    ...framerailRoutes,
    ...amc,
    ...wikidotPyAmc,
    ...xmlRpc,
    ...pageActions,
    ...wws,
    ...open43.records
  ].sort((left, right) => left.surface_id.localeCompare(right.surface_id, "en")), auditedOwnershipActive), ftmlRawSurfaceManifest.catalog_crosswalk, semantics, auditedOwnershipActive)
  const relationshipModel = buildRelationshipModel(surfaces, ftmlRawSurfaceManifest, semantics)
  validateInventory(surfaces, relationshipModel.owner_keys)
  const byKind = {}
  for (const kind of uniqueSortedStrings(surfaces.map(({ kind }) => kind))) {
    byKind[kind] = surfaces.filter((surfaceRecord) => surfaceRecord.kind === kind).length
  }
  return {
    schema: SCHEMA,
    relationship_edge_types: [...semantics.relationship_edge_types],
    ...relationshipModel,
    ftml_raw_surface_manifest: ftmlRawSurfaceManifest,
    provenance: {
      ...provenance,
      registries: [...SOURCE_INPUTS]
        .map(([registryPath, source]) => ({ path: registryPath, sha256: sha256(source) }))
        .sort((left, right) => left.path.localeCompare(right.path, "en"))
    },
    sources: {
      catalog: "docs/wikidot-specifications/catalog.json",
      live_observations: "docs/wikidot-specifications/live-observations.json",
      implementation_ledger: CANONICAL_IMPLEMENTATION_LEDGER,
      implementation_ledger_mirror: "docs/wikidot-specifications/implementation-ledger.json",
      source_coverage: "docs/wikidot-specifications/source-coverage.json",
      compatibility_surface_semantics: SEMANTICS_REGISTRY,
      audited_ownership_reports: AUDITED_OWNERSHIP_REPORTS,
      deepwell_jsonrpc_registry: "deepwell/src/api.rs",
      framerail_routes_root: "framerail/src/routes",
      framerail_amc_registry: "framerail/src/lib/server/ajax-module-connector.js",
      framerail_amc_wire_contracts: "docs/development/framerail-amc-wire-contracts.json",
      wikidot_py_amc_contract: "docs/development/wikidot-py-amc-client-parity.json",
      wikidot_py_source: {
        repository: WIKIDOT_PY_SOURCE.repository,
        commit: WIKIDOT_PY_SOURCE.commit,
        root_tree: WIKIDOT_PY_SOURCE.root_tree,
        objects: [...WIKIDOT_PY_SOURCE.objects].map(([objectPath, [type, oid]]) => ({
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
  const inventoryPath = path.join(root, DEFAULT_OUTPUT)
  let inventory
  try {
    inventory = JSON.parse(await fs.readFile(inventoryPath, "utf8"))
  } catch {
    throw new Error("--source-revision is required when no tracked inventory pin exists")
  }
  return inventory.provenance?.wikijump?.commit
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const sourceRevision = await pinnedSourceRevision(options.root, options.sourceRevision)
  const inventory = await buildInventory(options.root, sourceRevision)
  await fs.mkdir(path.dirname(options.output), { recursive: true })
  await fs.writeFile(options.output, `${JSON.stringify(inventory, null, 2)}\n`)
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
