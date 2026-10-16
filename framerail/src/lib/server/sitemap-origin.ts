import { client } from "$lib/server/deepwell"
import { canonicalSitemapOrigin } from "$lib/server/sitemap"

// Resolve on every crawler request so changing a preferred domain never
// leaves an old origin pinned in an in-process sitemap cache.
export async function siteSitemapOrigin(siteId: number): Promise<string> {
  const preferredDomain: string = await client.request("site_domain", [siteId], { siteId })
  return canonicalSitemapOrigin(preferredDomain)
}
