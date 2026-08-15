import { classifyWikidotSiteChangesRequest } from "./wikidot-site-changes.js"

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
  ["forum/ForumStartModule", [new Set(), new Set(["hidden"])]],
  ["forum/ForumCommentsListModule", [new Set(["pageId"]), new Set(["pageId", "order"])]],
  ["forum/ForumViewCategoryModule", [new Set(["c", "p"])]],
  ["forum/ForumViewThreadModule", [new Set(["t"])]],
  ["forum/ForumViewThreadPostsModule", [new Set(["t", "pageNo"])]],
  ["forum/ForumRecentPostsListModule", [new Set(["page", "categoryId"])]]
])
const FORUM_POSITIVE_DECIMAL_FIELDS = new Set(["pageId", "c", "p", "t", "pageNo", "page"])
const SITE_CHANGES_MODULE = "changes/SiteChangesListModule"
const MEMBERS_LIST_MODULE = "membership/MembersListModule"
const MANAGE_SITE_GENERAL_MODULE = "managesite/ManageSiteGeneralModule"
const MEMBERS_LIST_PARAMETERS = new Set(["group", "order", "page"])
const MEMBERS_LIST_DEFAULT_PARAMETERS = new Set(["group", "page"])
const SITE_TOOLS_READ_MODULES = new Map([
  ["sitetools/SiteToolsModule", { callbackIndex: "1", parameters: new Set() }],
  ["sitetools/WantedPagesModule", { callbackIndex: "2", parameters: new Set() }],
  ["sitetools/OrphanedPagesModule", { callbackIndex: "3", parameters: new Set() }],
  ["list/ListDraftsModule", { callbackIndex: "4", parameters: new Set(["location"]) }]
])
const PAGE_READ_MODULE_PARAMETERS = new Map([
  ["pagerate/WhoRatedPageModule", new Set(["pageId"])],
  ["viewsource/ViewSourceModule", new Set(["page_id"])],
  ["files/PageFilesModule", new Set(["page_id"])],
  ["history/PageRevisionListModule", new Set(["page_id", "options", "perpage"])],
  ["history/PageSourceModule", new Set(["revision_id"])],
  ["history/PageVersionModule", new Set(["revision_id"])]
])
const LIST_PAGES_PARAMETERS = new Set([
  "p",
  "pagetype",
  "page_type",
  "page-type",
  "category",
  "tags",
  "tag",
  "parent",
  "created_at",
  "createdat",
  "updated_at",
  "updatedat",
  "created_by",
  "createdby",
  "rating",
  "score",
  "name",
  "fullname",
  "full_slug",
  "fullslug",
  "range",
  "order",
  "offset",
  "limit",
  "perpage",
  "per_page",
  "separate",
  "wrapper",
  "rss",
  "rsstitle",
  "rssdescription",
  "rsshome",
  "rsslimit",
  "rssonly"
])
const NEWPAGE_ACTION = "misc/NewPageHelperAction"
const NEWPAGE_EVENT = "createNewPage"
const PAGE_DISCUSSION_ACTION = "ForumAction"
const PAGE_DISCUSSION_EVENT = "createPageDiscussionThread"
const EDIT_META_MODULE = "edit/EditMetaModule"
const EDIT_META_ACTION = "WikiPageAction"
const EDIT_META_EVENTS = new Set(["saveMetaTag", "deleteMetaTag"])
const PAGE_DELETE_EVENT = "deletePage"
const PAGE_DELETE_MODULE = "Empty"
const PAGE_DELETE_ACTION_FIELDS = new Set([
  "action",
  "event",
  "page_id",
  "moduleName",
  "wikidot_token7"
])
const EDIT_META_READ_FIELDS = new Set(["moduleName", "pageId", "wikidot_token7"])
const EDIT_META_ACTION_FIELDS = new Set([
  "action",
  "event",
  "pageId",
  "metaName",
  "metaContent",
  "allPages",
  "moduleName",
  "wikidot_token7"
])
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
 *
 * @typedef {{
 *   siteId: number
 *   moduleName: string
 *   parameters: Record<string, string>
 * }} ForumModuleRenderInput
 *
 *
 * @typedef {{
 *   siteId: number
 *   pageId?: string
 *   page: string
 *   perpage: string
 *   categoryId?: string
 *   options: string
 * }} SiteChangesRenderInput
 *
 *
 * @typedef {{
 *   siteId: number
 *   parameters: Record<string, string>
 * }} MembersListRenderInput
 *
 *
 * @typedef {{
 *   siteId: number
 *   renderListPages: (
 *     input: ListPagesRenderInput
 *   ) => Promise<{ body: string }>
 *   renderForumModule?: (input: ForumModuleRenderInput) => Promise<{
 *     status: string
 *     body: string
 *     thread_id?: number
 *     js_include?: string[]
 *   }>
 *   renderSiteChangesModule?: (
 *     input: SiteChangesRenderInput
 *   ) => Promise<{ status: string; body: string }>
 *   renderMembersList?: (
 *     input: MembersListRenderInput
 *   ) => Promise<{ status: string; body: string }>
 *   renderManageSiteGeneralModule?: (input: {
 *     siteId: number
 *   }) => Promise<{
 *     status: string
 *     body: string
 *     js_include?: string[]
 *   } | null>
 *   renderPageReadModule?: (input: ForumModuleRenderInput) => Promise<{
 *     status: string
 *     body: string
 *     js_include?: string[]
 *   }>
 *   renderSiteToolsModule?: (input: ForumModuleRenderInput) => Promise<{
 *     status: string
 *     body: string
 *   }>
 *   createNewPage?: (input: NewPageCreateInput) => Promise<void>
 *   canCreateNewPage?: boolean | (() => boolean | Promise<boolean>)
 *   pageExists?: (slug: string) => boolean | Promise<boolean>
 *   createPageDiscussion?: (input: {
 *     siteId: number
 *     pageId: number
 *   }) => Promise<{ thread_id: number; thread_unix_title: string } | null>
 *   renderEditMetaModule?: (input: {
 *     siteId: number
 *     pageId: number
 *   }) => Promise<{ status: string; body: string; js_include?: string[] }>
 *   saveMetaTag?: (input: {
 *     siteId: number
 *     pageId: number
 *     name: string
 *     content: string
 *     allPages: boolean
 *   }) => Promise<void>
 *   deleteMetaTag?: (input: {
 *     siteId: number
 *     pageId: number
 *     name: string
 *     allPages: boolean
 *   }) => Promise<void>
 *   deletePage?: (input: { siteId: number; pageId: number }) => Promise<void>
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
 * @param {string} moduleName
 * @param {Record<string, string>} parameters
 */
const isSupportedPageReadShape = (moduleName, parameters) => {
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

/** @param {string} value */
const isCanonicalPositiveDecimal = (value) => /^[1-9][0-9]*$/u.test(value)

/** @param {string} value */
const isPositiveSafeDecimal = (value) => {
  if (!isCanonicalPositiveDecimal(value)) return false
  return Number.isSafeInteger(Number.parseInt(value, 10))
}

/** @param {Record<string, string>} parameters */
const forumNumericParametersAreCanonical = (parameters) => {
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
    renderSiteChangesModule,
    renderMembersList,
    renderManageSiteGeneralModule,
    renderPageReadModule,
    renderSiteToolsModule,
    createNewPage,
    canCreateNewPage = true,
    pageExists,
    createPageDiscussion,
    renderEditMetaModule,
    saveMetaTag,
    deleteMetaTag,
    deletePage
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

  const moduleName = fields.get("moduleName")
  if (moduleName === MANAGE_SITE_GENERAL_MODULE) {
    if (fields.size !== 1) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
    }

    if (!renderManageSiteGeneralModule) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module: ${moduleName}`
      })
    }

    try {
      const output = await renderManageSiteGeneralModule({ siteId })
      if (!output) {
        return jsonResponse({
          status: "not_ok",
          message: `Unsupported AJAX module: ${moduleName}`
        })
      }
      return jsonResponse({
        status: output.status,
        body: output.body,
        callbackIndex: null,
        CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000),
        cssInclude: [],
        jsInclude: output.js_include ?? []
      })
    } catch (error) {
      console.error("AJAX ManageSiteGeneral rendering failed", error)
      return jsonResponse({
        status: "not_ok",
        body: "",
        callbackIndex: null,
        CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000),
        cssInclude: [],
        jsInclude: []
      })
    }
  }

  if (
    fields.get("action") === EDIT_META_ACTION &&
    fields.get("event") === PAGE_DELETE_EVENT
  ) {
    const pageIdValue = fieldValue(fields, "page_id")
    const shapeIsSupported =
      fields.get("moduleName") === PAGE_DELETE_MODULE &&
      [...fields.keys()].every((field) => PAGE_DELETE_ACTION_FIELDS.has(field)) &&
      isPositiveSafeDecimal(pageIdValue)
    if (!shapeIsSupported) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${fields.get("moduleName") ?? ""}`
      })
    }

    if (!deletePage) return jsonResponse({ status: "not_ok" })
    try {
      await deletePage({ siteId, pageId: Number.parseInt(pageIdValue, 10) })
      return jsonResponse({ status: "ok" })
    } catch (error) {
      console.error("AJAX deletePage action failed", error)
      return jsonResponse({ status: "not_ok" })
    }
  }

  const editMetaEvent = fields.get("event")
  if (
    moduleName === EDIT_META_MODULE &&
    fields.get("action") === EDIT_META_ACTION &&
    editMetaEvent !== undefined
  ) {
    const allowedFields =
      editMetaEvent === "saveMetaTag"
        ? EDIT_META_ACTION_FIELDS
        : new Set([...EDIT_META_ACTION_FIELDS].filter((field) => field !== "metaContent"))
    const pageIdValue = fieldValue(fields, "pageId")
    const name = fieldValue(fields, "metaName")
    const allPagesValue = fields.get("allPages")
    const shapeIsSupported =
      EDIT_META_EVENTS.has(editMetaEvent) &&
      [...fields.keys()].every((field) => allowedFields.has(field)) &&
      isPositiveSafeDecimal(pageIdValue) &&
      name.length > 0 &&
      !name.includes("\0") &&
      (allPagesValue === undefined || allPagesValue === "true") &&
      (editMetaEvent !== "saveMetaTag" || fields.has("metaContent"))
    if (!shapeIsSupported) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
    }

    const pageId = Number.parseInt(pageIdValue, 10)
    try {
      if (editMetaEvent === "saveMetaTag") {
        if (!saveMetaTag) {
          return jsonResponse({ status: "not_ok" })
        }
        await saveMetaTag({
          siteId,
          pageId,
          name,
          content: fieldValue(fields, "metaContent"),
          allPages: allPagesValue === "true"
        })
      } else {
        if (!deleteMetaTag) {
          return jsonResponse({ status: "not_ok" })
        }
        await deleteMetaTag({
          siteId,
          pageId,
          name,
          allPages: allPagesValue === "true"
        })
      }
      return jsonResponse({ status: "ok" })
    } catch (error) {
      console.error("AJAX EditMeta action failed", error)
      return jsonResponse({ status: "not_ok" })
    }
  }

  if (moduleName === EDIT_META_MODULE) {
    const pageIdValue = fieldValue(fields, "pageId")
    if (
      !renderEditMetaModule ||
      [...fields.keys()].some((field) => !EDIT_META_READ_FIELDS.has(field)) ||
      fields.has("action") ||
      fields.has("event") ||
      !isPositiveSafeDecimal(pageIdValue)
    ) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
    }

    try {
      const output = await renderEditMetaModule({
        siteId,
        pageId: Number.parseInt(pageIdValue, 10)
      })
      return jsonResponse({
        status: output.status,
        body: output.body,
        callbackIndex: null,
        CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000),
        cssInclude: [],
        jsInclude: output.js_include ?? []
      })
    } catch (error) {
      console.error("AJAX EditMeta rendering failed", error)
      return jsonResponse({
        status: "not_ok",
        body: "",
        callbackIndex: null,
        CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000),
        cssInclude: [],
        jsInclude: []
      })
    }
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

  if (moduleName === SITE_CHANGES_MODULE) {
    if (!renderSiteChangesModule) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module: ${moduleName}`
      })
    }

    const parameters = classifyWikidotSiteChangesRequest(fields)
    if (parameters === null) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
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
      const output = await renderSiteChangesModule({
        siteId,
        page: parameters.page,
        perpage: parameters.perpage,
        options: parameters.options,
        ...(parameters.pageId === undefined ? {} : { pageId: parameters.pageId }),
        ...(parameters.categoryId === undefined
          ? {}
          : { categoryId: parameters.categoryId })
      })
      return jsonResponse({
        status: output.status,
        body: output.body,
        ...responseMetadata()
      })
    } catch (error) {
      console.error("AJAX SiteChanges rendering failed", error)
      return jsonResponse({
        status: "not_ok",
        body: "",
        ...responseMetadata()
      })
    }
  }

  if (moduleName === MEMBERS_LIST_MODULE) {
    if (!renderMembersList) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module: ${moduleName}`
      })
    }

    /** @type {Record<string, string>} */
    const parameters = {}
    for (const [key, value] of fields) {
      if (MEMBERS_LIST_PARAMETERS.has(key)) {
        parameters[key] = value
        continue
      }
      if (key !== "moduleName" && key !== "wikidot_token7" && key !== "callbackIndex") {
        return jsonResponse({
          status: "not_ok",
          message: `Unsupported AJAX module shape: ${moduleName}`
        })
      }
    }
    const parameterNames = Object.keys(parameters)
    const isWikidotPyDefaultShape =
      parameterNames.length === MEMBERS_LIST_DEFAULT_PARAMETERS.size &&
      [...MEMBERS_LIST_DEFAULT_PARAMETERS].every((name) =>
        Object.hasOwn(parameters, name)
      )
    const isBrowserPagerShape =
      parameterNames.length === MEMBERS_LIST_PARAMETERS.size &&
      [...MEMBERS_LIST_PARAMETERS].every((name) => Object.hasOwn(parameters, name))
    if (
      (!isWikidotPyDefaultShape && !isBrowserPagerShape) ||
      parameters.group !== "" ||
      (parameters.order !== undefined && parameters.order !== "joined") ||
      !/^(?:0|[1-9]\d*)$/u.test(parameters.page)
    ) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
    }
    parameters.order ??= "joined"

    const responseMetadata = () => ({
      callbackIndex: fields.has("callbackIndex")
        ? fieldValue(fields, "callbackIndex")
        : null,
      CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000),
      cssInclude: [],
      jsInclude: []
    })
    try {
      const output = await renderMembersList({ siteId, parameters })
      return jsonResponse({
        status: output.status,
        body: output.body,
        ...responseMetadata()
      })
    } catch (error) {
      console.error("AJAX MembersListModule rendering failed", error)
      return jsonResponse({
        status: "not_ok",
        body: "",
        ...responseMetadata()
      })
    }
  }

  const siteToolsShape = moduleName ? SITE_TOOLS_READ_MODULES.get(moduleName) : undefined
  if (siteToolsShape && moduleName) {
    if (!renderSiteToolsModule) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module: ${moduleName}`
      })
    }

    /** @type {Record<string, string>} */
    const parameters = {}
    for (const [key, value] of fields) {
      if (siteToolsShape.parameters.has(key)) {
        parameters[key] = value
        continue
      }
      if (key !== "moduleName" && key !== "wikidot_token7" && key !== "callbackIndex") {
        return jsonResponse({
          status: "not_ok",
          message: `Unsupported AJAX module shape: ${moduleName}`
        })
      }
    }
    if (
      fieldValue(fields, "callbackIndex") !== siteToolsShape.callbackIndex ||
      Object.keys(parameters).length !== siteToolsShape.parameters.size ||
      ![...siteToolsShape.parameters].every((name) => Object.hasOwn(parameters, name)) ||
      (moduleName === "list/ListDraftsModule" && parameters.location !== "sitetools")
    ) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
    }

    const responseMetadata = () => ({
      callbackIndex: siteToolsShape.callbackIndex,
      CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000),
      cssInclude: [],
      jsInclude: []
    })
    try {
      const output = await renderSiteToolsModule({ siteId, moduleName, parameters })
      return jsonResponse({
        status: output.status,
        body: output.body,
        ...responseMetadata()
      })
    } catch (error) {
      console.error("AJAX Site Tools rendering failed", error)
      return jsonResponse({ status: "not_ok", body: "", ...responseMetadata() })
    }
  }

  const pageReadParameters = moduleName
    ? PAGE_READ_MODULE_PARAMETERS.get(moduleName)
    : undefined
  if (pageReadParameters && moduleName) {
    if (!renderPageReadModule) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module: ${moduleName}`
      })
    }

    /** @type {Record<string, string>} */
    const parameters = {}
    for (const [key, value] of fields) {
      if (pageReadParameters.has(key)) {
        parameters[key] = value
        continue
      }
      if (key !== "moduleName" && key !== "wikidot_token7" && key !== "callbackIndex") {
        return jsonResponse({
          status: "not_ok",
          message: `Unsupported AJAX module shape: ${moduleName}`
        })
      }
    }
    if (moduleName === "viewsource/ViewSourceModule" && parameters.page_id === "0") {
      return jsonResponse({
        status: "no_page",
        message: "The page does not exist",
        callbackIndex: fields.has("callbackIndex") ? fieldValue(fields, "callbackIndex") : null,
        CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000)
      })
    }
    if (
      Object.keys(parameters).length !== pageReadParameters.size ||
      ![...pageReadParameters].every((name) => Object.hasOwn(parameters, name)) ||
      !isSupportedPageReadShape(moduleName, parameters)
    ) {
      return jsonResponse(
        {
          status: "not_ok",
          message: `Unsupported AJAX module shape: ${moduleName}`
        },
        moduleName === "pagerate/WhoRatedPageModule" ? 500 : 200
      )
    }

    const responseMetadata = () => ({
      callbackIndex: fields.has("callbackIndex")
        ? fieldValue(fields, "callbackIndex")
        : null,
      CURRENT_TIMESTAMP: Math.floor(Date.now() / 1000),
      cssInclude: [],
      jsInclude: []
    })
    try {
      const output = await renderPageReadModule({ siteId, moduleName, parameters })
      return jsonResponse({
        status: output.status,
        body: output.body,
        ...responseMetadata(),
        jsInclude: output.js_include ?? []
      })
    } catch (error) {
      console.error("AJAX page read module rendering failed", error)
      return jsonResponse({
        status: "not_ok",
        body: "",
        ...responseMetadata()
      })
    }
  }

  const forumParameterShapes = moduleName
    ? FORUM_READ_MODULE_PARAMETERS.get(moduleName)
    : undefined
  if (forumParameterShapes) {
    if (!renderForumModule) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module: ${moduleName}`
      })
    }

    /** @type {Record<string, string>} */
    const parameters = {}
    for (const [key, value] of fields) {
      if (CONTROL_FIELDS.has(key)) {
        if (key === "module_body") {
          return jsonResponse({
            status: "not_ok",
            message: `Unsupported AJAX module shape: ${moduleName}`
          })
        }
        continue
      }
      if (!forumParameterShapes.some((shape) => shape.has(key))) {
        return jsonResponse({
          status: "not_ok",
          message: `Unsupported AJAX module shape: ${moduleName}`
        })
      }
      parameters[key] = value
    }
    if (
      !forumParameterShapes.some(
        (shape) =>
          shape.size === Object.keys(parameters).length &&
          Object.keys(parameters).every((parameter) => shape.has(parameter))
      )
    ) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
    }
    if (
      moduleName === "forum/ForumCommentsListModule" &&
      parameters.order !== undefined &&
      parameters.order !== "reverse" &&
      parameters.order !== "forwards"
    ) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
    }
    if (!forumNumericParametersAreCanonical(parameters)) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
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
      const body = {
        status: output.status,
        body: output.body,
        ...responseMetadata(),
        jsInclude: output.js_include ?? [],
        ...(output.thread_id === undefined ? {} : { threadId: output.thread_id })
      }
      return jsonResponse(body)
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
    if (CONTROL_FIELDS.has(key)) continue
    if (!LIST_PAGES_PARAMETERS.has(key.toLowerCase())) {
      return jsonResponse({
        status: "not_ok",
        message: `Unsupported AJAX module shape: ${moduleName}`
      })
    }
    parameters[key] = value
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
