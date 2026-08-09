import { wikidotForumModule } from "$lib/server/deepwell/forum"
import { loadSiteInfo } from "$lib/server/load/site-info"

import type { PageServerLoad } from "./$types"

const MISSING_THREAD =
  '<div class="error-block">The thread you\'re trying to show seems to have been deleted</div>'

export const load: PageServerLoad = async ({ params, request, cookies }) => {
  const { siteId } = loadSiteInfo(request.headers)
  const requestContext = {
    siteId,
    sessionToken: cookies.get("wikijump_token")
  }
  const thread = await wikidotForumModule(
    siteId,
    "forum/ForumViewThreadModule",
    { t: params.thread },
    requestContext
  )
  if (thread.status !== "ok") return { body: MISSING_THREAD }

  const posts = await wikidotForumModule(
    siteId,
    "forum/ForumViewThreadPostsModule",
    { t: params.thread, pageNo: "1" },
    requestContext
  )
  return {
    body: posts.status === "ok" ? thread.body + posts.body : MISSING_THREAD
  }
}
