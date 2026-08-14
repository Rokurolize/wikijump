#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const SCHEMA = "wikijump.wws_route_registration_denominator.v1"
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../../..")
const DEFAULT_OUTPUT = "docs/development/wws-route-registration-denominator.json"
const ROUTE_REGISTRY = "wws/src/route.rs"
const HANDLER_DIRECTORY = "wws/src/handler"
const HISTORICAL_ARTIFACT = "install/local/wikidot-verification/artifacts/pr1334-wws-route-attribution-no-thumbnails-20260810.json"
const HISTORICAL_FIXTURE = "install/local/wikidot-verification/fixtures/pr1334-wws-route-attribution-no-thumbnails.json"
const EXPECTED_REGISTRATION_COUNT = 30
const GIT_EXECUTABLE = "/usr/bin/git"
const GIT_ENVIRONMENT = Object.freeze({ LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" })
const DIRECT_METHODS = new Map([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["patch", "PATCH"],
  ["delete", "DELETE"],
  ["head", "HEAD"],
  ["options", "OPTIONS"]
])
const METHOD_FILTERS = new Set([
  "CONNECT", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE"
])
const DELIMITER_PAIRS = new Map([["(", ")"], ["[", "]"], ["{", "}"]])
const UNSUPPORTED_ROUTER_COMPOSITION_METHODS = new Set(["merge", "nest", "nest_service", "route_service"])

function usage() {
  return `Usage: node ${path.basename(process.argv[1])} [--root REPOSITORY] [--output JSON] [--verify]\n`
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index]
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`)
  return value
}

function parseArguments(arguments_) {
  let root = DEFAULT_ROOT
  let output
  let verify = false
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === "--root") root = path.resolve(requireValue(arguments_, ++index, argument))
    else if (argument === "--output") output = path.resolve(requireValue(arguments_, ++index, argument))
    else if (argument === "--verify") verify = true
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write(usage())
      process.exit(0)
    } else throw new Error(`unknown argument: ${argument}`)
  }
  return { root, output: output ?? path.join(root, DEFAULT_OUTPUT), verify }
}

function toPosix(value) {
  return value.split(path.sep).join("/")
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function git(root, ...arguments_) {
  const result = spawnSync(GIT_EXECUTABLE, ["-C", root, ...arguments_], {
    encoding: "utf8",
    env: GIT_ENVIRONMENT
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${arguments_.join(" ")} failed`)
  return result.stdout.trim()
}

function gitWithInput(root, input, ...arguments_) {
  const result = spawnSync(GIT_EXECUTABLE, ["-C", root, ...arguments_], {
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
    input
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${arguments_.join(" ")} failed`)
  return result.stdout.trim()
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length
}

function scanRustTokens(source, reference) {
  const tokens = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (/\s/u.test(character)) {
      index += 1
      continue
    }
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index + 2)
      index = newline < 0 ? source.length : newline + 1
      continue
    }
    if (source.startsWith("/*", index)) {
      let depth = 1
      let cursor = index + 2
      while (cursor < source.length && depth > 0) {
        if (source.startsWith("/*", cursor)) {
          depth += 1
          cursor += 2
        } else if (source.startsWith("*/", cursor)) {
          depth -= 1
          cursor += 2
        } else cursor += 1
      }
      if (depth !== 0) throw new Error(`${reference} contains an unterminated block comment`)
      index = cursor
      continue
    }

    const rawString = /^(?:b|c)?r(#+)?"/u.exec(source.slice(index))
    if (rawString) {
      const hashes = rawString[1] ?? ""
      const contentStart = index + rawString[0].length
      const terminator = `"${hashes}`
      const end = source.indexOf(terminator, contentStart)
      if (end < 0) throw new Error(`${reference} contains an unterminated raw string`)
      tokens.push({ kind: "string", value: source.slice(contentStart, end), start: index, end: end + terminator.length })
      index = end + terminator.length
      continue
    }

    const prefixLength = (character === "b" || character === "c") && source[index + 1] === '"' ? 1 : 0
    if (character === '"' || prefixLength === 1) {
      const quote = index + prefixLength
      let cursor = quote + 1
      let escaped = false
      while (cursor < source.length) {
        const current = source[cursor]
        if (escaped) escaped = false
        else if (current === "\\") escaped = true
        else if (current === '"') break
        cursor += 1
      }
      if (cursor >= source.length) throw new Error(`${reference} contains an unterminated string`)
      tokens.push({ kind: "string", value: source.slice(quote + 1, cursor), start: index, end: cursor + 1 })
      index = cursor + 1
      continue
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(index))
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0], start: index, end: index + identifier[0].length })
      index += identifier[0].length
      continue
    }
    tokens.push({ kind: "punctuation", value: character, start: index, end: index + 1 })
    index += 1
  }
  return tokens
}

