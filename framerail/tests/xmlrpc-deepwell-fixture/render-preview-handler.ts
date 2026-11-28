import { fixtureState, hasExactKeys, requestContextHeaders } from "./context.ts"
import { renderFixtureWikitext } from "./render-fixture.ts"

export const handleWikidotPagePreviewRpc = ({
  rpcRequest,
  request
}: {
  rpcRequest: any
  request: import("node:http").IncomingMessage
}) => {
  if (
    rpcRequest.method !== "wikidot_page_preview" ||
    !hasExactKeys(rpcRequest.params, ["site_id", "title", "wikitext", "syntax_only"]) ||
    typeof rpcRequest.params.site_id !== "number" ||
    typeof rpcRequest.params.title !== "string" ||
    typeof rpcRequest.params.wikitext !== "string" ||
    typeof rpcRequest.params.syntax_only !== "boolean"
  ) {
    return undefined
  }

  fixtureState.pagePreviewRequests.push({
    headers: requestContextHeaders(request),
    params: rpcRequest.params
  })
  return {
    result: {
      body: renderFixtureWikitext(rpcRequest.params.wikitext),
      styles: [],
      legacy_actions: [],
      membership_actions: []
    }
  }
}
