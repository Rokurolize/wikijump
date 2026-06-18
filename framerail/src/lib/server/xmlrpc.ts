import { Buffer } from "node:buffer"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

import { client } from "$lib/server/deepwell"

type XmlRpcScalar = string | number | boolean | null
export type XmlRpcValue = XmlRpcScalar | XmlRpcValue[] | { [key: string]: XmlRpcValue }

interface XmlRpcCall {
  methodName: string
  params: XmlRpcValue[]
}

interface XmlElement {
  content: string
  end: number
  selfClosing: boolean
}

interface BasicAuthCredentials {
  username: string
  password: string
}

interface MethodDefinition {
  help: string
  signatures: string[][]
}

interface DeepwellCategory {
  slug: string
}

interface DeepwellSite {
  site_id: number
}

interface DeepwellPage {
  page_id: number
  revision_id: number
  page_created_at: string
  page_updated_at: string | null
  page_revision_count: number
  revision_created_at: string
  revision_user_id: number
  title: string
  slug: string
  tags: string[]
  rating: number
  wikitext?: string | null
  compiled_body_html?: string | null
}

interface DeepwellLoginOutput {
  session_token: string
}

interface DeepwellBlobUpload {
  pending_blob_id: string
  presign_url: string
}

interface DeepwellFile {
  file_id: number
  file_created_at: string
  file_updated_at: string | null
  revision_id: number
  revision_created_at: string
  revision_user_id: number
  name: string
  data?: number[] | string | null
  mime: string
  size: number
  revision_comments: string
}

type DeepwellStringParams = {
  [key: string]: string | string[] | undefined
}

const XML_RPC_WRITE_USER_ID = -1
const XML_RPC_WRITE_IP_ADDRESS = "127.0.0.1"

const XML_RPC_HEADERS = {
  "content-type": "text/xml; charset=utf-8"
}

const METHOD_DEFINITIONS: Record<string, MethodDefinition> = {
  "system.listMethods": {
    help: "List XML-RPC methods exposed by this Wikijump endpoint.",
    signatures: [["array"]]
  },
  "system.methodHelp": {
    help: "Return help text for an XML-RPC method.",
    signatures: [["string", "string"]]
  },
  "system.methodSignature": {
    help: "Return XML-RPC signature metadata for a method.",
    signatures: [["array", "string"]]
  },
  "system.multicall": {
    help: "Execute multiple XML-RPC calls and return per-call results or faults.",
    signatures: [["array", "array"]]
  },
  "categories.select": {
    help: "Select categories from a Wikidot-compatible site.",
    signatures: [["array", "struct"]]
  },
  "tags.select": {
    help: "Select tags from a Wikidot-compatible site.",
    signatures: [["array", "struct"]]
  },
  "pages.select": {
    help: "Select pages from a Wikidot-compatible site.",
    signatures: [["array", "struct"]]
  },
  "pages.get_meta": {
    help: "Fetch metadata for a batch of Wikidot-compatible pages.",
    signatures: [["struct", "struct"]]
  },
  "pages.get_one": {
    help: "Fetch one Wikidot-compatible page.",
    signatures: [["struct", "struct"]]
  },
  "pages.save_one": {
    help: "Create or update one Wikidot-compatible page.",
    signatures: [["struct", "struct"]]
  },
  "files.select": {
    help: "Select files attached to a Wikidot-compatible page.",
    signatures: [["array", "struct"]]
  },
  "files.get_meta": {
    help: "Fetch metadata for Wikidot-compatible page files.",
    signatures: [["struct", "struct"]]
  },
  "files.get_one": {
    help: "Fetch one Wikidot-compatible page file.",
    signatures: [["struct", "struct"]]
  },
  "files.save_one": {
    help: "Create or update one Wikidot-compatible page file.",
    signatures: [["struct", "struct"]]
  },
  "users.get_me": {
    help: "Return the authenticated Wikidot-compatible API user.",
    signatures: [["struct"]]
  },
  "posts.select": {
    help: "Select Wikidot-compatible forum posts.",
    signatures: [["array", "struct"]]
  },
  "posts.get": {
    help: "Fetch one Wikidot-compatible forum post.",
    signatures: [["struct", "struct"]]
  }
}

const METHOD_NAMES = Object.keys(METHOD_DEFINITIONS)

class XmlRpcFault extends Error {
  constructor(
    readonly faultCode: number,
    readonly faultString: string,
    readonly httpStatus = 200,
    readonly headers: Record<string, string> = {}
  ) {
    super(faultString)
  }
}

