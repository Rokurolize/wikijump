const MAX_AJAX_MODULE_CONNECTOR_BODY_BYTES = 131_072
export const CONTROL_FIELDS = new Set([
  "moduleName",
  "module_body",
  "wikidot_token7",
  "callbackIndex",
  "eventSource"
])
const FORUM_POSITIVE_DECIMAL_FIELDS = new Set(["pageId", "c", "p", "t", "pageNo", "page"])

export const isSupportedPageReadShape = (moduleName, parameters) => {
  if (moduleName === "pagerate/WhoRatedPageModule") {
    return isPositiveSafeDecimal(parameters.pageId)
  }
  if (
    moduleName === "viewsource/ViewSourceModule" ||
    moduleName === "files/PageFilesModule"
  ) {
    return isPositiveSafeDecimal(parameters.page_id)
  }
  if (moduleName === "history/PageRevisionListModule") {
    return (
      isPositiveSafeDecimal(parameters.page_id) &&
      parameters.options === "{'all': True}" &&
      parameters.perpage === "100000000"
    )
  }
  return isPositiveSafeDecimal(parameters.revision_id)
}

/**
 * @param {Request} request
 * @returns {Promise<{
 *   fields: Map<string, string>
 *   duplicateFields: Set<string>
 * }>}
 */
export const readUrlEncodedForm = async (request) => {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim()
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new TypeError("AJAX Module Connector requires URL-encoded form data")
  }

  const contentLength = request.headers.get("content-length")
  if (contentLength !== null) {
    const normalized = contentLength.trim()
    if (!/^\d+$/.test(normalized)) {
      throw new TypeError("AJAX Module Connector content length is invalid")
    }
    if (Number.parseInt(normalized, 10) > MAX_AJAX_MODULE_CONNECTOR_BODY_BYTES) {
      throw new RangeError("AJAX Module Connector request body is too large")
    }
  }

  const reader = request.body?.getReader()
  if (reader === undefined) {
    return { fields: new Map(), duplicateFields: new Set() }
  }

  /** @type {Uint8Array[]} */
  const chunks = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_AJAX_MODULE_CONNECTOR_BODY_BYTES) {
        throw new RangeError("AJAX Module Connector request body is too large")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  const form = new URLSearchParams(body)
  const values = new Map()
  const duplicateFields = new Set()
  for (const [key, value] of form) {
    if (values.has(key)) duplicateFields.add(key)
    values.set(key, value)
  }
  return { fields: values, duplicateFields }
}

/**
 * @param {Map<string, string>} fields
 * @param {string} name
 */
export const fieldValue = (fields, name) => fields.get(name) ?? ""

/**
 * Selected public token from the request cookie jar. Live Wikidot binds
 * the ListPages `wikidot_token7` form field to the presented cookie by
 * exact echo: any echoed value is accepted and any mismatch fails with
 * `wrong_token7`, without a server-issued allowlist. Duplicate cookie
 * names keep the first value, matching the observed Wikidot cookie
 * parser.
 *
 * @param {Request} request
 */
export const requestWikidotTokenCookie = (request) => {
  const header = request.headers.get("cookie")
  if (header === null) return undefined
  let selected
  for (const part of header.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== "wikidot_token7") continue
    if (selected === undefined) selected = part.slice(separator + 1).trim()
  }
  return selected
}

/** @param {string} value */
const isCanonicalPositiveDecimal = (value) => /^[1-9][0-9]*$/u.test(value)

/** @param {string} value */
export const isCanonicalNonNegativeDecimal = (value) =>
  /^(?:0|[1-9][0-9]*)$/u.test(value) && Number.isSafeInteger(Number.parseInt(value, 10))

/** @param {string} value */
export const isPositiveSafeDecimal = (value) => {
  if (!isCanonicalPositiveDecimal(value)) return false
  return Number.isSafeInteger(Number.parseInt(value, 10))
}

/** @param {Record<string, string>} parameters */
export const forumNumericParametersAreCanonical = (parameters) => {
  for (const field of FORUM_POSITIVE_DECIMAL_FIELDS) {
    const value = parameters[field]
    if (value !== undefined && !isCanonicalPositiveDecimal(value)) return false
  }
  const categoryId = parameters.categoryId
  return (
    categoryId === undefined ||
    categoryId === "" ||
    isCanonicalPositiveDecimal(categoryId)
  )
}
