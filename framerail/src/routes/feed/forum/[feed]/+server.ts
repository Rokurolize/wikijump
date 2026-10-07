import { wikidotForumFeedHeaders, buildWikidotForumFeedXml } from "$lib/server/forum-feed"
import { wikidotForumFeed } from "$lib/server/deepwell/forum"
import { loadSiteInfo } from "$lib/server/load/site-info"

import type { WikidotForumFeedKind } from "$lib/server/forum-feed"
import type { RequestHandler } from "./$types"

export const GET: RequestHandler = async ({ request, params, cookies }) => {
  const kind: WikidotForumFeedKind | null =
    params.feed === "threads.xml" ? "threads" :
      params.feed === "posts.xml" ? "posts" : null
  if (!kind) return new Response("Not found", { status: 404 })

  const { siteId } = loadSiteInfo(request.headers)
  const output = await wikidotForumFeed(siteId, kind, {
    siteId,
    sessionToken: cookies.get("wikijump_token")
  })
  if (!output) return new Response("Not found", { status: 404 })

  return new Response(buildWikidotForumFeedXml(request.url, kind, output), {
    headers: wikidotForumFeedHeaders()
  })
}