export async function handleXmlRpcRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return faultResponse(new XmlRpcFault(405, "XML-RPC endpoint requires POST", 405))
  }

  const auth = parseBasicAuth(request.headers.get("authorization"))
  if (!auth) {
    return faultResponse(
      new XmlRpcFault(401, "Missing or invalid HTTP Basic authentication", 401, {
        "www-authenticate": 'Basic realm="Wikijump XML-RPC"'
      })
    )
  }

  try {
    const call = parseXmlRpcCall(await request.text())
    const result = await dispatchXmlRpcCall(call, auth)
    return xmlResponse(serializeMethodResponse(result))
  } catch (error) {
    if (error instanceof XmlRpcFault) {
      return faultResponse(error)
    }

    return faultResponse(new XmlRpcFault(-32700, "Malformed XML-RPC request"))
  }
}

async function dispatchXmlRpcCall(
  call: XmlRpcCall,
  auth: BasicAuthCredentials,
  options = { allowMulticall: true }
): Promise<XmlRpcValue> {
  switch (call.methodName) {
    case "system.listMethods":
      return METHOD_NAMES
    case "system.methodHelp":
      return getMethodDefinition(getStringParam(call, 0, "methodName")).help
    case "system.methodSignature":
      return getMethodDefinition(getStringParam(call, 0, "methodName")).signatures
    case "system.multicall":
      if (!options.allowMulticall) {
        throw new XmlRpcFault(-32600, "Nested system.multicall calls are not supported")
      }
      return dispatchMulticall(call, auth)
    case "categories.select":
      return selectCategories(call)
    case "tags.select":
      return selectTags(call)
    case "pages.select":
      return selectPages(call)
    case "pages.get_meta":
      return getPagesMeta(call)
    case "pages.get_one":
      return getPageOne(call)
    case "pages.save_one":
      return savePageOne(call, auth)
    case "files.select":
      return selectFiles(call)
    case "files.get_meta":
      return getFilesMeta(call)
    case "files.get_one":
      return getFileOne(call)
    case "files.save_one":
      return saveFileOne(call, auth)
    default:
      if (METHOD_DEFINITIONS[call.methodName]) {
        throw new XmlRpcFault(
          -32601,
          `XML-RPC method is not implemented yet: ${call.methodName}`
        )
      }

      throw new XmlRpcFault(-32601, `Unsupported XML-RPC method: ${call.methodName}`)
  }
}

async function dispatchMulticall(
  call: XmlRpcCall,
  auth: BasicAuthCredentials
): Promise<XmlRpcValue[]> {
  const calls = getArrayParam(call, 0, "calls")
  const results: XmlRpcValue[] = []

  for (const child of calls) {
    try {
      if (!isXmlRpcStruct(child)) {
        throw new XmlRpcFault(-32602, "Each system.multicall entry must be a struct")
      }

      const methodName = child.methodName
      const params = child.params ?? []
      if (typeof methodName !== "string") {
        throw new XmlRpcFault(-32602, "Each system.multicall entry needs a methodName")
      }
      if (!Array.isArray(params)) {
        throw new XmlRpcFault(-32602, "system.multicall params must be an array")
      }

      const value = await dispatchXmlRpcCall({ methodName, params }, auth, {
        allowMulticall: false
      })
      results.push([value])
    } catch (error) {
      const fault =
        error instanceof XmlRpcFault
          ? error
          : new XmlRpcFault(-32603, "system.multicall child call failed")
      results.push({
        faultCode: fault.faultCode,
        faultString: fault.faultString
      })
    }
  }

  return results
}

async function selectCategories(call: XmlRpcCall): Promise<string[]> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const categories = (await client.request("category_get_all", {
    site
  })) as DeepwellCategory[]

  return categories.map((category) => category.slug)
}

async function selectTags(call: XmlRpcCall): Promise<string[]> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const categories = getOptionalStructStringArray(params, "categories")
  const pages = getOptionalStructStringArray(params, "pages")

  if (pages && pages.length > 10) {
    throw new XmlRpcFault(-32602, "tags.select pages is limited to 10 entries")
  }

  const deepwellParams: {
    site: string
    categories?: string[]
    pages?: string[]
  } = { site }
  if (categories) {
    deepwellParams.categories = categories
  }
  if (pages) {
    deepwellParams.pages = pages
  }

  return (await client.request("page_tags_select", deepwellParams)) as string[]
}

async function selectPages(call: XmlRpcCall): Promise<string[]> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const deepwellParams: DeepwellStringParams & {
    site: string
    pagetype?: string
    categories?: string[]
    tags_any?: string[]
    tags_all?: string[]
    tags_none?: string[]
    parent?: string
    created_by?: string
    rating?: string
    order?: string
  } = { site }

  addOptionalStringField(deepwellParams, params, "pagetype")
  addOptionalStringArrayField(deepwellParams, params, "categories")
  addOptionalStringArrayField(deepwellParams, params, "tags_any")
  addOptionalStringArrayField(deepwellParams, params, "tags_all")
  addOptionalStringArrayField(deepwellParams, params, "tags_none")
  addOptionalStringField(deepwellParams, params, "parent")
  addOptionalStringField(deepwellParams, params, "created_by")
  addOptionalStringField(deepwellParams, params, "rating")
  addOptionalStringField(deepwellParams, params, "order")

  return (await client.request("page_select", deepwellParams)) as string[]
}