function matchingDelimiter(tokens, openIndex, reference) {
  const expectedClose = DELIMITER_PAIRS.get(tokens[openIndex]?.value)
  if (!expectedClose) throw new Error(`${reference} contains an unsupported route declaration`)
  const stack = [expectedClose]
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    const value = tokens[index].value
    const close = DELIMITER_PAIRS.get(value)
    if (close) stack.push(close)
    else if ([")", "]", "}"].includes(value)) {
      if (value !== stack.at(-1)) throw new Error(`${reference} contains an unbalanced route declaration`)
      stack.pop()
      if (stack.length === 0) return index
    }
  }
  throw new Error(`${reference} contains an unterminated route declaration`)
}

function productionTokens(tokens, reference) {
  const testAttribute = ["#", "[", "cfg", "(", "test", ")", "]"]
  const production = []
  for (let index = 0; index < tokens.length;) {
    if (testAttribute.every((value, offset) => tokens[index + offset]?.value === value)) {
      const moduleIndex = index + testAttribute.length
      if (tokens[moduleIndex]?.value !== "mod" || tokens[moduleIndex + 1]?.kind !== "identifier") {
        throw new Error(`${reference} contains an unsupported cfg(test) item`)
      }
      const bodyIndex = moduleIndex + 2
      if (tokens[bodyIndex]?.value === ";") {
        index = bodyIndex + 1
        continue
      }
      if (tokens[bodyIndex]?.value !== "{") throw new Error(`${reference} contains an unsupported cfg(test) item`)
      index = matchingDelimiter(tokens, bodyIndex, reference) + 1
      continue
    }
    production.push(tokens[index])
    index += 1
  }
  return production
}

function splitArguments(tokens, reference) {
  const argumentsList = []
  let start = 0
  const stack = []
  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value
    const close = DELIMITER_PAIRS.get(value)
    if (close) stack.push(close)
    else if ([")", "]", "}"].includes(value)) {
      if (value !== stack.at(-1)) throw new Error(`${reference} contains an unbalanced route declaration`)
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
    if (tokens[index]?.value !== ":" || tokens[index + 1]?.value !== ":" || tokens[index + 2]?.kind !== "identifier") return null
    value += `::${tokens[index + 2].value}`
  }
  return value
}

function parseCall(tokens, reference) {
  if (tokens[0]?.kind !== "identifier" || tokens[1]?.value !== "(") return null
  const close = matchingDelimiter(tokens, 1, reference)
  return {
    name: tokens[0].value,
    arguments: splitArguments(tokens.slice(2, close), reference),
    tail: tokens.slice(close + 1)
  }
}

function parseMethodFilter(tokens) {
  if (tokens[0]?.value !== "MethodFilter" || tokens[1]?.value !== ":" || tokens[2]?.value !== ":" || !METHOD_FILTERS.has(tokens[3]?.value)) return null
  const methods = [tokens[3].value]
  let index = 4
  while (index < tokens.length) {
    if (tokens[index]?.value !== "." || tokens[index + 1]?.value !== "or" || tokens[index + 2]?.value !== "(") return null
    const close = matchingDelimiter(tokens, index + 2, "WWS MethodFilter")
    const nested = parseMethodFilter(tokens.slice(index + 3, close))
    if (!nested) return null
    methods.push(...nested)
    index = close + 1
  }
  return [...new Set(methods)]
}

function parseEndpoint(tokens, reference) {
  const call = parseCall(tokens, reference)
  if (!call) throw new Error(`${reference} contains an unsupported route declaration`)
  const handler = call.arguments.length === 1 ? rustPath(call.arguments[0]) : null
  if (call.name === "any" && handler && call.tail.length === 0) {
    return { declaredMethodClass: "ANY", handler, fallbackHandler: null }
  }
  const directMethod = DIRECT_METHODS.get(call.name)
  if (directMethod && handler && call.tail.length === 0) {
    return { declaredMethodClass: directMethod, handler, fallbackHandler: null }
  }
  if (call.name !== "on" || call.arguments.length !== 2) {
    throw new Error(`${reference} contains an unsupported route declaration`)
  }
  const methods = parseMethodFilter(call.arguments[0])
  const onHandler = rustPath(call.arguments[1])
  const fallbackCall = call.tail[0]?.value === "." ? parseCall(call.tail.slice(1), reference) : null
  const fallbackHandler = fallbackCall?.arguments.length === 1 ? rustPath(fallbackCall.arguments[0]) : null
  if (!methods || !onHandler || fallbackCall?.name !== "fallback" || !fallbackHandler || fallbackCall.tail.length !== 0) {
    throw new Error(`${reference} contains an unsupported route declaration`)
  }
  return { declaredMethodClass: methods.sort(compareText).join("+"), handler: onHandler, fallbackHandler }
}

