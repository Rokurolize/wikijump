import { fixtureState, hasExactKeys, pageById } from "./context.js"
import { pages, toPageResult } from "./data.js"

/**
 * @param {{
 *   rpcRequest: any
 *   request: import("node:http").IncomingMessage
 * }} input
 */
export const handlePageLookupRpc = ({ rpcRequest, request }) => {
  const { pageReadRequests } = fixtureState
  let result

  const pageReference = rpcRequest.params?.page
  const isStringPageViewPermission =
    typeof pageReference === "string" &&
    request.headers["x-deepwell-site-id"] === "6000005" &&
    request.headers["x-deepwell-page"] === pageReference &&
    (request.headers["x-deepwell-session-token"] === undefined ||
      request.headers["x-deepwell-session-token"] === "fixture-session-token")
  const isXmlRpcParentViewPermission =
    typeof pageReference === "number" &&
    request.headers["x-deepwell-session-token"] === "fixture-session-token"

  if (
    rpcRequest.method === "page_view_permission" &&
    hasExactKeys(rpcRequest.params, ["page", "site_id"]) &&
    rpcRequest.params.site_id === 6000005 &&
    (isStringPageViewPermission || isXmlRpcParentViewPermission)
  ) {
    if (isXmlRpcParentViewPermission) {
      pageReadRequests.pageViewPermission.push({
        headers: {
          sessionToken: request.headers["x-deepwell-session-token"]
        },
        params: rpcRequest.params
      })
    }
    const page =
      typeof pageReference === "number" ? pageById(pageReference) : pages[pageReference]
    result = page !== undefined && page !== null && page.slug !== "private-page"
  } else if (
    rpcRequest.method === "page_get" &&
    hasExactKeys(rpcRequest.params, ["details", "page", "site_id"]) &&
    rpcRequest.params.site_id === 6000005 &&
    typeof rpcRequest.params.page === "string" &&
    hasExactKeys(rpcRequest.params.details, ["compiled_html", "wikitext"]) &&
    typeof rpcRequest.params.details.compiled_html === "boolean" &&
    typeof rpcRequest.params.details.wikitext === "boolean"
  ) {
    pageReadRequests.pageGet.push(rpcRequest.params)
    result = toPageResult(
      pages[rpcRequest.params.page] ?? null,
      rpcRequest.params.details
    )
  } else if (
    rpcRequest.method === "page_get_direct" &&
    hasExactKeys(rpcRequest.params, ["allow_deleted", "details", "page_id", "site_id"]) &&
    rpcRequest.params.site_id === 6000005 &&
    pageById(rpcRequest.params.page_id) &&
    rpcRequest.params.allow_deleted === false &&
    hasExactKeys(rpcRequest.params.details, ["compiled_html", "wikitext"]) &&
    rpcRequest.params.details.compiled_html === false &&
    rpcRequest.params.details.wikitext === false
  ) {
    pageReadRequests.pageGetDirect.push(rpcRequest.params)
    result = toPageResult(pageById(rpcRequest.params.page_id), rpcRequest.params.details)
  } else if (
    rpcRequest.method === "page_revision_range" &&
    hasExactKeys(rpcRequest.params, [
      "limit",
      "page_id",
      "revision_direction",
      "revision_number",
      "site_id"
    ]) &&
    rpcRequest.params.site_id === 6000005 &&
    pageById(rpcRequest.params.page_id) &&
    rpcRequest.params.revision_direction === "before" &&
    typeof rpcRequest.params.revision_number === "number" &&
    typeof rpcRequest.params.limit === "number"
  ) {
    result = []
  } else if (
    rpcRequest.method === "page_revision_get" &&
    hasExactKeys(rpcRequest.params, [
      "details",
      "page_id",
      "revision_number",
      "site_id"
    ]) &&
    rpcRequest.params.site_id === 6000005 &&
    pageById(rpcRequest.params.page_id) &&
    rpcRequest.params.revision_number === 0 &&
    hasExactKeys(rpcRequest.params.details, ["compiled_html", "wikitext"]) &&
    rpcRequest.params.details.compiled_html === false &&
    rpcRequest.params.details.wikitext === false
  ) {
    pageReadRequests.pageRevisionGet.push(rpcRequest.params)
    result = {
      revision_number: 0,
      user_id: pageById(rpcRequest.params.page_id)?.creator_user_id
    }
  } else {
    return undefined
  }

  return { result }
}