async function getPagesMeta(call: XmlRpcCall): Promise<{ [key: string]: XmlRpcValue }> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const pages = getRequiredStructStringArray(params, "pages")

  if (pages.length > 10) {
    throw new XmlRpcFault(-32602, "pages.get_meta pages is limited to 10 entries")
  }
  if (pages.length === 0) {
    return {}
  }

  const siteId = await getDeepwellSiteId(site)
  const entries = await Promise.all(
    pages.map(async (pageReference): Promise<[string, XmlRpcValue] | null> => {
      const page = await getDeepwellPage(siteId, pageReference, false)
      if (!page) {
        return null
      }

      const parentFullname = await getDeepwellParentFullname(siteId, page.slug)
      return [page.slug, buildXmlRpcPageMeta(page, parentFullname)]
    })
  )

  return Object.fromEntries(
    entries.filter((entry): entry is [string, XmlRpcValue] => entry !== null)
  )
}

async function getPageOne(call: XmlRpcCall): Promise<{ [key: string]: XmlRpcValue }> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const pageReference = getRequiredStructString(params, "page")
  const siteId = await getDeepwellSiteId(site)

  return buildXmlRpcPage(site, siteId, pageReference)
}

async function savePageOne(
  call: XmlRpcCall,
  auth: BasicAuthCredentials
): Promise<{ [key: string]: XmlRpcValue }> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const pageReference = getRequiredStructString(params, "page")
  const title = getOptionalStructString(params, "title")
  const content = getOptionalStructString(params, "content")
  const tags = getOptionalStructStringArray(params, "tags")
  const parentFullname = getOptionalStructString(params, "parent_fullname")
  const saveMode = getOptionalStructString(params, "save_mode") ?? "create_or_update"
  const renameAs = getOptionalStructString(params, "rename_as")
  const revisionComment =
    getOptionalStructString(params, "revision_comment") ?? "XML-RPC page save"

  if (!["create", "update", "create_or_update"].includes(saveMode)) {
    throw new XmlRpcFault(-32602, `Unsupported pages.save_one save_mode: ${saveMode}`)
  }

  const siteId = await getDeepwellSiteId(site)
  let page = await getDeepwellPage(siteId, pageReference, true)
  const writeContext = await getXmlRpcWriteContext(
    auth,
    siteId,
    page?.slug ?? pageReference
  )

  if (saveMode === "create" && page) {
    throw new XmlRpcFault(409, "Argument page invalid: page already exists")
  }
  if (saveMode === "update" && !page) {
    throw new XmlRpcFault(406, "Argument page invalid: page does not exist")
  }

  if (!page) {
    await requestDeepwell(
      "page_create",
      {
        site_id: siteId,
        wikitext: content ?? "",
        title: title ?? pageReference,
        alt_title: null,
        slug: pageReference,
        layout: "wikidot",
        revision_comments: revisionComment,
        user_id: XML_RPC_WRITE_USER_ID,
        ip_address: XML_RPC_WRITE_IP_ADDRESS,
        bypass_filter: true
      },
      writeContext
    )
    page = await requireDeepwellPage(siteId, pageReference, true)
  }

  const editBody: { wikitext?: string; title?: string; tags?: string[] } = {}
  if (content !== null) {
    editBody.wikitext = content
  }
  if (title !== null) {
    editBody.title = title
  }
  if (tags !== null) {
    editBody.tags = tags
  }

  if (Object.keys(editBody).length > 0) {
    await requestDeepwell(
      "page_edit",
      {
        site_id: siteId,
        page: page.slug,
        last_revision_id: page.revision_id,
        revision_comments: revisionComment,
        user_id: XML_RPC_WRITE_USER_ID,
        ip_address: XML_RPC_WRITE_IP_ADDRESS,
        ...editBody
      },
      { ...writeContext, page: page.slug }
    )
    page = await requireDeepwellPage(siteId, page.slug, true)
  }

  if (parentFullname !== null) {
    await replaceDeepwellParents(siteId, page.slug, parentFullname, writeContext)
  }

  let finalPageReference = page.slug
  if (renameAs !== null && renameAs !== page.slug) {
    await requestDeepwell(
      "page_move",
      {
        site_id: siteId,
        page: page.slug,
        last_revision_id: page.revision_id,
        new_slug: renameAs,
        revision_comments: revisionComment,
        user_id: XML_RPC_WRITE_USER_ID,
        ip_address: XML_RPC_WRITE_IP_ADDRESS
      },
      { ...writeContext, page: page.slug }
    )
    finalPageReference = renameAs
  }

  return buildXmlRpcPage(site, siteId, finalPageReference)
}

