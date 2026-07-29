const AJAX_MODULE_CONNECTOR_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8"
}
const MAX_AJAX_MODULE_CONNECTOR_BODY_BYTES = 131_072
const CONTROL_FIELDS = new Set([
  "moduleName",
  "module_body",
  "wikidot_token7",
  "callbackIndex",
  "eventSource"
])
const NEWPAGE_ACTION = "misc/NewPageHelperAction"
const NEWPAGE_EVENT = "createNewPage"
const NEWPAGE_AUTOSAVE_MODES = new Set(["save-and-refresh", "save-and-go"])
const MAX_WIKIDOT_PAGE_UNIX_NAME_LENGTH = 60

/**
 * @typedef {{
 *   slug: string
 *   title: string
 *   wikitext: string
 *   tags: string[]
 *   parentPage: string
 * }} NewPageCreateInput
 *
 *
 * @typedef {{
 *   siteId: number
 *   moduleBody: string
 *   parameters: Record<string, string>
 * }} ListPagesRenderInput
 *
 *
 * @typedef {{
 *   siteId: number
 *   renderListPages: (
 *     input: ListPagesRenderInput
 *   ) => Promise<{ body: string }>
 *   createNewPage?: (input: NewPageCreateInput) => Promise<void>
 *   canCreateNewPage?: boolean | (() => boolean | Promise<boolean>)
 *   pageExists?: (slug: string) => boolean | Promise<boolean>
 * }} AjaxModuleConnectorOptions
 */

/**
 * @param {Record<string, unknown>} body
 * @param {number} [status]
 * @param {HeadersInit} [extraHeaders]
 */
const jsonResponse = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...AJAX_MODULE_CONNECTOR_HEADERS, ...extraHeaders }
  })

/**
 * @param {Request} request
 * @returns {Promise<Map<string, string>>}
 */
const readUrlEncodedForm = async (request) => {
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
    return new Map()
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
  for (const [key, value] of form) {
    if (values.has(key)) {
      throw new TypeError(`AJAX Module Connector field is duplicated: ${key}`)
    }
    values.set(key, value)
  }
  return values
}

/**
 * @param {Map<string, string>} fields
 * @param {string} name
 */
const fieldValue = (fields, name) => fields.get(name) ?? ""

/** @param {string} tags */
const splitNewPageTags = (tags) => tags.split(/\s+/u).filter((tag) => tag.length > 0)

/** @param {{ pageName: string; categoryName: string }} input */
const toWikidotUnixName = ({ pageName, categoryName }) => {
  const prefixed = categoryName.length > 0 ? `${categoryName}:${pageName}` : pageName
  return prefixed.slice(0, MAX_WIKIDOT_PAGE_UNIX_NAME_LENGTH)
}

/**
 * @param {string} format
 * @returns {RegExp | null}
 */
