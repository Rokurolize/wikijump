import { createHash } from "node:crypto"

const ARTICLE_ROUTES = new Set(["/", "/[slug]/[...extra]"])
const PERMISSION_FENCE = "anonymous-page-view-v1"
const RESPONSE_CACHE_PREFIX = "framerail:article-response:v1"
const SESSION_COOKIE = "wikijump_token"

const utf8Hex = (value) => {
  return Buffer.from(value, "utf8").toString("hex")
}

const sha256Hex = (value) => {
  return createHash("sha256").update(value).digest("hex")
}

const hasSessionCookie = (cookieHeader) => {
  if (!cookieHeader) return false

  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .some(
      (cookie) => cookie === SESSION_COOKIE || cookie.startsWith(`${SESSION_COOKIE}=`)
    )
}

const isEmptyExtra = (extra) => {
  return extra === undefined || extra === null || extra === ""
}

const reject = (reason) => {
  return { cacheable: false, reason }
}

export const canConsiderAnonymousArticleResponseCache = ({
  method,
  routeId,
  url,
  siteId,
  siteSlug,
  route,
  cookieHeader
}) => {
  if (method !== "GET") return reject("method")
  if (!ARTICLE_ROUTES.has(routeId ?? "")) return reject("route")
  if (url.search !== "") return reject("query")
  if (!Number.isInteger(siteId) || siteId <= 0) return reject("site-id")
  if (!siteSlug) return reject("site-slug")
  if (hasSessionCookie(cookieHeader)) return reject("session-cookie")
  if (!isEmptyExtra(route?.extra)) return reject("extra")

  return { cacheable: true }
}

export const buildAnonymousArticleResponseCacheMetadata = ({
  siteId,
  siteSlug,
  requestLocales,
  backendLocales,
  deepwellArticlePageCacheKey
}) => {
  if (!Number.isInteger(siteId) || siteId <= 0) return null
  if (!siteSlug) return null
  if (!Array.isArray(requestLocales) || !Array.isArray(backendLocales)) return null
  if (!deepwellArticlePageCacheKey) return null

  return {
    siteId,
    siteSlug,
    requestLocales,
    backendLocales,
    deepwellArticlePageCacheKey,
    permissionFence: PERMISSION_FENCE
  }
}

export const buildAnonymousArticleResponseCacheKey = (metadata) => {
  return [
    RESPONSE_CACHE_PREFIX,
    `site=${metadata.siteId}`,
    `slug=${utf8Hex(metadata.siteSlug)}`,
    `requestLocales=${utf8Hex(metadata.requestLocales.join(","))}`,
    `backendLocales=${utf8Hex(metadata.backendLocales.join(","))}`,
    `permission=${metadata.permissionFence}`,
    `deepwell=${sha256Hex(metadata.deepwellArticlePageCacheKey)}`
  ].join(":")
}

const normalizedHeaderEntries = (headers) => {
  return [...headers.entries()]
    .filter(([name]) => name.toLowerCase() !== "set-cookie")
    .sort(([left], [right]) => left.localeCompare(right))
}

export const serializeArticleResponseForCache = async (response) => {
  return {
    status: response.status,
    headers: normalizedHeaderEntries(response.headers),
    body: await response.clone().text()
  }
}

const isHeaderPair = (value) => {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string"
  )
}

const isCachedArticleResponse = (value) => {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.status) &&
    value.status >= 200 &&
    value.status <= 599 &&
    Array.isArray(value.headers) &&
    value.headers.every(isHeaderPair) &&
    typeof value.body === "string"
  )
}

export const deserializeCachedArticleResponse = (value) => {
  if (!isCachedArticleResponse(value)) return null

  return new Response(value.body, {
    status: value.status,
    headers: value.headers
  })
}

export const readCachedArticleResponse = async (store, key) => {
  try {
    const cached = await store.get(key)
    if (typeof cached !== "string") return null

    return deserializeCachedArticleResponse(JSON.parse(cached))
  } catch {
    return null
  }
}

export const writeCachedArticleResponse = async (store, key, entry, ttlSeconds) => {
  try {
    await store.set(key, JSON.stringify(entry), ttlSeconds)
    return true
  } catch {
    return false
  }
}