async function selectFiles(call: XmlRpcCall): Promise<string[]> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const pageReference = getRequiredStructString(params, "page")
  const siteId = await getDeepwellSiteId(site)
  const page = await requireDeepwellPage(siteId, pageReference, false)
  const files = await getDeepwellPageFiles(siteId, page.page_id)

  return files.map((file) => file.name)
}

async function getFilesMeta(call: XmlRpcCall): Promise<{ [key: string]: XmlRpcValue }> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const pageReference = getRequiredStructString(params, "page")
  const files = getRequiredStructStringArray(params, "files")

  if (files.length > 10) {
    throw new XmlRpcFault(-32602, "files.get_meta files is limited to 10 entries")
  }
  if (files.length === 0) {
    return {}
  }

  const siteId = await getDeepwellSiteId(site)
  const page = await requireDeepwellPage(siteId, pageReference, false)
  const entries = await Promise.all(
    files.map(async (fileName): Promise<[string, XmlRpcValue] | null> => {
      const file = await getDeepwellFile(siteId, page.page_id, fileName, false)
      return file ? [file.name, buildXmlRpcFileMeta(site, page.slug, file)] : null
    })
  )

  return Object.fromEntries(
    entries.filter((entry): entry is [string, XmlRpcValue] => entry !== null)
  )
}

async function getFileOne(call: XmlRpcCall): Promise<{ [key: string]: XmlRpcValue }> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const pageReference = getRequiredStructString(params, "page")
  const fileName = getRequiredStructString(params, "file")
  const siteId = await getDeepwellSiteId(site)
  const page = await requireDeepwellPage(siteId, pageReference, false)
  const file = await getDeepwellFile(siteId, page.page_id, fileName, true)
  if (!file) {
    throw new XmlRpcFault(406, "Argument file invalid: file does not exist")
  }

  return {
    ...buildXmlRpcFileMeta(site, page.slug, file),
    content: deepwellFileContentBase64(file)
  }
}

async function saveFileOne(
  call: XmlRpcCall,
  auth: BasicAuthCredentials
): Promise<{ [key: string]: XmlRpcValue }> {
  const params = getStructParam(call, 0, "params")
  const site = getRequiredStructString(params, "site")
  const pageReference = getRequiredStructString(params, "page")
  const fileName = getRequiredStructString(params, "file")
  const content = getRequiredStructString(params, "content")
  const comment = getOptionalStructString(params, "comment") ?? ""
  const saveMode = getOptionalStructString(params, "save_mode") ?? "create_or_update"
  const revisionComment =
    getOptionalStructString(params, "revision_comment") ?? "XML-RPC file save"

  if (!["create", "update", "create_or_update"].includes(saveMode)) {
    throw new XmlRpcFault(-32602, `Unsupported files.save_one save_mode: ${saveMode}`)
  }

  const siteId = await getDeepwellSiteId(site)
  const page = await requireDeepwellPage(siteId, pageReference, false)
  const writeContext = await getXmlRpcWriteContext(auth, siteId, page.slug)
  const existing = await getDeepwellFile(siteId, page.page_id, fileName, false)

  if (saveMode === "create" && existing) {
    throw new XmlRpcFault(409, "Argument file invalid: file already exists")
  }
  if (saveMode === "update" && !existing) {
    throw new XmlRpcFault(406, "Argument file invalid: file does not exist")
  }

  const contentBytes = Buffer.from(content, "base64")
  const pendingBlobId = await uploadXmlRpcFileContent(contentBytes)

  if (existing) {
    await requestDeepwell(
      "file_edit",
      {
        site_id: siteId,
        page_id: page.page_id,
        user_id: XML_RPC_WRITE_USER_ID,
        file_id: existing.file_id,
        last_revision_id: existing.revision_id,
        uploaded_blob_id: pendingBlobId,
        revision_comments: comment || revisionComment,
        bypass_filter: true
      },
      writeContext
    )
  } else {
    await requestDeepwell(
      "file_create",
      {
        site_id: siteId,
        page_id: page.page_id,
        user_id: XML_RPC_WRITE_USER_ID,
        name: fileName,
        uploaded_blob_id: pendingBlobId,
        revision_comments: comment || revisionComment,
        bypass_filter: true
      },
      writeContext
    )
  }

  const saved = await getDeepwellFile(siteId, page.page_id, fileName, false)
  if (!saved) {
    throw new XmlRpcFault(406, "Argument file invalid: file does not exist")
  }
  return buildXmlRpcFileMeta(site, page.slug, saved)
}

