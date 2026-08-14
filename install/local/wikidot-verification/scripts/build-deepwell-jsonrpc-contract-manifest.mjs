#!/usr/bin/env node

import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const SCHEMA = "wikijump.deepwell_jsonrpc_contract_manifest.v1"
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../../..")
const DEFAULT_OUTPUT = "docs/development/deepwell-jsonrpc-contract-manifest.json"
const API_PATH = "deepwell/src/api.rs"
const ENDPOINTS_DIRECTORY = "deepwell/src/endpoints"
const CONTRACT_TEST = "install/local/wikidot-verification/tests/deepwell-jsonrpc-contract-manifest.test.mjs#Deepwell JSON-RPC manifest exactly covers the current registered contract"
const HISTORICAL_EVIDENCE = [
  "install/local/wikidot-verification/artifacts/pr1334-deepwell-identity-jsonrpc-attribution-20260810.json",
  "install/local/wikidot-verification/artifacts/pr1334-deepwell-page-revision-jsonrpc-attribution-20260810.json"
]

function usage() {
  return `Usage: node ${path.basename(process.argv[1])} [--root REPOSITORY] [--output JSON] [--verify]\n`
}

function requireValue(argv, index, option) {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`)
  return value
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT
  let output
  let verify = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--root") root = path.resolve(requireValue(argv, ++index, "--root"))
    else if (argument === "--output") output = path.resolve(requireValue(argv, ++index, "--output"))
    else if (argument === "--verify") verify = true
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write(usage())
      process.exit(0)
    } else throw new Error(`unknown argument: ${argument}`)
  }
  return { root, output: output ?? path.join(root, DEFAULT_OUTPUT), verify }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function toPosix(value) {
  return value.split(path.sep).join("/")
}

async function readText(root, relativePath) {
  try {
    return await fs.readFile(path.join(root, relativePath), "utf8")
  } catch (error) {
    throw new Error(`cannot read ${relativePath}: ${error.message}`)
  }
}

function normalizeSource(value) {
  return value.replaceAll(/\s+/gu, " ").trim()
}

function registeredMethods(apiSource) {
  const productionSource = apiSource.split("#[cfg(test)]", 1)[0]
  const registrations = [...productionSource.matchAll(
    /register!\s*\(\s*"([^"]+)"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*isolation\s*=\s*IsolationLevel::([A-Za-z_][A-Za-z0-9_]*))?\s*,?\s*\)/gu
  )].map((match) => ({
    method: match[1],
    handler: match[2],
    isolation: match[3] === undefined ? "default" : match[3]
  }))
  const declaredNames = [...productionSource.matchAll(/register!\s*\(\s*"([^"]+)"/gu)].map((match) => match[1])
  if (registrations.length === 0) throw new Error(`${API_PATH} declares no JSON-RPC methods`)
  if (registrations.length !== declaredNames.length) {
    throw new Error(`${API_PATH} contains an unsupported register! declaration`)
  }
  const names = new Set()
  for (const registration of registrations) {
    if (names.has(registration.method)) throw new Error(`duplicate JSON-RPC registration: ${registration.method}`)
    names.add(registration.method)
  }
  return registrations.sort((left, right) => left.method.localeCompare(right.method, "en"))
}

async function endpointSources(root) {
  const absoluteDirectory = path.join(root, ENDPOINTS_DIRECTORY)
  const files = (await fs.readdir(absoluteDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".rs"))
    .map((entry) => entry.name)
    .filter((name) => !["macros.rs", "mod.rs"].includes(name))
    .sort()
  const entries = []
  for (const file of files) {
    const relativePath = `${ENDPOINTS_DIRECTORY}/${file}`
    const source = await readText(root, relativePath)
    for (const match of source.matchAll(/pub\s+async\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
      entries.push({
        handler: match[1],
        source,
        sourcePath: relativePath,
        offset: match.index
      })
    }
  }
  const byHandler = new Map()
  for (const entry of entries) {
    const matches = byHandler.get(entry.handler) ?? []
    matches.push(entry)
    byHandler.set(entry.handler, matches)
  }
  return byHandler
}

function endpointContract(entry) {
  const nextEndpoint = /\npub\s+async\s+fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/gu
  nextEndpoint.lastIndex = entry.offset + 1
  const next = nextEndpoint.exec(entry.source)
  const source = entry.source.slice(entry.offset, next?.index)
  const params = /\b(_?[A-Za-z_][A-Za-z0-9_]*)\s*:\s*Params\s*<\s*'static\s*>/u.exec(source)
  if (!params) throw new Error(`${entry.sourcePath}#${entry.handler} has no Params argument`)
  const decoder = /\b(parse(?:_one)?)!\s*\(([\s\S]*?)\)\s*;/u.exec(source)
  const requirements = []
  if (/ctx\.request\(\)\.user_id\(\)/u.test(source)) requirements.push("authenticated_user")
  else if (/ctx\.request\(\)\.user_id\b/u.test(source)) requirements.push("optional_user")
  if (/ctx\.request\(\)\.site_id\(\)/u.test(source)) requirements.push("site_context")
  if (/ctx\.request\(\)\.page_reference\(\)/u.test(source)) requirements.push("page_context")
  if (/MutationAuthorization::/u.test(source)) requirements.push("mutation_authorization")
  if (/PermissionService::/u.test(source)) requirements.push("permission_check")
  const mutationSignals = [...source.matchAll(
    /\b[A-Za-z_][A-Za-z0-9_]*Service::(?:create|update|delete|remove|set|edit|move|restore|rollback|upload|cancel|send|invalidate|issue|disable|verify|activate|import|blacklist|hard_delete)\b/gu
  )].map((match) => match[0])
  return {
    endpoint_owner: {
      component: "deepwell",
      handler: entry.handler,
      source: `${entry.sourcePath}#${entry.handler}`,
      source_sha256: sha256(entry.source)
    },
    params_schema: {
      transport: "jsonrpsee::types::params::Params<'static>",
      parameter_name: params[1],
      decoder: decoder === null ? "not_decoded" : `${decoder[1]}!(${normalizeSource(decoder[2])})`
    },
    actor_context: {
      transport_authentication: "Bearer token required by RpcAuthLayer",
      request_context_headers: ["X-Deepwell-Session-Token", "X-Deepwell-Site-Id", "X-Deepwell-Page"],
      requirements
    },
    mutation_class: {
      classification: mutationSignals.length === 0 ? "read_only_or_indirect" : "mutating",
      source_signals: [...new Set(mutationSignals)].sort()
    }
  }
}

