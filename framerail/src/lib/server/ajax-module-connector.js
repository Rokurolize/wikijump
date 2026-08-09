const AJAX_MODULE_CONNECTOR_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/plain; charset=UTF-8"
}
const MAX_AJAX_MODULE_CONNECTOR_BODY_BYTES = 131_072
const CONTROL_FIELDS = new Set([
  "moduleName",
  "module_body",
  "wikidot_token7",
  "callbackIndex",
  "eventSource"
])
const FORUM_READ_MODULE_PARAMETERS = new Map([
  ["forum/ForumStartModule", new Set(["hidden"])],
  ["forum/ForumViewCategoryModule", new Set(["c", "p"])],
  ["forum/ForumViewThreadModule", new Set(["t"])],
  ["forum/ForumViewThreadPostsModule", new Set(["t", "pageNo"])],
  ["forum/ForumRecentPostsListModule", new Set(["page", "categoryId"])]
])
const NEWPAGE_ACTION = "misc/NewPageHelperAction"
const NEWPAGE_EVENT = "createNewPage"
const PAGE_DISCUSSION_ACTION = "ForumAction"
const PAGE_DISCUSSION_EVENT = "createPageDiscussionThread"
const NEWPAGE_AUTOSAVE_MODES = new Set(["save-and-refresh", "save-and-go"])
const NEWPAGE_NO_NAME_MESSAGE = "You should provide a page name"
const NEWPAGE_INCORRECT_NAME_MESSAGE =
  "The page name is not correct: please fix it and try again"
const NEWPAGE_NO_PERMISSION_MESSAGE =
  'Sorry, you can not create a new page in this category. Only members of this site, site administrators and perhaps selected moderators are allowed to do it. <a href="#action:login">Sign in as Wikidot user</a>'
