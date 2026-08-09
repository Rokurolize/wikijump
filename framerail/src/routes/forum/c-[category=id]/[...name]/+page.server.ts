import { wikidotForumModule } from "$lib/server/deepwell/forum"
import { loadSiteInfo } from "$lib/server/load/site-info"

import type { PageServerLoad } from "./$types"

const MISSING_CATEGORY =
  '<div class="error-block">Requested forum category does not exist.</div>'

export const load: PageServerLoad = async ({ params, request, cookies }) => {
  const { siteId } = loadSiteInfo(request.headers)
  const result = await wikidotForumModule(
    siteId,
    "forum/ForumViewCategoryModule",
    { c: params.category, p: "1" },
    {
      siteId,
      sessionToken: cookies.get("wikijump_token")
    }
  )
  return {
    body: result.status === "ok" ? result.body : MISSING_CATEGORY
  }
}
