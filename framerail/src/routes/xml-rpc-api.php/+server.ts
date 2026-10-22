import { crossSitePostResponse } from "$lib/server/cross-site-post"
import { handleXmlRpcRequest } from "$lib/server/xmlrpc"

import type { RequestHandler } from "./$types"

export const POST: RequestHandler = ({ request, getClientAddress }) => {
  const forbidden = crossSitePostResponse(request)
  if (forbidden) return forbidden

  return handleXmlRpcRequest(request, getClientAddress())
}