const NEWPAGE_GENERIC_ERROR_MESSAGE = "An error occurred while processing the request."
const MAX_WIKIDOT_PAGE_UNIX_NAME_LENGTH = 60
const MAX_NEWPAGE_PAGE_NAME_LENGTH = 128
const MAX_NEWPAGE_FORMAT_LENGTH = 512

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
 * @typedef {{
 *   siteId: number
 *   moduleName: string
 *   parameters: Record<string, string>
 * }} ForumModuleRenderInput
 *
 * @typedef {{
 *   siteId: number
 *   renderListPages: (
 *     input: ListPagesRenderInput
 *   ) => Promise<{ body: string }>
 *   renderForumModule?: (
 *     input: ForumModuleRenderInput
 *   ) => Promise<{ status: string; body: string }>
 *   createNewPage?: (input: NewPageCreateInput) => Promise<void>
 *   canCreateNewPage?: boolean | (() => boolean | Promise<boolean>)
 *   pageExists?: (slug: string) => boolean | Promise<boolean>
 *   createPageDiscussion?: (input: {
 *     siteId: number
 *     pageId: number
 *   }) => Promise<{ thread_id: number; thread_unix_title: string } | null>
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

/** @param {string} value */
const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

/** @param {{ pageName: string; categoryName: string }} input */
const toWikidotUnixName = ({ pageName, categoryName }) => {
  const normalizedCategory = categoryName === "_default" ? "" : categoryName
  const prefixed =
    normalizedCategory.length > 0 ? `${normalizedCategory}:${pageName}` : pageName
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
 * Reject regex features whose backtracking cost cannot be bounded by this
 * synchronous request handler. The accepted NewPage formats are simple
 * anchored patterns; nested quantifiers, ambiguous alternation,
 * lookarounds, and backreferences are unsupported and fail closed.
 *
 * @param {string} format
 */
const newPageFormatIsSafe = (format) => {
  if (format.length > MAX_NEWPAGE_FORMAT_LENGTH) return false
  if (!format.startsWith("/")) return true

  const delimiter = format.lastIndexOf("/")
  if (delimiter <= 0) return true

  const pattern = format.slice(1, delimiter)
  const groups = [{ hasQuantifier: false, hasAlternation: false }]
  let escaped = false
  let inCharacterClass = false
  let previousWasQuantifier = false

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (escaped) {
      if (/^[1-9]$/u.test(character)) return false
      escaped = false
      previousWasQuantifier = false
      continue
    }
    if (character === "\\") {
      escaped = true
      continue
    }
    if (inCharacterClass) {
      if (character === "]") inCharacterClass = false
      continue
    }
    if (character === "[") {
      inCharacterClass = true
      previousWasQuantifier = false
      continue
    }
    if (character === "(") {
      if (pattern[index + 1] === "?" && pattern[index + 2] !== ":") return false
      groups.push({ hasQuantifier: false, hasAlternation: false })
      previousWasQuantifier = false
      continue
    }
    if (character === "|") {
      groups.at(-1).hasAlternation = true
      previousWasQuantifier = false
      continue
    }
    if (character === ")") {
      if (groups.length === 1) return false
      const group = groups.pop()
      const next = pattern[index + 1]
      const quantifiesGroup = next === "*" || next === "+" || next === "?" || next === "{"
      if (quantifiesGroup && (group.hasQuantifier || group.hasAlternation)) return false
      if (quantifiesGroup) groups.at(-1).hasQuantifier = true
      previousWasQuantifier = false
      continue
    }
    if (
      character === "*" ||
      character === "+" ||
      character === "?" ||
      character === "{"
    ) {
      if (previousWasQuantifier) return false
      groups.at(-1).hasQuantifier = true
      previousWasQuantifier = true
      continue
    }
    previousWasQuantifier = false
  }

  // Let the parser's existing malformed-format fallback handle unclosed
  // delimiters and groups; only recognized, executable patterns are subject
  // to the safety decision above.
  return true
}

/**
 * @param {string} pageName
 * @param {string} format
 */
const matchesNewPageFormat = (pageName, format) => {
  if (format.length === 0) return true

  if (pageName.length > MAX_NEWPAGE_PAGE_NAME_LENGTH) return false
  if (!newPageFormatIsSafe(format)) return false

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
      status: "no_name",
      message: NEWPAGE_NO_NAME_MESSAGE
    })
  }

  const unixName = toWikidotUnixName({
    pageName,
    categoryName: fieldValue(fields, "categoryName")
  })
  if (pageExists && (await pageExists(unixName))) {
    const escapedUnixName = escapeHtml(unixName)
    return jsonResponse({
      status: "page_exists",
      message: `The page <em>${escapedUnixName}</em> already exists. <a href="/${escapedUnixName}">Jump to it</a> if you wish.`
    })
  }

  if (!matchesNewPageFormat(pageName, fieldValue(fields, "format"))) {
    return jsonResponse({
      status: "incorrect_name",
      message: NEWPAGE_INCORRECT_NAME_MESSAGE
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
        message: NEWPAGE_NO_PERMISSION_MESSAGE
      })
    }
    if (templateId.length > 0 && tags.length > 0) {
      return jsonResponse({
        status: "not_ok",
        message: NEWPAGE_GENERIC_ERROR_MESSAGE
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
      tags: templateId.length > 0 ? [] : splitNewPageTags(tags),
      parentPage: templateId.length > 0 ? "" : parentPage
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
  {
    siteId,
    renderListPages,
    renderForumModule,
    createNewPage,
    canCreateNewPage = true,
    pageExists,
    createPageDiscussion
  }
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

  if (
    fields.get("action") === PAGE_DISCUSSION_ACTION &&
    fields.get("event") === PAGE_DISCUSSION_EVENT
  ) {
    const callbackIndex = fields.has("callbackIndex")
      ? fieldValue(fields, "callbackIndex")
      : null
    const responseMetadata = () => ({
      callbackIndex,
      CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000)
    })
    const rawPageId = fieldValue(fields, "page_id")
    if (!/^\d+$/u.test(rawPageId) || !createPageDiscussion) {
      return jsonResponse({
        status: "no_page",
        message: "The page does not exist",
        ...responseMetadata()
      })
    }
    const pageId = Number.parseInt(rawPageId, 10)
    if (!Number.isSafeInteger(pageId) || pageId <= 0) {
      return jsonResponse({
        status: "no_page",
        message: "The page does not exist",
        ...responseMetadata()
      })
    }

    try {
      const discussion = await createPageDiscussion({ siteId, pageId })
      if (!discussion) {
        return jsonResponse({
          status: "no_page",
          message: "The page does not exist",
          ...responseMetadata()
        })
      }
      return jsonResponse({
        status: "ok",
        thread_id: discussion.thread_id,
        thread_unix_title: discussion.thread_unix_title,
        ...responseMetadata()
      })
    } catch (error) {
      console.error("AJAX page discussion action failed", error)
      return jsonResponse({
        status: "not_ok",
        message: "Unable to create page discussion",
        ...responseMetadata()
      })
    }
  }

  const moduleName = fields.get("moduleName")
  const forumParameters = moduleName
    ? FORUM_READ_MODULE_PARAMETERS.get(moduleName)
    : undefined
  if (forumParameters) {
    if (!renderForumModule) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module: ${moduleName}`
      })
    }

    /** @type {Record<string, string>} */
    const parameters = {}
    for (const [key, value] of fields) {
      if (CONTROL_FIELDS.has(key)) continue
      if (!forumParameters.has(key)) {
        return jsonResponse({
          status: "not_ok",
          message: `Unsupported AJAX module shape: ${moduleName}`
        })
      }
      parameters[key] = value
    }
    const callbackIndex = fields.has("callbackIndex")
      ? fieldValue(fields, "callbackIndex")
      : null
    const responseMetadata = () => ({
      callbackIndex,
      CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000),
      cssInclude: [],
      jsInclude: []
    })
    try {
      const output = await renderForumModule({ siteId, moduleName, parameters })
      return jsonResponse({
        status: output.status,
        body: output.body,
        ...responseMetadata()
      })
    } catch (error) {
      console.error("AJAX forum rendering failed", error)
      return jsonResponse({
        status: "not_ok",
        body: "",
        ...responseMetadata()
      })
    }
  }

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
