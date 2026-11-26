import { client } from "$lib/server/deepwell"

import type { RequestContext } from "$lib/server/request-context"

export interface SiteCloneOutcome {
  site_id: number
  site_user_id: number
  slug: string
  page_count: number
  revision_count: number
  file_count: number
}

export async function siteClone(
  sourceSiteId: number,
  slug: string,
  ipAddress: string,
  context: RequestContext = {}
): Promise<SiteCloneOutcome> {
  return client.request(
    "site_clone",
    { source: sourceSiteId, slug, ip_address: ipAddress },
    context
  )
}
