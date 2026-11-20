import { client } from "$lib/server/deepwell"

import type { RequestContext } from "$lib/server/request-context"

export interface SiteDomainModel {
  domain: string
  site_id: number
  created_at: string
  www_redirect: boolean
}

export async function siteDomain(
  siteId: number,
  context: RequestContext = {}
): Promise<string> {
  return client.request("site_domain", [siteId], context)
}

export async function customDomainList(
  siteId: number,
  context: RequestContext = {}
): Promise<SiteDomainModel[]> {
  return client.request("custom_domain_list", { site_id: siteId }, context)
}

export async function customDomainCreate(
  siteId: number,
  domain: string,
  wwwRedirect: boolean,
  context: RequestContext = {}
): Promise<void> {
  return client.request(
    "custom_domain_create",
    { site_id: siteId, domain, www_redirect: wwwRedirect },
    context
  )
}

export async function customDomainRemove(
  domain: string,
  context: RequestContext = {}
): Promise<void> {
  return client.request("custom_domain_remove", [domain], context)
}
