import { fixtureState, requestContextHeaders } from "./context.ts"

const draftKey = (params: any) =>
  [
    params.site_id,
    params.user_id,
    params.page_id === undefined || params.page_id === null
      ? `slug:${params.slug}`
      : `page:${params.page_id}`
  ].join(":")

const hasFixtureDraftContext = (request: import("node:http").IncomingMessage) =>
  request.headers["x-deepwell-session-token"] === "fixture-session-token" &&
  request.headers["x-deepwell-site-id"] === "6000005"

const draftResult = (draft: (typeof fixtureState.pageDrafts)[string] | undefined) =>
  draft === undefined
    ? null
    : {
        slug: draft.slug,
        title: draft.title,
        wikitext: draft.wikitext,
        comments: draft.comments
      }

export const handlePageDraftRpc = ({
  rpcRequest,
  request
}: {
  rpcRequest: any
  request: import("node:http").IncomingMessage
}) => {
  if (!hasFixtureDraftContext(request)) return undefined
  const params = rpcRequest.params ?? {}
  if (rpcRequest.method === "site_tools_list_drafts") {
    return {
      result: Object.values(fixtureState.pageDrafts)
        .filter((draft) => draft.site_id === params.site_id)
        .map((draft) => ({ slug: draft.slug, title: draft.title }))
    }
  }

  if (
    typeof params.site_id !== "number" ||
    typeof params.user_id !== "number" ||
    typeof params.slug !== "string"
  ) {
    return undefined
  }

  const key = draftKey(params)

  if (rpcRequest.method === "page_draft_save") {
    if (typeof params.title !== "string" || typeof params.wikitext !== "string") {
      return undefined
    }
    fixtureState.pageWriteRequests.pageDraftSave.push({
      headers: requestContextHeaders(request),
      params
    })
    fixtureState.pageDrafts[key] = {
      site_id: params.site_id,
      user_id: params.user_id,
      page_id: params.page_id ?? null,
      slug: params.slug,
      title: params.title,
      wikitext: params.wikitext,
      comments: typeof params.comments === "string" ? params.comments : ""
    }
    return { result: null }
  }

  if (rpcRequest.method === "page_draft_get") {
    return { result: draftResult(fixtureState.pageDrafts[key]) }
  }

  if (rpcRequest.method === "page_draft_exists") {
    return { result: fixtureState.pageDrafts[key] !== undefined }
  }

  if (rpcRequest.method === "page_draft_remove") {
    fixtureState.pageWriteRequests.pageDraftRemove.push({
      headers: requestContextHeaders(request),
      params
    })
    delete fixtureState.pageDrafts[key]
    return { result: true }
  }

  return undefined
}
