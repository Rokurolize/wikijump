#!/usr/bin/env node

import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const SCHEMA = "wikijump.compatibility_surface_inventory.v1"
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../../..")
const DEFAULT_OUTPUT = "docs/development/compatibility-surface-inventory.json"

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
  return `Usage: node ${path.basename(process.argv[1])} [--root REPOSITORY] [--output JSON]\n`
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT
  let output
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--root") {
      root = path.resolve(requireValue(argv, ++index, "--root"))
    } else if (argument === "--output") {
      output = path.resolve(requireValue(argv, ++index, "--output"))
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(usage())
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  return {
    root,
    output: output ?? path.join(root, DEFAULT_OUTPUT)
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
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`invalid JSON in ${relativePath}: ${error.message}`)
  }
}

async function readText(root, relativePath) {
  try {
    return await fs.readFile(path.join(root, relativePath), "utf8")
  } catch (error) {
    throw new Error(`cannot read ${relativePath}: ${error.message}`)
  }
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
  closure = phase("open")
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
    closure
  }
}

function uniqueSortedStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value !== ""))].sort()
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
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

async function discoverCatalogFeatures(root) {
  const catalogPath = "docs/wikidot-specifications/catalog.json"
  const ledgerPath = "docs/wikidot-specifications/implementation-ledger.json"
  const [catalog, ledger] = await Promise.all([
    readJson(root, catalogPath),
    readJson(root, ledgerPath)
  ])
  if (!Array.isArray(catalog.features)) throw new Error(`${catalogPath} features must be an array`)
  if (catalog.feature_count !== undefined && catalog.feature_count !== catalog.features.length) {
    throw new Error(`${catalogPath} feature_count does not match its feature denominator`)
  }
  if (!ledger.features || Array.isArray(ledger.features) || typeof ledger.features !== "object") {
    throw new Error(`${ledgerPath} features must be an object`)
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
    records.push(
      surface({
        surfaceId: `catalog-feature:${feature.id}`,
        kind: "catalog_feature",
        publicOwner: "docs/wikidot-specifications",
        publicReference: [specification],
        tests: testReferences(ledgerEntry.tests),
        evidence: phase("available", [specification, ...documentationEvidence, ...(ledgerEntry.live_oracle_evidence ?? [])]),
        source: phase(ledgerEntry.status, ledgerEntry.implementation_files ?? [])
      })
    )
  }
  for (const ledgerId of Object.keys(ledger.features)) {
    if (!catalogIds.has(ledgerId)) throw new Error(`orphan ledger feature: ${ledgerId}`)
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
  const sourceText = await fs.readFile(filePath, "utf8")
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
  const sourceText = await fs.readFile(filePath, "utf8")
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
      const sourceText = await fs.readFile(filePath, "utf8")
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
  if (!/^[0-9a-f]{40}$/u.test(contract.source?.commit ?? "")) {
    throw new Error(`${contractPath} source commit must be a full Git commit`)
  }
  if (!Array.isArray(contract.modules)) {
    throw new Error(`${contractPath} modules must be an array`)
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
          (reference) =>
            typeof reference !== "string" ||
            !reference.endsWith(`#action:${binding.operation_id}`)
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
    const proof = entry.browser_interval_proof
    if (
      !proof ||
      !["available", "missing"].includes(proof.status) ||
      (proof.status === "missing" && !Number.isInteger(proof.issue)) ||
      (proof.status === "available" &&
        (!Array.isArray(proof.references) || proof.references.length === 0))
    ) {
      throw new Error(`${registryPath} ${entry.control_id} has invalid browser_interval_proof`)
    }
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
      browser_interval_proof: proof.status === "missing"
        ? { status: "missing", issue: proof.issue }
        : { status: "available", references: uniqueSortedStrings(proof.references) },
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

function validateInventory(surfaces) {
  const identifiers = new Set()
  for (const record of surfaces) {
    if (typeof record.surface_id !== "string" || record.surface_id === "") {
      throw new Error("compatibility surface is missing surface_id")
    }
    if (identifiers.has(record.surface_id)) {
      throw new Error(`duplicate surface_id: ${record.surface_id}`)
    }
    identifiers.add(record.surface_id)
    if (typeof record.public_owner !== "string" || record.public_owner === "") {
      throw new Error(`missing public owner for ${record.surface_id}`)
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

async function buildInventory(root) {
  const [
    catalog,
    deepwell,
    framerailRoutes,
    amc,
    wikidotPyAmc,
    xmlRpc,
    pageActions,
    wws,
    open43
  ] =
    await Promise.all([
      discoverCatalogFeatures(root),
      discoverDeepwellJsonRpc(root),
      discoverFramerailRoutes(root),
      discoverFramerailAmc(root),
      discoverWikidotPyAmc(root),
      discoverFramerailXmlRpc(root),
      discoverPageActionSurfaces(root),
      discoverWwsRoutes(root),
      discoverOpen43AuditCases(root)
    ])
  const surfaces = [
    ...catalog,
    ...deepwell,
    ...framerailRoutes,
    ...amc,
    ...wikidotPyAmc,
    ...xmlRpc,
    ...pageActions,
    ...wws,
    ...open43.records
  ].sort((left, right) => left.surface_id.localeCompare(right.surface_id, "en"))
  validateInventory(surfaces)
  const byKind = {}
  for (const kind of uniqueSortedStrings(surfaces.map(({ kind }) => kind))) {
    byKind[kind] = surfaces.filter((surfaceRecord) => surfaceRecord.kind === kind).length
  }
  return {
    schema: SCHEMA,
    sources: {
      catalog: "docs/wikidot-specifications/catalog.json",
      implementation_ledger: "docs/wikidot-specifications/implementation-ledger.json",
      deepwell_jsonrpc_registry: "deepwell/src/api.rs",
      framerail_routes_root: "framerail/src/routes",
      framerail_amc_registry: "framerail/src/lib/server/ajax-module-connector.js",
      framerail_amc_wire_contracts: "docs/development/framerail-amc-wire-contracts.json",
      wikidot_py_amc_contract: "docs/development/wikidot-py-amc-client-parity.json",
      framerail_xmlrpc_registry: "framerail/src/lib/server/xmlrpc/methods.ts",
      page_action_registry: "docs/development/wikidot-page-action-surfaces.json",
      wws_route_registry: "wws/src/route.rs",
      open43_audits: open43.auditPaths
    },
    counts: { total: surfaces.length, by_kind: byKind },
    surfaces
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const inventory = await buildInventory(options.root)
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
