#!/usr/bin/env node

import fs from "node:fs/promises"
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
const HTTP_METHOD_NAMES = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

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

function forumModuleShapes(sourceText, reference) {
  const marker = /const\s+FORUM_READ_MODULE_PARAMETERS\s*=\s*new\s+Map\s*\(/u.exec(sourceText)
  if (!marker) throw new Error(`missing FORUM_READ_MODULE_PARAMETERS in ${reference}`)
  const mapStart = marker.index + marker[0].length - 1
  const mapExpression = extractBalanced(sourceText, mapStart, "(", ")")
  const arrayStart = mapExpression.indexOf("[")
  if (arrayStart < 0) throw new Error(`forum module registry is not an array in ${reference}`)
  const entriesExpression = extractBalanced(mapExpression, arrayStart, "[", "]")
  const shapes = []
  for (const entry of splitTopLevel(entriesExpression.slice(1, -1))) {
    const moduleName = entry.match(/^\[\s*["']([^"']+)["']/u)?.[1]
    if (!moduleName) throw new Error(`unsupported forum module entry in ${reference}: ${entry}`)
    const parameterSets = [...entry.matchAll(/new\s+Set\s*\(([^)]*)\)/gu)]
    if (parameterSets.length === 0) throw new Error(`forum module has no parameter shape: ${moduleName}`)
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
  const sourceText = await readText(root, registryPath)
  const records = forumModuleShapes(sourceText, registryPath).map(({ moduleName, parameters }) =>
    amcModuleSurface(registryPath, moduleName, parameters)
  )
  const siteChangesModule = stringConstant(sourceText, "SITE_CHANGES_MODULE", registryPath)
  records.push(
    amcModuleSurface(
      registryPath,
      siteChangesModule,
      stringSet(sourceText, "SITE_CHANGES_READ_FIELDS", registryPath).sort()
    )
  )
  const membersListModule = stringConstant(sourceText, "MEMBERS_LIST_MODULE", registryPath)
  records.push(
    amcModuleSurface(
      registryPath,
      membersListModule,
      stringSet(sourceText, "MEMBERS_LIST_PARAMETERS", registryPath).sort()
    )
  )
  const listPagesModule = sourceText.match(/moduleName\s*!==\s*["']([^"']*ListPagesModule)["']/u)?.[1]
  if (!listPagesModule) throw new Error(`missing ListPages module allowlist entry in ${registryPath}`)
  records.push(
    amcModuleSurface(registryPath, listPagesModule, ["*"], "parameters;module_body=required")
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
  if (registry.schema !== "wikijump.wikidot_page_action_surface_registry.v1") {
    throw new Error(`${registryPath} has an unsupported schema`)
  }
  if (!Array.isArray(registry.evidence_references) || registry.evidence_references.length === 0) {
    throw new Error(`${registryPath} must declare evidence_references`)
  }
  if (!Array.isArray(registry.surfaces) || registry.surfaces.length === 0) {
    throw new Error(`${registryPath} must declare surfaces`)
  }
  return registry.surfaces.map((entry) => {
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
}

async function discoverWwsRoutes(root) {
  const registryPath = "wws/src/route.rs"
  const sourceText = (await readText(root, registryPath)).split("#[cfg(test)]", 1)[0]
  const declarations = [...sourceText.matchAll(/\.route\s*\(\s*"([^"]+)"\s*,\s*(any|get|post|put|patch|delete|head|options)\s*\(\s*([A-Za-z_][A-Za-z0-9_:]*)\s*\)\s*,?\s*\)/gu)]
  const declarationCount = sourceText.match(/\.route\s*\(/gu)?.length ?? 0
  if (declarations.length !== declarationCount) {
    throw new Error(`${registryPath} contains an unsupported route declaration`)
  }
  if (declarations.length === 0) throw new Error(`${registryPath} declares no WWS routes`)
  return declarations.map(([, routePath, matcher, handler]) =>
    surface({
      surfaceId: `wws-route:${matcher.toUpperCase()}:${routePath}`,
      kind: "wws_route",
      publicOwner: "wws",
      publicReference: [`${registryPath}#${matcher}:${routePath}:${handler}`]
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
  const routing = await readJson(root, routingPath)
  if (!Array.isArray(routing.source_audits) || routing.source_audits.length !== 7) {
    throw new Error(`${routingPath} must declare exactly seven source audits`)
  }
  if (new Set(routing.source_audits).size !== routing.source_audits.length) {
    throw new Error(`${routingPath} contains a duplicate source audit`)
  }

  const records = []
  for (const auditPath of routing.source_audits) {
    if (typeof auditPath !== "string" || !auditPath.startsWith("docs/development/")) {
      throw new Error(`${routingPath} contains an invalid source audit path`)
    }
    const audit = await readJson(root, auditPath)
    if (!Array.isArray(audit.issues)) throw new Error(`${auditPath} issues must be an array`)
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
  const [catalog, deepwell, framerailRoutes, amc, xmlRpc, pageActions, wws, open43] = await Promise.all([
    discoverCatalogFeatures(root),
    discoverDeepwellJsonRpc(root),
    discoverFramerailRoutes(root),
    discoverFramerailAmc(root),
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
