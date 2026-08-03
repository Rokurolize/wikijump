import { handlePageDetailRpc } from "./page-detail-handler.js"
import { handlePageLookupRpc } from "./page-lookup-handler.js"
import { handlePageQueryRpc } from "./page-query-handler.js"

/**
 * @param {{
 *   rpcRequest: any
 *   request: import("node:http").IncomingMessage
 * }} input
 */
export const handlePageReadRpc = (input) => {
  return (
    handlePageDetailRpc(input) ?? handlePageLookupRpc(input) ?? handlePageQueryRpc(input)
  )
}
