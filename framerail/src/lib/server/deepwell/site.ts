import { client } from "$lib/server/deepwell"
import { NEW_SITE_DEFAULT_LICENSE } from "$lib/server/load/page/page-newsite-validation.js"
import { canonicalSitemapOrigin } from "$lib/server/sitemap"

import type { RequestContext } from "$lib/server/request-context"

export interface NewSiteCreateInput {
  slug: string
  name: string
  tagline: string
  locale: string
}

export interface NewSiteCreateOutcome {
  site_id: number
  site_user_id: number
  slug: string
}

/**
 * Call the already-registered `site_create` service for a validated www
 * new-site submission. The creator comes from the authenticated session in
 * the request context; this payload carries no actor identity.
 */
/**
 * Resolve a site's canonical HTTPS origin through the deployment's own
 * domain source of truth (the same `site_domain` RPC the sitemap uses), so
 * cross-site links never duplicate host-assembly rules.
 */
export async function siteOrigin(
  siteId: number,
  context: RequestContext = {}
): Promise<string> {
  const authority: string = await client.request("site_domain", [siteId], context)
  return canonicalSitemapOrigin(authority)
}

export async function siteCreate(
  input: NewSiteCreateInput,
  ipAddress: string,
  context: RequestContext = {}
): Promise<NewSiteCreateOutcome> {
  return client.request(
    "site_create",
    {
      slug: input.slug,
      name: input.name,
      tagline: input.tagline,
      description: "",
      default_page: null,
      layout: null,
      license: NEW_SITE_DEFAULT_LICENSE,
      locale: input.locale,
      ip_address: ipAddress
    },
    context
  )
}
