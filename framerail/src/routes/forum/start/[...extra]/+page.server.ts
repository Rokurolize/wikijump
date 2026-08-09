import { wikidotForumModule } from "$lib/server/deepwell/forum"
import { loadSiteInfo } from "$lib/server/load/site-info"

import type { PageServerLoad } from "./$types"

const INVALID_FORUM_ROUTE = '<div class="error-block">Invalid forum route.</div>'

export const load: PageServerLoad = async ({ params, request, cookies }) => {
  const hidden = params.extra === "hidden/show"
  if (params.extra && !hidden) return { body: INVALID_FORUM_ROUTE }

  const { siteId } = loadSiteInfo(request.headers)
  const result = await wikidotForumModule(
    siteId,
    "forum/ForumStartModule",
    hidden ? { hidden: "true" } : {},
    {
      siteId,
      sessionToken: cookies.get("wikijump_token")
    }
  )
  return {
    body: result.status === "ok" ? result.body : INVALID_FORUM_ROUTE
  }
}
