import type { IncomingMessage } from "node:http"

import { fixtureState, hasExactKeys, pageById, requestContextHeaders } from "./context.ts"
import { pages, parentBySlug } from "./data.ts"
import { sendRpcError } from "./response.ts"

export const handleParentWriteRpc = ({
  rpcRequest,
  request,
  response
}: {
  rpcRequest: any
  request: IncomingMessage
  response: import("node:http").ServerResponse
}) => {
  const { counters, pageWriteRequests } = fixtureState
  if (
    rpcRequest.method === "parent_update" &&
    fixtureState.propertiesFailure?.step === "parent"
  ) {
    const failure = fixtureState.propertiesFailure
    fixtureState.propertiesFailure = null
    pageWriteRequests.parentUpdate.push({
      headers: requestContextHeaders(request),
      params: rpcRequest.params
    })
    sendRpcError(response, rpcRequest.id, failure.code, "Fixture page-tree move failure")
    return { responded: true }
  }

  let result
  const parentGetPageReference = rpcRequest.params?.page
  const parentGetPage =
    typeof parentGetPageReference === "number"
      ? Object.values(pages).find((page) => page.page_id === parentGetPageReference)
      : pages[parentGetPageReference]

  if (
    rpcRequest.method === "parent_get_all" &&
    hasExactKeys(rpcRequest.params, ["page", "site_id"]) &&
    rpcRequest.params.site_id === 6000005 &&
    parentGetPage &&
    request.headers["x-deepwell-session-token"] === "fixture-session-token" &&
    request.headers["x-deepwell-site-id"] === "6000005" &&
    request.headers["x-deepwell-page"] === parentGetPage.slug
  ) {
    pageWriteRequests.parentGetAll.push({
      headers: requestContextHeaders(request),
      params: rpcRequest.params
    })
    result = parentBySlug[parentGetPage.slug] ? [parentBySlug[parentGetPage.slug]] : []
  } else if (
    rpcRequest.method === "parent_update" &&
    rpcRequest.params.site_id === 6000005 &&
    (typeof rpcRequest.params.child === "string" ||
      typeof rpcRequest.params.child === "number") &&
    request.headers["x-deepwell-session-token"] === "fixture-session-token" &&
    request.headers["x-deepwell-site-id"] === "6000005" &&
    request.headers["x-deepwell-page"] ===
      (typeof rpcRequest.params.child === "number"
        ? pageById(rpcRequest.params.child)?.slug
        : rpcRequest.params.child)
  ) {
    const childSlug =
      typeof rpcRequest.params.child === "number"
        ? pageById(rpcRequest.params.child)?.slug
        : rpcRequest.params.child
    if (!childSlug) return undefined
    pageWriteRequests.parentUpdate.push({
      headers: requestContextHeaders(request),
      params: rpcRequest.params
    })
    if ((rpcRequest.params.add ?? []).includes("missing:parent")) {
      sendRpcError(response, rpcRequest.id, 2007, "Fixture parent page does not exist")
      return { responded: true }
    }
    if (Array.isArray(rpcRequest.params.add) && rpcRequest.params.add.length > 0) {
      parentBySlug[childSlug] = rpcRequest.params.add[0]
    }
    if (Array.isArray(rpcRequest.params.remove)) {
      for (const parent of rpcRequest.params.remove) {
        if (parentBySlug[childSlug] === parent) {
          delete parentBySlug[childSlug]
        }
      }
    }
    result = { added: [], removed: [] }
  } else if (
    rpcRequest.method === "page_move" &&
    rpcRequest.params.site_id === 6000005 &&
    typeof rpcRequest.params.page === "string" &&
    pages[rpcRequest.params.page] &&
    typeof rpcRequest.params.new_slug === "string" &&
    request.headers["x-deepwell-session-token"] === "fixture-session-token" &&
    request.headers["x-deepwell-site-id"] === "6000005" &&
    request.headers["x-deepwell-page"] === rpcRequest.params.page
  ) {
    pageWriteRequests.pageMove.push({
      headers: requestContextHeaders(request),
      params: rpcRequest.params
    })
    const page = pages[rpcRequest.params.page]
    delete pages[rpcRequest.params.page]
    page.slug = rpcRequest.params.new_slug
    page.revision_id = counters.nextRevisionId++
    page.page_revision_count += 1
    pages[page.slug] = page
    if (parentBySlug[rpcRequest.params.page]) {
      parentBySlug[page.slug] = parentBySlug[rpcRequest.params.page]
      delete parentBySlug[rpcRequest.params.page]
    }
    result = { new_slug: page.slug, old_slug: rpcRequest.params.page }
  } else {
    return undefined
  }

  return { result }
}
