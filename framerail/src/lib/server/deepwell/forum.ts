import { client } from "$lib/server/deepwell"

import type { RequestContext } from "../request-context"

export interface WikidotForumModuleOutput {
  status: string
  body: string
  thread_id?: number
  js_include: string[]
}

export interface ForumPostCreateInput {
  siteId: number
  threadId: number
  parentPostId: number | null
  title: string
  source: string
  guestName?: string
  guestEmailMd5?: string
}

export interface ForumPostCreateOutput {
  forum_post_id: number
}

export async function forumPostCreate(
  input: ForumPostCreateInput,
  requestContext: RequestContext = {}
): Promise<ForumPostCreateOutput> {
  return client.request(
    "forum_post_create",
    {
      site_id: input.siteId,
      forum_thread_id: input.threadId,
      parent_post_id: input.parentPostId,
      title: input.title,
      wikitext: input.source,
      guest_name: input.guestName,
      guest_email_md5: input.guestEmailMd5
    },
    requestContext
  )
}

export async function wikidotForumModule(
  siteId: number,
  moduleName: string,
  parameters: Record<string, string>,
  requestContext: RequestContext = {}
): Promise<WikidotForumModuleOutput> {
  return client.request(
    "wikidot_forum_module",
    {
      site_id: siteId,
      module_name: moduleName,
      parameters
    },
    requestContext
  )
}