async function buildXmlRpcPage(
  site: string,
  siteId: number,
  pageReference: string
): Promise<{ [key: string]: XmlRpcValue }> {
  const page = await getDeepwellPage(siteId, pageReference, true)
  if (!page) {
    throw new XmlRpcFault(406, "Argument page invalid: page does not exist")
  }

  const parentFullname = await getDeepwellParentFullname(siteId, page.slug)
  const parentTitle = parentFullname
    ? ((await getDeepwellPage(siteId, parentFullname, false))?.title ?? null)
    : null
  const children = await client.request("page_select", {
    site,
    parent: page.slug
  })

  return {
    ...buildXmlRpcPageMeta(page, parentFullname),
    parent_title: parentTitle,
    children: Array.isArray(children) ? children.length : 0,
    content: page.wikitext ?? "",
    html: page.compiled_body_html ?? "",
    comments: 0,
    commented_at: null,
    commented_by: null
  }
}

async function getDeepwellSiteId(site: string): Promise<number> {
  const deepwellSite = (await client.request("site_get", { site })) as DeepwellSite
  return deepwellSite.site_id
}

async function uploadXmlRpcFileContent(content: Buffer): Promise<string> {
  const upload = (await requestDeepwell("blob_upload", {
    user_id: XML_RPC_WRITE_USER_ID,
    blob_size: content.length
  })) as DeepwellBlobUpload

  await putPresignedBlob(upload.presign_url, content)
  return upload.pending_blob_id
}

async function putPresignedBlob(url: string, content: Buffer): Promise<void> {
  const signed = new URL(url)
  const target = localPresignConnectBase(signed) ?? signed
  const requestUrl = new URL(
    `${target.protocol}//${target.host}${signed.pathname}${signed.search}`
  )
  const transport = requestUrl.protocol === "https:" ? httpsRequest : httpRequest

  await new Promise<void>((resolve, reject) => {
    const request = transport(
      requestUrl,
      {
        method: "PUT",
        headers: {
          Host: signed.host,
          "Content-Length": String(content.length)
        }
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => {
          if (
            response.statusCode &&
            response.statusCode >= 200 &&
            response.statusCode < 300
          ) {
            resolve()
            return
          }

          const body = Buffer.concat(chunks).toString("utf8")
          reject(
            new Error(
              `Blob upload failed: HTTP ${response.statusCode} connect=${requestUrl.origin} signed_host=${signed.host} ${body.slice(0, 500)}`
            )
          )
        })
      }
    )

    request.setTimeout(30_000, () => {
      request.destroy(
        new Error(
          `Blob upload timed out: connect=${requestUrl.origin} signed_host=${signed.host}`
        )
      )
    })
    request.on("error", (error) => reject(error))
    request.end(content)
  }).catch((error) => {
    throw new XmlRpcFault(-32603, deepwellErrorMessage(error))
  })
}

function localPresignConnectBase(url: URL): URL | null {
  if (url.hostname !== "files") {
    return null
  }
  return new URL(`http://127.0.0.1:${url.port || "9000"}`)
}

async function getXmlRpcWriteContext(
  auth: BasicAuthCredentials,
  siteId: number,
  page: string
): Promise<{ sessionToken: string; siteId: number; page: string }> {
  const login = (await requestDeepwell("login", {
    name_or_email: auth.username,
    password: auth.password,
    ip_address: XML_RPC_WRITE_IP_ADDRESS,
    user_agent: "wikijump-xmlrpc-api/0.1"
  })) as DeepwellLoginOutput

  return {
    sessionToken: login.session_token,
    siteId,
    page
  }
}

async function requestDeepwell(
  method: string,
  params: unknown,
  context?: { sessionToken?: string; siteId?: number; page?: string }
): Promise<unknown> {
  try {
    return await client.request(method, params, context)
  } catch (error) {
    throw new XmlRpcFault(-32603, deepwellErrorMessage(error))
  }
}

function deepwellErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Deepwell request failed"
}

async function getDeepwellPage(
  siteId: number,
  page: string,
  includeBody: boolean
): Promise<DeepwellPage | null> {
  return (await client.request("page_get", {
    site_id: siteId,
    page,
    details: {
      wikitext: includeBody,
      compiled_html: includeBody
    }
  })) as DeepwellPage | null
}

async function requireDeepwellPage(
  siteId: number,
  page: string,
  includeBody: boolean
): Promise<DeepwellPage> {
  const deepwellPage = await getDeepwellPage(siteId, page, includeBody)
  if (!deepwellPage) {
    throw new XmlRpcFault(406, "Argument page invalid: page does not exist")
  }
  return deepwellPage
}