function extractRegistrations(source) {
  const tokens = productionTokens(scanRustTokens(source, ROUTE_REGISTRY), ROUTE_REGISTRY)
  const registrations = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "." && UNSUPPORTED_ROUTER_COMPOSITION_METHODS.has(tokens[index + 1]?.value)) {
      throw new Error(`unsupported WWS router composition: ${tokens[index + 1].value}`)
    }
    if (tokens[index].value !== "." || tokens[index + 1]?.value !== "route") continue
    if (tokens[index + 2]?.value !== "(") throw new Error(`${ROUTE_REGISTRY} contains an unsupported route declaration`)
    const close = matchingDelimiter(tokens, index + 2, ROUTE_REGISTRY)
    const argumentsList = splitArguments(tokens.slice(index + 3, close), ROUTE_REGISTRY)
    if (argumentsList.length !== 2 || argumentsList[0].length !== 1 || argumentsList[0][0].kind !== "string" || argumentsList[0][0].value.includes("\\")) {
      throw new Error(`${ROUTE_REGISTRY} contains an unsupported route declaration`)
    }
    registrations.push({
      path: argumentsList[0][0].value,
      ...parseEndpoint(argumentsList[1], ROUTE_REGISTRY),
      routeLine: lineNumber(source, tokens[index].start)
    })
    index = close
  }
  if (registrations.length === 0) throw new Error(`${ROUTE_REGISTRY} declares no WWS routes`)
  return registrations
}

async function resolveHandlerDefinitions(root, symbols) {
  const directory = path.join(root, HANDLER_DIRECTORY)
  const fileNames = (await fs.readdir(directory)).filter((name) => name.endsWith(".rs")).sort(compareText)
  const definitions = new Map()
  const bytesByPath = new Map()
  for (const fileName of fileNames) {
    const relativePath = `${HANDLER_DIRECTORY}/${fileName}`
    const sourceBytes = await fs.readFile(path.join(root, relativePath))
    const source = sourceBytes.toString("utf8")
    bytesByPath.set(relativePath, sourceBytes)
    const tokens = productionTokens(scanRustTokens(source, relativePath), relativePath)
    for (let index = 0; index < tokens.length - 3; index += 1) {
      if (
        tokens[index].value !== "pub" ||
        tokens[index + 1]?.value !== "async" ||
        tokens[index + 2]?.value !== "fn" ||
        tokens[index + 3]?.kind !== "identifier"
      ) {
        continue
      }
      const symbol = tokens[index + 3].value
      if (!symbols.has(symbol)) continue
      if (definitions.has(symbol)) throw new Error(`duplicate WWS handler definition: ${symbol}`)
      definitions.set(symbol, { path: relativePath, line: lineNumber(source, tokens[index].start) })
    }
  }
  for (const symbol of symbols) {
    if (!definitions.has(symbol)) throw new Error(`missing WWS handler definition: ${symbol}`)
  }
  return { definitions, bytesByPath }
}

function gitSourceIdentity(root, commit, relativePath, capturedBytes) {
  const blob = git(root, "rev-parse", `${commit}:${relativePath}`)
  const capturedBlob = gitWithInput(root, capturedBytes, "hash-object", "--stdin")
  if (capturedBlob !== blob) throw new Error(`${relativePath} differs from pinned repository commit ${commit}`)
  return { path: relativePath, git_blob: blob, sha256: sha256(capturedBytes) }
}