async function buildManifest(root) {
  const apiSource = await readText(root, API_PATH)
  const endpointByHandler = await endpointSources(root)
  const methods = []
  for (const registration of registeredMethods(apiSource)) {
    const matches = endpointByHandler.get(registration.handler) ?? []
    if (matches.length !== 1) {
      throw new Error(`${API_PATH}#register:${registration.method} resolves ${matches.length} endpoint handlers named ${registration.handler}`)
    }
    methods.push({
      method: registration.method,
      ...endpointContract(matches[0]),
      transaction_isolation: registration.isolation,
      test_witness: {
        kind: "source_contract",
        reference: CONTRACT_TEST,
        scope: "registration, endpoint owner, parameter decoder, context observations, mutation signals, and transaction isolation"
      }
    })
  }
  const historicalEvidence = []
  for (const evidencePath of HISTORICAL_EVIDENCE) {
    const source = await readText(root, evidencePath)
    historicalEvidence.push({ path: evidencePath, sha256: sha256(source), classification: "historical" })
  }
  return {
    schema: SCHEMA,
    source_identities: {
      jsonrpc_registry: { path: API_PATH, sha256: sha256(apiSource) },
      request_context_middleware: {
        path: "deepwell/src/middleware.rs",
        sha256: sha256(await readText(root, "deepwell/src/middleware.rs"))
      },
      rpc_authentication_middleware: {
        path: "deepwell/src/middleware/rpc_auth.rs",
        sha256: sha256(await readText(root, "deepwell/src/middleware/rpc_auth.rs"))
      }
    },
    historical_evidence: historicalEvidence,
    method_count: methods.length,
    methods
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = `${JSON.stringify(await buildManifest(options.root), null, 2)}\n`
  if (options.verify) {
    let actual
    try {
      actual = await fs.readFile(options.output, "utf8")
    } catch (error) {
      throw new Error(`cannot read contract manifest ${options.output}: ${error.message}`)
    }
    if (actual !== manifest) throw new Error(`contract manifest is stale: ${toPosix(path.relative(options.root, options.output))}`)
    process.stdout.write(`verified ${JSON.parse(manifest).method_count} Deepwell JSON-RPC contracts\n`)
    return
  }
  await fs.mkdir(path.dirname(options.output), { recursive: true })
  await fs.writeFile(options.output, manifest)
  process.stdout.write(`wrote ${JSON.parse(manifest).method_count} Deepwell JSON-RPC contracts to ${toPosix(path.relative(options.root, options.output))}\n`)
}

main().catch((error) => {
  process.stderr.write(`Deepwell JSON-RPC contract manifest failed: ${error.message}\n`)
  process.exitCode = 1
})