async function getDeepwellPageFiles(
  siteId: number,
  pageId: number
): Promise<DeepwellFile[]> {
  return (await client.request("page_get_files", {
    site_id: siteId,
    page_id: pageId,
    deleted: false
  })) as DeepwellFile[]
}

async function getDeepwellFile(
  siteId: number,
  pageId: number,
  file: string,
  includeData: boolean
): Promise<DeepwellFile | null> {
  return (await client.request("file_get", {
    site_id: siteId,
    page_id: pageId,
    file,
    details: {
      data: includeData
    }
  })) as DeepwellFile | null
}

async function getDeepwellParentFullname(
  siteId: number,
  page: string
): Promise<string | null> {
  const parents = await getDeepwellParents(siteId, page)
  return parents[0] ?? null
}

async function getDeepwellParents(siteId: number, page: string): Promise<string[]> {
  const parents = (await client.request("parent_get_all", {
    site_id: siteId,
    page
  })) as string[]

  return parents
}

async function replaceDeepwellParents(
  siteId: number,
  page: string,
  parentFullname: string,
  context: { sessionToken?: string; siteId?: number; page?: string }
): Promise<void> {
  const parents = await getDeepwellParents(siteId, page)
  const remove =
    parentFullname === "-"
      ? parents
      : parents.filter((parent) => parent !== parentFullname)
  const add =
    parentFullname === "-" || parents.includes(parentFullname) ? [] : [parentFullname]

  if (add.length === 0 && remove.length === 0) {
    return
  }

  await requestDeepwell(
    "parent_update",
    {
      site_id: siteId,
      child: page,
      add: add.length > 0 ? add : undefined,
      remove: remove.length > 0 ? remove : undefined
    },
    { ...context, page }
  )
}

function buildXmlRpcPageMeta(
  page: DeepwellPage,
  parentFullname: string | null
): { [key: string]: XmlRpcValue } {
  const userId = String(page.revision_user_id)

  return {
    fullname: page.slug,
    title: page.title,
    created_at: page.page_created_at,
    created_by: userId,
    updated_at: page.page_updated_at ?? page.revision_created_at ?? page.page_created_at,
    updated_by: userId,
    parent_fullname: parentFullname,
    tags: page.tags,
    rating: Math.round(page.rating),
    revisions: page.page_revision_count,
    comments: 0,
    commented_at: null,
    commented_by: null
  }
}

function buildXmlRpcFileMeta(
  site: string,
  page: string,
  file: DeepwellFile
): { [key: string]: XmlRpcValue } {
  return {
    size: file.size,
    comment: file.revision_comments,
    mime_type: file.mime,
    mime_description: file.mime,
    uploaded_by: String(file.revision_user_id),
    uploaded_at: file.revision_created_at,
    download_url: `/local--files/${site}/${page}/${encodeURIComponent(file.name)}`
  }
}

function deepwellFileContentBase64(file: DeepwellFile): string {
  if (file.data === null || file.data === undefined) {
    return ""
  }
  if (typeof file.data === "string") {
    return Buffer.from(file.data, "hex").toString("base64")
  }
  return Buffer.from(file.data).toString("base64")
}

function getMethodDefinition(methodName: string): MethodDefinition {
  const definition = METHOD_DEFINITIONS[methodName]
  if (!definition) {
    throw new XmlRpcFault(-32601, `Unsupported XML-RPC method: ${methodName}`)
  }
  return definition
}

function getStringParam(call: XmlRpcCall, index: number, name: string): string {
  const value = call.params[index]
  if (typeof value !== "string") {
    throw new XmlRpcFault(-32602, `Expected string parameter: ${name}`)
  }
  return value
}

function getStructParam(
  call: XmlRpcCall,
  index: number,
  name: string
): { [key: string]: XmlRpcValue } {
  const value = call.params[index]
  if (!isXmlRpcStruct(value)) {
    throw new XmlRpcFault(-32602, `Expected struct parameter: ${name}`)
  }
  return value
}

function getRequiredStructString(
  params: { [key: string]: XmlRpcValue },
  name: string
): string {
  const value = params[name]
  if (typeof value !== "string" || value.length === 0) {
    throw new XmlRpcFault(-32602, `Expected string field: ${name}`)
  }
  return value
}

function getRequiredStructStringArray(
  params: { [key: string]: XmlRpcValue },
  name: string
): string[] {
  const value = getOptionalStructStringArray(params, name)
  if (value === null) {
    throw new XmlRpcFault(-32602, `Expected string array field: ${name}`)
  }
  return value
}

