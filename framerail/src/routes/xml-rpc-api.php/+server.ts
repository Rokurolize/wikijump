import { handleXmlRpcRequest } from "$lib/server/xmlrpc"

import type { RequestHandler } from "./$types"

export const POST: RequestHandler = ({ request, getClientAddress }) =>
  handleXmlRpcRequest(request, getClientAddress())

export const GET: RequestHandler = ({ request, getClientAddress }) =>
  handleXmlRpcRequest(request, getClientAddress())

export const HEAD: RequestHandler = ({ request, getClientAddress }) =>
  handleXmlRpcRequest(request, getClientAddress())
