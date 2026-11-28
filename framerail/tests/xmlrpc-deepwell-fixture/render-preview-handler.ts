import { fixtureState, hasExactKeys, requestContextHeaders } from "./context.ts"
import { pages } from "./data.ts"
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
  const contextPage = request.headers["x-deepwell-page"]
  const savedTags =
    typeof contextPage === "string" ? (pages[contextPage]?.tags ?? []) : []
  const styles = rpcRequest.params.wikitext.includes("live-preview-css-probe")
    ? [
        "body { background-color: rgb(12, 34, 56); }",
        ".live-preview-css-target { color: rgb(1, 2, 3); }"
      ]
    : []
  return {
    result: {
      body: renderFixtureWikitext(rpcRequest.params.wikitext, savedTags),
      styles,
      legacy_actions: [],
      membership_actions: []
    }
  }
}