const parseDelimitedRegex = (format) => {
  if (!format.startsWith("/")) return null

  const delimiter = format.lastIndexOf("/")
  if (delimiter <= 0) return null

  const pattern = format.slice(1, delimiter)
  const rawFlags = format.slice(delimiter + 1)
  let flags = ""
  if (rawFlags.includes("i")) flags += "i"
  if (rawFlags.includes("m")) flags += "m"
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

/**
 * @param {string} pageName
 * @param {string} format
 */
const matchesNewPageFormat = (pageName, format) => {
  if (format.length === 0) return true

  const regex = parseDelimitedRegex(format)
  if (!regex) return true
  return regex.test(pageName)
}

/** @param {AjaxModuleConnectorOptions["canCreateNewPage"]} canCreateNewPage */
const resolveCanCreateNewPage = async (canCreateNewPage) => {
  if (typeof canCreateNewPage === "function") return Boolean(await canCreateNewPage())
  return Boolean(canCreateNewPage)
}

/**
 * @param {Map<string, string>} fields
 * @param {Pick<
 *   AjaxModuleConnectorOptions,
 *   "createNewPage" | "canCreateNewPage" | "pageExists"
 * >} options
 */
const handleNewPageHelperRequest = async (
  fields,
  { createNewPage, canCreateNewPage, pageExists }
) => {
  const pageName = fieldValue(fields, "pageName")
  if (pageName.length === 0) {
    return jsonResponse({
      status: "incorrect_name",
      message: "Incorrect page name."
    })
  }

  const unixName = toWikidotUnixName({
    pageName,
    categoryName: fieldValue(fields, "categoryName")
  })
  if (pageExists && (await pageExists(unixName))) {
    return jsonResponse({
      status: "page_exists"
    })
  }

  if (!matchesNewPageFormat(pageName, fieldValue(fields, "format"))) {
    return jsonResponse({
      status: "incorrect_name",
      message: "Page name does not match the required format."
    })
  }

  const pageTitle = pageName
  const tags = fieldValue(fields, "tags")
  const parentPage = fieldValue(fields, "parent")
  const templateId = fieldValue(fields, "template")
  const mode = fieldValue(fields, "mode")

  if (NEWPAGE_AUTOSAVE_MODES.has(mode)) {
    if (!(await resolveCanCreateNewPage(canCreateNewPage))) {
      return jsonResponse({
        status: "no_permission",
        message: "Permission denied."
      })
    }
    if (templateId.length > 0) {
      return jsonResponse({
        status: "not_ok"
      })
    }
    if (!createNewPage) {
      return jsonResponse({
        status: "not_ok",
        message: "NewPage autosave is unavailable"
      })
    }

    await createNewPage({
      slug: unixName,
      title: pageTitle,
      wikitext: "",
      tags: splitNewPageTags(tags),
      parentPage
    })

    return jsonResponse({
      status: "ok",
      goToUrl: mode === "save-and-refresh" ? "." : fieldValue(fields, "goTo") || unixName
    })
  }

  /**
   * @type {{
   *   status: string
   *   unixName: string
   *   pageTitle: string
   *   tags: string
   *   parentPage: string
   *   templateId?: string
   * }}
   */
  const response = {
    status: "ok",
    unixName,
    pageTitle,
    tags,
    parentPage
  }
  if (templateId.length > 0) response.templateId = templateId
  return jsonResponse(response)
}

/**
 * @param {Request} request
 * @param {AjaxModuleConnectorOptions} options
 */
export const handleAjaxModuleConnectorRequest = async (
  request,
  { siteId, renderListPages, createNewPage, canCreateNewPage = true, pageExists }
) => {
  if (request.method !== "POST") {
    return jsonResponse(
      { status: "not_ok", message: "AJAX Module Connector requires POST" },
      405,
      { allow: "POST" }
    )
  }

  /** @type {Map<string, string>} */
  let fields
  try {
    fields = await readUrlEncodedForm(request)
  } catch (error) {
    const status = error instanceof RangeError ? 413 : 400
    return jsonResponse(
      {
        status: "not_ok",
        message:
          error instanceof Error
            ? error.message
            : "Malformed AJAX Module Connector request"
      },
      status
    )
  }

  if (fields.get("action") === NEWPAGE_ACTION && fields.get("event") === NEWPAGE_EVENT) {
    try {
      return await handleNewPageHelperRequest(fields, {
        createNewPage,
        canCreateNewPage,
        pageExists
      })
    } catch (error) {
      console.error("AJAX NewPage helper action failed", error)
      return jsonResponse({
        status: "not_ok",
        message: "Unable to create NewPage target"
      })
    }
  }

  const moduleName = fields.get("moduleName")
  if (moduleName !== "list/ListPagesModule") {
    return jsonResponse({
      status: "not_ok",
      message: `Unsupported AJAX module: ${moduleName ?? ""}`
    })
  }

  const moduleBody = fields.get("module_body")
  if (moduleBody === undefined) {
    return jsonResponse({
      status: "not_ok",
      message: "ListPages module_body is required"
    })
  }

  /** @type {Record<string, string>} */
  const parameters = {}
  for (const [key, value] of fields) {
    if (!CONTROL_FIELDS.has(key)) parameters[key] = value
  }

  try {
    const output = await renderListPages({
      siteId,
      moduleBody,
      parameters
    })
    return jsonResponse({ status: "ok", body: output.body })
  } catch (error) {
    console.error("AJAX ListPages rendering failed", error)
    return jsonResponse({
      status: "not_ok",
      message: "Unable to render ListPages module"
    })
  }
}
