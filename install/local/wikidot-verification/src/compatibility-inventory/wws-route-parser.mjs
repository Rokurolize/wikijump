import { matchingRustDelimiter, productionRustTokens, rustPath, scanRustTokens, splitRustArguments } from "./rust-source.mjs"

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

export function discoverWwsRouteRecords(sourceText, registryPath = "wws/src/route.rs") {
  const tokens = productionRustTokens(scanRustTokens(sourceText, registryPath), registryPath)
  const declarations = extractWwsRouteDeclarations(tokens, registryPath)
  if (declarations.length === 0) throw new Error(`${registryPath} declares no WWS routes`)
  return aggregateWwsDispatch(declarations, registryPath)
}
