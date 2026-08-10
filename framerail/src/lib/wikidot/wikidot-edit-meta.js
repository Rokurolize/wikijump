const EDIT_META_MODULE = "edit/EditMetaModule"

/**
 * @param {unknown} value
 * @returns {{ status: string; body?: unknown }}
 */
const requireOkResponse = (value) => {
  if (
    !value ||
    typeof value !== "object" ||
    !("status" in value) ||
    value.status !== "ok"
  ) {
    throw new Error("Edit Meta request failed.")
  }
  return /** @type {{ status: string; body?: unknown }} */ (value)
}

/**
 * The legacy response is parsed in inert documents. Its inline handlers are
 * never inserted into the displayed page.
 *
 * @param {string} body
 * @param {typeof DOMParser} [Parser]
 */
export const parseWikidotEditMetaRows = (body, Parser = DOMParser) => {
  const document = new Parser().parseFromString(body, "text/html")
  return [...document.querySelectorAll('div[style="padding-left:3em;"] > div')].map(
    (row) => {
      const encodedMeta = row.textContent?.replace(/^\s*remove\s*/u, "") ?? ""
      const metaDocument = new Parser().parseFromString(encodedMeta, "text/html")
      const meta = metaDocument.querySelector("meta[name][content]")
      if (!meta) throw new Error("Edit Meta response row is malformed.")
      return {
        name: meta.getAttribute("name") ?? "",
        content: meta.getAttribute("content") ?? "",
        all_pages: /\(all pages\)\s*$/u.test(encodedMeta)
      }
    }
  )
}

/** @param {typeof fetch} fetchImplementation @param {URLSearchParams} fields */
const requestEditMeta = async (fetchImplementation, fields) => {
  const response = await fetchImplementation("/ajax-module-connector.php", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: fields.toString()
  })
  return requireOkResponse(await response.json())
}

/** @param {typeof fetch} fetchImplementation @param {number} pageId */
export const loadWikidotEditMetaRows = async (fetchImplementation, pageId) => {
  const response = await requestEditMeta(
    fetchImplementation,
    new URLSearchParams({ moduleName: EDIT_META_MODULE, pageId: String(pageId) })
  )
  if (typeof response.body !== "string") {
    throw new Error("Edit Meta response body is malformed.")
  }
  return parseWikidotEditMetaRows(response.body)
}

/**
 * @param {typeof fetch} fetchImplementation
 * @param {{ pageId: number; name: string; content: string; allPages: boolean }} input
 */
export const saveWikidotMetaTag = (fetchImplementation, input) =>
  requestEditMeta(
    fetchImplementation,
    new URLSearchParams({
      action: "WikiPageAction",
      event: "saveMetaTag",
      pageId: String(input.pageId),
      metaName: input.name,
      metaContent: input.content,
      ...(input.allPages ? { allPages: "true" } : {}),
      moduleName: EDIT_META_MODULE
    })
  )

/**
 * @param {typeof fetch} fetchImplementation
 * @param {{ pageId: number; name: string; allPages: boolean }} input
 */
export const deleteWikidotMetaTag = (fetchImplementation, input) =>
  requestEditMeta(
    fetchImplementation,
    new URLSearchParams({
      action: "WikiPageAction",
      event: "deleteMetaTag",
      pageId: String(input.pageId),
      metaName: input.name,
      ...(input.allPages ? { allPages: "true" } : {}),
      moduleName: EDIT_META_MODULE
    })
  )
