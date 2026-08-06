import type { RequestHandler } from "./$types"
import { siteIconResponse } from "$lib/server/site-icon-response"

export const GET: RequestHandler = ({ request }) =>
  siteIconResponse(request, (site) => site.ios_icon_source, "ios")

export const HEAD: RequestHandler = ({ request }) =>
  siteIconResponse(request, (site) => site.ios_icon_source, "ios")