function getOptionalStructStringArray(
  params: { [key: string]: XmlRpcValue },
  name: string
): string[] | null {
  const value = params[name]
  if (value === undefined || value === null) {
    return null
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new XmlRpcFault(-32602, `Expected string array field: ${name}`)
  }
  return value.filter((entry): entry is string => typeof entry === "string")
}

function getOptionalStructString(
  params: { [key: string]: XmlRpcValue },
  name: string
): string | null {
  const value = params[name]
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== "string") {
    throw new XmlRpcFault(-32602, `Expected string field: ${name}`)
  }
  return value
}

function addOptionalStringField(
  target: DeepwellStringParams,
  params: { [key: string]: XmlRpcValue },
  name: string
): void {
  const value = getOptionalStructString(params, name)
  if (value !== null) {
    target[name] = value
  }
}

function addOptionalStringArrayField(
  target: DeepwellStringParams,
  params: { [key: string]: XmlRpcValue },
  name: string
): void {
  const value = getOptionalStructStringArray(params, name)
  if (value !== null) {
    target[name] = value
  }
}

function getArrayParam(call: XmlRpcCall, index: number, name: string): XmlRpcValue[] {
  const value = call.params[index]
  if (!Array.isArray(value)) {
    throw new XmlRpcFault(-32602, `Expected array parameter: ${name}`)
  }
  return value
}

function isXmlRpcStruct(value: XmlRpcValue): value is { [key: string]: XmlRpcValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseBasicAuth(header: string | null): BasicAuthCredentials | null {
  if (!header?.startsWith("Basic ")) {
    return null
  }

  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8")
    const separator = decoded.indexOf(":")
    if (separator <= 0 || separator === decoded.length - 1) {
      return null
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    }
  } catch (_) {
    return null
  }
}

function parseXmlRpcCall(xml: string): XmlRpcCall {
  const normalized = stripIgnorableXml(xml)
  const methodCall = extractRequiredElement(normalized, "methodCall")
  const methodName = decodeXmlText(
    extractRequiredElement(methodCall.content, "methodName").content
  ).trim()
  if (methodName.length === 0) {
    throw new XmlRpcFault(-32600, "XML-RPC methodName must not be empty")
  }

  const paramsElement = extractOptionalElement(methodCall.content, "params")
  if (!paramsElement || paramsElement.selfClosing) {
    return { methodName, params: [] }
  }

  const params: XmlRpcValue[] = []
  let offset = 0
  while (true) {
    const param = extractOptionalElement(paramsElement.content, "param", offset)
    if (!param) {
      break
    }

    const value = extractRequiredElement(param.content, "value")
    params.push(parseXmlRpcValue(value.content))
    offset = param.end
  }

  return { methodName, params }
}

function parseXmlRpcValue(valueContent: string): XmlRpcValue {
  const text = valueContent.trim()
  if (!text.startsWith("<")) {
    return decodeXmlText(text)
  }

  if (isSelfClosingElement(text, "nil")) {
    return null
  }

  const stringElement = extractFirstDirectElement(text, "string")
  if (stringElement) {
    return decodeXmlText(stringElement.content)
  }

  const intElement =
    extractFirstDirectElement(text, "int") ?? extractFirstDirectElement(text, "i4")
  if (intElement) {
    const value = Number.parseInt(decodeXmlText(intElement.content).trim(), 10)
    if (!Number.isFinite(value)) {
      throw new XmlRpcFault(-32602, "Invalid XML-RPC integer value")
    }
    return value
  }

  const booleanElement = extractFirstDirectElement(text, "boolean")
  if (booleanElement) {
    const value = decodeXmlText(booleanElement.content).trim()
    if (value === "1") return true
    if (value === "0") return false
    throw new XmlRpcFault(-32602, "Invalid XML-RPC boolean value")
  }

  const doubleElement = extractFirstDirectElement(text, "double")
  if (doubleElement) {
    const value = Number.parseFloat(decodeXmlText(doubleElement.content).trim())
    if (!Number.isFinite(value)) {
      throw new XmlRpcFault(-32602, "Invalid XML-RPC double value")
    }
    return value
  }

  const base64Element = extractFirstDirectElement(text, "base64")
  if (base64Element) {
    return decodeXmlText(base64Element.content).trim()
  }

  const dateElement = extractFirstDirectElement(text, "dateTime.iso8601")
  if (dateElement) {
    return decodeXmlText(dateElement.content).trim()
  }

  const arrayElement = extractFirstDirectElement(text, "array")
  if (arrayElement) {
    const dataElement = extractRequiredElement(arrayElement.content, "data")
    const values: XmlRpcValue[] = []
    let offset = 0
    while (true) {
      const item = extractOptionalElement(dataElement.content, "value", offset)
      if (!item) {
        break
      }
      values.push(parseXmlRpcValue(item.content))
      offset = item.end
    }
    return values
  }

  const structElement = extractFirstDirectElement(text, "struct")
  if (structElement) {
    const values: { [key: string]: XmlRpcValue } = {}
    let offset = 0
    while (true) {
      const member = extractOptionalElement(structElement.content, "member", offset)
      if (!member) {
        break
      }

      const name = decodeXmlText(extractRequiredElement(member.content, "name").content)
      const value = extractRequiredElement(member.content, "value")
      values[name] = parseXmlRpcValue(value.content)
      offset = member.end
    }
    return values
  }

  throw new XmlRpcFault(-32602, "Unsupported XML-RPC value type")
}

