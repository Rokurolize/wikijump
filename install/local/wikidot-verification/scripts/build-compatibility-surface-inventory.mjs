#!/usr/bin/env node

import fs from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { discoverFramerailAmc as discoverFramerailAmcFromSource } from "../src/compatibility-inventory/framerail-amc.mjs"
import { discoverFramerailRouteDescriptors } from "../src/compatibility-inventory/framerail-routes.mjs"
import { discoverOpen43AuditCases as discoverOpen43AuditCasesFromSource } from "../src/compatibility-inventory/open43-audits.mjs"
import {
  applySiteChangesEvidence as applySiteChangesEvidenceFromSource,
  SITE_CHANGES_EVIDENCE_ARTIFACT
} from "../src/compatibility-inventory/site-changes-evidence.mjs"
import { discoverWwsRouteRecords } from "../src/compatibility-inventory/wws-route-parser.mjs"
import { extractBalanced, importedBinding, maskTypeScriptCommentsAndLiterals, objectPropertyNames, splitTopLevel } from "../src/compatibility-inventory/typescript-source.mjs"
import {
  CANONICAL_IMPLEMENTATION_LEDGER,
  LEDGER_STATUSES,
  discoverCatalogFeatures,
  phase,
  surface,
  uniqueSortedStrings
} from "../src/compatibility-inventory/catalog-surfaces.mjs"
import { discoverFtmlRawSurfaceManifest } from "../src/compatibility-inventory/ftml-raw-surface-manifest.mjs"
import { createPinnedSourceAccess } from "../src/compatibility-inventory/pinned-source.mjs"
import {
  DEFERRED_XMLRPC_CATALOG_FEATURES,
  PHASE_STATUSES,
  SEMANTICS_REGISTRY,
  applyAuditedIssueOwnership,
  applyFtmlCatalogSourceProjection,
  assertCanonicalStrings,
  buildRelationshipModel,
  normalizeSurfaceOwners,
  validateInventory
} from "../src/compatibility-inventory/inventory-model.mjs"

import { CANDIDATE_CASE_SETS } from "../src/candidate-case-command.mjs"

const SCHEMA = "wikijump.compatibility_surface_inventory.v3"
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../../..")
const DEFAULT_OUTPUT = "docs/development/compatibility-surface-inventory.json"
const CATALOG_SOURCE_ATTRIBUTION = "docs/development/compatibility-catalog-source-attribution.json"
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

const pinnedSource = createPinnedSourceAccess({
  sourceInputs: SOURCE_INPUTS,
  readText,
  repositoryPath,
  gitExecutable: GIT_EXECUTABLE,
  gitEnvironment: GIT_ENVIRONMENT,
  ftmlGitDir: FTML_GIT_DIR
})
const {
  resolveGitObject,
  sourceProvenance,
  readGitSpecBatch,
  verifyRegistryBlobs,
  preloadPinnedRevisionTexts,
  gitRevisionContains
} = pinnedSource

function assertExactKeys(value, expected, context) {
  const actual = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : []
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${context} has missing or extra keys`)
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



async function applySiteChangesEvidence(root, records) {
  return applySiteChangesEvidenceFromSource(root, records, {
    readText: (selectedRoot, relativePath) => readText(selectedRoot, relativePath)
  })
}

async function discoverFramerailAmc(root) {
  return discoverFramerailAmcFromSource(root, {
    readText: (selectedRoot, relativePath) => readText(selectedRoot, relativePath),
    readJson: (selectedRoot, relativePath) => readJson(selectedRoot, relativePath),
    surface
  })
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
      discoverCatalogFeatures(root, { readJson, sourceInputs: SOURCE_INPUTS }),
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
    semantics,
    {
      ftmlGitDir: FTML_GIT_DIR,
      listGitTreeBlobs: pinnedSource.listGitTreeBlobs,
      readGitBlobBatch: pinnedSource.readGitBlobBatch
    }
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
