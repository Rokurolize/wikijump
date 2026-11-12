const SITE_ID_HEADER = "X-Wikijump-Site-Id"
const SITE_SLUG_HEADER = "X-Wikijump-Site-Slug"

export interface SiteInfo {
  siteId: number
  siteSlug: string
}

function getHeader(headers: Headers, key: string): string {
  const value = headers.get(key)
  if (value === null) {
    throw new Error(`Missing wws internal header '${key}'`)
  }

  return value
}

export function loadSiteInfo(headers: Headers): SiteInfo {
  const siteSlug = getHeader(headers, SITE_SLUG_HEADER)
  const siteId = Number(getHeader(headers, SITE_ID_HEADER))

  // A malformed site ID would otherwise reach every site-scoped RPC as
  // NaN, so reject it the same way the article fast path does.
  if (!Number.isInteger(siteId) || siteId <= 0) {
    throw new Error(`Invalid wws internal header '${SITE_ID_HEADER}'`)
  }

  return { siteId, siteSlug }
}