function extractFirstDirectElement(text: string, tagName: string): XmlElement | null {
  const trimmed = text.trim()
  const element = extractOptionalElement(trimmed, tagName)
  if (!element) {
    return null
  }

  const prefix = trimmed.slice(0, trimmed.indexOf(`<${tagName}`)).trim()
  return prefix.length === 0 ? element : null
}

function extractRequiredElement(text: string, tagName: string, offset = 0): XmlElement {
  const element = extractOptionalElement(text, tagName, offset)
  if (!element) {
    throw new XmlRpcFault(-32600, `Missing XML-RPC <${tagName}> element`)
  }
  return element
}

function extractOptionalElement(
  text: string,
  tagName: string,
  offset = 0
): XmlElement | null {
  const openPattern = new RegExp(
    `<${escapeRegExp(tagName)}(?:\\s[^>]*)?>|<${escapeRegExp(tagName)}\\s*/>`,
    "g"
  )
  openPattern.lastIndex = offset
  const match = openPattern.exec(text)
  if (!match) {
    return null
  }

  const opening = match[0]
  const contentStart = match.index + opening.length
  if (opening.endsWith("/>")) {
    return { content: "", end: contentStart, selfClosing: true }
  }

  const tagPattern = new RegExp(
    `</?${escapeRegExp(tagName)}(?:\\s[^>]*)?>|<${escapeRegExp(tagName)}\\s*/>`,
    "g"
  )
  tagPattern.lastIndex = contentStart
  let depth = 1

  while (true) {
    const tagMatch = tagPattern.exec(text)
    if (!tagMatch) {
      throw new XmlRpcFault(-32600, `Unclosed XML-RPC <${tagName}> element`)
    }

    const tag = tagMatch[0]
    if (tag.startsWith(`</${tagName}`)) {
      depth -= 1
      if (depth === 0) {
        return {
          content: text.slice(contentStart, tagMatch.index),
          end: tagPattern.lastIndex,
          selfClosing: false
        }
      }
    } else if (!tag.endsWith("/>")) {
      depth += 1
    }
  }
}

function isSelfClosingElement(text: string, tagName: string): boolean {
  return new RegExp(`^<${escapeRegExp(tagName)}\\s*/>$`).test(text)
}

function stripIgnorableXml(xml: string): string {
  return xml
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
}

function serializeMethodResponse(value: XmlRpcValue): string {
  return xmlDocument(
    `<methodResponse><params><param>${serializeValue(value)}</param></params></methodResponse>`
  )
}

function serializeFault(fault: XmlRpcFault): string {
  return xmlDocument(
    `<methodResponse><fault>${serializeValue({
      faultCode: fault.faultCode,
      faultString: fault.faultString
    })}</fault></methodResponse>`
  )
}

function serializeValue(value: XmlRpcValue): string {
  if (value === null) {
    return "<value><nil /></value>"
  }

  if (Array.isArray(value)) {
    return `<value><array><data>${value.map(serializeValue).join("")}</data></array></value>`
  }

  switch (typeof value) {
    case "string":
      return `<value><string>${escapeXmlText(value)}</string></value>`
    case "number":
      if (Number.isInteger(value)) {
        return `<value><int>${value}</int></value>`
      }
      return `<value><double>${value}</double></value>`
    case "boolean":
      return `<value><boolean>${value ? "1" : "0"}</boolean></value>`
    case "object":
      return `<value><struct>${Object.entries(value)
        .map(
          ([key, memberValue]) =>
            `<member><name>${escapeXmlText(key)}</name>${serializeValue(memberValue)}</member>`
        )
        .join("")}</struct></value>`
  }
}

function faultResponse(fault: XmlRpcFault): Response {
  return xmlResponse(serializeFault(fault), fault.httpStatus, fault.headers)
}

function xmlResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: {
      ...XML_RPC_HEADERS,
      ...headers
    }
  })
}

function xmlDocument(body: string): string {
  return `<?xml version="1.0"?>${body}`
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