async function buildDenominator(root) {
  const routeBytes = await fs.readFile(path.join(root, ROUTE_REGISTRY))
  const routeSource = routeBytes.toString("utf8")
  const registrations = extractRegistrations(routeSource)
  if (registrations.length !== EXPECTED_REGISTRATION_COUNT) {
    throw new Error(`${ROUTE_REGISTRY} registration count is ${registrations.length}; expected ${EXPECTED_REGISTRATION_COUNT}`)
  }
  const registrationIds = registrations.map(({ declaredMethodClass, path: routePath }) =>
    `wws-route-registration:${declaredMethodClass}:${routePath}`
  )
  const duplicateIds = [...new Set(registrationIds.filter((id, index) => registrationIds.indexOf(id) !== index))]
  if (duplicateIds.length > 0) throw new Error(`duplicate WWS route registration ids: ${duplicateIds.join(", ")}`)

  const handlerSymbols = new Set(registrations.flatMap(({ handler, fallbackHandler }) => [handler, fallbackHandler].filter(Boolean)))
  const { definitions, bytesByPath } = await resolveHandlerDefinitions(root, handlerSymbols)
  const commit = git(root, "rev-parse", "HEAD")
  const inputContent = new Map([[ROUTE_REGISTRY, routeBytes]])
  for (const definition of definitions.values()) inputContent.set(definition.path, bytesByPath.get(definition.path))
  const inputs = [...inputContent]
    .sort(([left], [right]) => compareText(left, right))
    .map(([relativePath, content]) => gitSourceIdentity(root, commit, relativePath, content))

  const records = registrations.map((registration, index) => {
    const definition = definitions.get(registration.handler)
    const fallbackDefinition = registration.fallbackHandler ? definitions.get(registration.fallbackHandler) : null
    return {
      registration_id: registrationIds[index],
      path: registration.path,
      declared_method_class: registration.declaredMethodClass,
      registered_handler_symbol: registration.handler,
      handler_definition_path: definition.path,
      route_registration_reference: `${ROUTE_REGISTRY}#L${registration.routeLine}`,
      handler_definition_reference: `${definition.path}#L${definition.line}`,
      fallback_handler_symbol: registration.fallbackHandler,
      fallback_handler_definition_reference: fallbackDefinition ? `${fallbackDefinition.path}#L${fallbackDefinition.line}` : null
    }
  }).sort((left, right) => compareText(left.registration_id, right.registration_id))
  const byMethod = {}
  for (const method of [...new Set(records.map(({ declared_method_class: method }) => method))].sort(compareText)) {
    byMethod[method] = records.filter(({ declared_method_class: candidate }) => candidate === method).length
  }
  const historicalArtifactSource = await fs.readFile(path.join(root, HISTORICAL_ARTIFACT))
  const historicalFixtureSource = await fs.readFile(path.join(root, HISTORICAL_FIXTURE))
  const historicalArtifact = JSON.parse(historicalArtifactSource)
  const historicalFixture = JSON.parse(historicalFixtureSource)
  if (historicalArtifact.surface_count !== 27 || historicalArtifact.records?.length !== 27) {
    throw new Error(`${HISTORICAL_ARTIFACT} is not the historical 27-route artifact`)
  }
  if (historicalFixture.routes?.length !== 27 || historicalFixture.surface_ids?.length !== 27) {
    throw new Error(`${HISTORICAL_FIXTURE} is not the historical 27-route fixture`)
  }
  return {
    schema: SCHEMA,
    source: {
      identity: "git_blob_and_sha256_per_captured_input",
      inputs
    },
    generator: {
      path: toPosix(path.relative(root, fileURLToPath(import.meta.url))),
      sha256: sha256(await fs.readFile(fileURLToPath(import.meta.url)))
    },
    historical_artifact: {
      path: HISTORICAL_ARTIFACT,
      sha256: sha256(historicalArtifactSource),
      fixture_path: HISTORICAL_FIXTURE,
      fixture_sha256: sha256(historicalFixtureSource),
      registration_count: 27,
      status: "historical_27_route_source_attribution_preserved"
    },
    counts: {
      registrations: records.length,
      by_declared_method_class: byMethod,
      primary_handler_owners: records.length,
      fallback_handler_owners: records.filter(({ fallback_handler_symbol: symbol }) => symbol !== null).length,
      handler_owner_bindings: records.length + records.filter(({ fallback_handler_symbol: symbol }) => symbol !== null).length,
      duplicate_registration_ids: duplicateIds.length
    },
    registrations: records
  }
}

async function main() {
  const { root, output, verify } = parseArguments(process.argv.slice(2))
  const denominator = await buildDenominator(root)
  const serialized = `${JSON.stringify(denominator, null, 2)}\n`
  const relativeOutput = path.relative(root, output)
  const outputReference = relativeOutput.startsWith("..") ? output : toPosix(relativeOutput)
  if (verify) {
    const committedOutput = await fs.readFile(output, "utf8")
    if (committedOutput !== serialized) {
      throw new Error(`${outputReference} is stale; regenerate the WWS route denominator`)
    }
    process.stdout.write(`verified ${denominator.counts.registrations} WWS route registrations in ${outputReference}\n`)
    return
  }
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, serialized)
  process.stdout.write(`wrote ${denominator.counts.registrations} WWS route registrations to ${outputReference}\n`)
}

main().catch((error) => {
  process.stderr.write(`WWS route denominator failed: ${error.message}\n`)
  process.exitCode = 1
})
