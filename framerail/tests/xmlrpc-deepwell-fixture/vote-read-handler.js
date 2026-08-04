import { fixtureState, hasExactKeys, pageById, requestContextHeaders } from "./context.js"

/**
 * @param {{
 *   rpcRequest: any
 *   request: import("node:http").IncomingMessage
 * }} input
 */
export const handleVoteReadRpc = ({ rpcRequest, request }) => {
  if (
    rpcRequest.method !== "vote_list" ||
    !hasExactKeys(rpcRequest.params, [
      "deleted",
      "disabled",
      "id",
      "limit",
      "start_id",
      "type"
    ]) ||
    rpcRequest.params.type !== "Page" ||
    typeof rpcRequest.params.id !== "number" ||
    !pageById(rpcRequest.params.id) ||
    rpcRequest.params.deleted !== false ||
    rpcRequest.params.disabled !== false ||
    rpcRequest.params.start_id !== 0 ||
    rpcRequest.params.limit !== 100 ||
    request.headers["x-deepwell-site-id"] !== "6000005"
  ) {
    return undefined
  }

  fixtureState.pageReadRequests.voteList.push({
    headers: requestContextHeaders(request),
    params: rpcRequest.params
  })
  return { result: [] }
}
