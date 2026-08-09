import { client } from "$lib/server/deepwell"

import type { RequestContext } from "../request-context"

export interface WikidotForumModuleOutput {
  status: string
  body: string
}

export function wikidotForumModule(
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
