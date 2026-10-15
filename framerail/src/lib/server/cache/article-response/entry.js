/** @typedef {[string, string]} HeaderPair */
/**
 * @typedef {object} CachedArticleResponseEntry
 * @property {number} status
 * @property {HeaderPair[]} headers
 * @property {string} body
 * @property {Buffer} [bodyBuffer]
 */

/**
 * @param {unknown} value
 * @returns {value is HeaderPair}
 */
export const isHeaderPair = (value) => {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string"
  )
}

/**
 * @param {unknown} value
 * @returns {value is CachedArticleResponseEntry}
 */
const isCachedArticleResponse = (value) => {
  if (value === null || typeof value !== "object") return false
  const candidate = /** @type {Partial<CachedArticleResponseEntry>} */ (value)
  return (
    Number.isInteger(candidate.status) &&
    Number(candidate.status) >= 200 &&
    Number(candidate.status) <= 599 &&
    Array.isArray(candidate.headers) &&
    candidate.headers.every(isHeaderPair) &&
    typeof candidate.body === "string"
  )
}

/**
 * @param {unknown} value
 * @returns {CachedArticleResponseEntry | null}
 */
export const normalizeCachedArticleResponseEntry = (value) => {
  if (!isCachedArticleResponse(value)) return null

  return {
    status: value.status,
    headers: value.headers.map(([name, headerValue]) => [name, headerValue]),
    body: value.body
  }
}

/**
 * @param {CachedArticleResponseEntry} entry
 * @returns {CachedArticleResponseEntry}
 */
export const copyCachedArticleResponseEntry = (entry) => {
  /** @type {CachedArticleResponseEntry} */
  const copy = {
    status: entry.status,
    headers: entry.headers.map(([name, value]) => [name, value]),
    body: entry.body
  }
  if (Buffer.isBuffer(entry.bodyBuffer)) {
    copy.bodyBuffer = Buffer.from(entry.bodyBuffer)
  }
  return copy
}

// SvelteKit writes a fresh base64 nonce into the CSP header and into each inline
// `nonce="..."` attribute of a dynamic response. A cached response must not replay
// its first nonce, so the nonce is renewed in both places on every serve.
const CSP_NONCE_DETECT = /'nonce-[A-Za-z0-9+/_=-]+'/u
const HTML_NONCE_DETECT = /\bnonce="[A-Za-z0-9+/_=-]+"/u
const CSP_NONCE_REPLACE = /'nonce-[A-Za-z0-9+/_=-]+'/gu
const HTML_NONCE_REPLACE = /\bnonce="[A-Za-z0-9+/_=-]+"/gu

/**
 * @param {{ headers: HeaderPair[]; body: string }} entry
 * @returns {boolean}
 */
export const containsCspNonce = (entry) => {
  return (
    entry.headers.some(([, value]) => CSP_NONCE_DETECT.test(value)) ||
    HTML_NONCE_DETECT.test(entry.body)
  )
}

/**
 * Returns a copy of the entry whose CSP nonce and inline nonce attributes
 * all carry `nonce`. Entries without a nonce are returned unchanged. The
 * copy drops `bodyBuffer` so the renewed string body is the single source
 * of bytes.
 *
 * @template {{ headers: HeaderPair[]; body: string }} T
 * @param {T} entry
 * @param {string} nonce Base64 nonce from a fresh random source
 * @returns {T}
 */
export const renewCspNonce = (entry, nonce) => {
  if (!containsCspNonce(entry)) return entry
  return {
    ...entry,
    headers: entry.headers.map(([name, value]) => [
      name,
      value.replace(CSP_NONCE_REPLACE, `'nonce-${nonce}'`)
    ]),
    body: entry.body.replace(HTML_NONCE_REPLACE, `nonce="${nonce}"`),
    bodyBuffer: undefined
  }
}
