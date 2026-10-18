// Wikidot-compatible sitemap endpoints (`/sitemap.xml` and
// `/sitemap_page_<n>.xml`).
//
// Current Wikidot publishes a sitemap index at `/sitemap.xml` whose children
// are bounded shard pages shaped like `/sitemap_page_<n>.xml`, and points
// crawlers at the index from the site's `robots.txt`. The entry set behind
// these routes comes from Deepwell's `wikidot_sitemap` method, which already
// filters to pages the viewer may view.

export const SITEMAP_ENTRIES_PER_SHARD = 1_000

export const SITEMAP_XML_HEADERS = {
  "content-type": "text/xml;charset=utf-8"
}

export interface SitemapEntry {
  slug: string
  last_modified: string
}

export class InvalidSitemapShardPath extends Error {}
export class InvalidSitemapEntry extends Error {}
export class InvalidSitemapCanonicalDomain extends Error {}

// The site_domain RPC returns a configured hostname, not an arbitrary URL.
// Keep untrusted request Host headers out of search-engine canonical links.
export function canonicalSitemapOrigin(preferredDomain: string): string {
  const hostname = preferredDomain.split(":")[0]
  if (
    !/^[a-z0-9.-]+(?::[0-9]+)?$/iu.test(preferredDomain) ||
    preferredDomain.startsWith(".") ||
    preferredDomain.endsWith(".") ||
    preferredDomain.includes("..") ||
    hostname
      .split(".")
      .some((label) => label.length === 0 || label.startsWith("-") || label.endsWith("-"))
  ) {
    throw new InvalidSitemapCanonicalDomain("Invalid configured sitemap domain")
  }
  const parsed = new URL(`https://${preferredDomain}`)
  if (parsed.hostname.length === 0 || parsed.username || parsed.password) {
    throw new InvalidSitemapCanonicalDomain("Invalid configured sitemap domain")
  }
  return parsed.origin
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

/// Parses a shard number from a `sitemap_page_<n>.xml` route parameter.
///
/// Shard numbers start at 1, matching the child locations the sitemap index
/// advertises. Anything else is not a sitemap shard.
export function parseSitemapShardNumber(value: string): number {
  if (/^[1-9][0-9]*$/.test(value)) {
    const number = Number(value)
    if (Number.isSafeInteger(number)) return number
  }
  throw new InvalidSitemapShardPath(`Not a sitemap shard number: ${value}`)
}

/// Formats a Deepwell RFC 3339 timestamp as a sitemap `<lastmod>` date.
export function formatSitemapLastmod(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return value.slice(0, 10)
  throw new InvalidSitemapEntry(`Not a sitemap lastmod timestamp: ${value}`)
}

function pageUrl(origin: string, slug: string): string {
  return `${origin}${encodeURI(`/${slug}`)}`
}

/// Builds the `/sitemap.xml` index pointing at each shard page.
export function buildSitemapIndexXml(origin: string, shardCount: number): string {
  const children = []
  for (let shard = 1; shard <= shardCount; shard++) {
    const location = pageUrl(origin, `sitemap_page_${shard}.xml`)
    children.push(`\t<sitemap>\n\t\t<loc>${escapeXml(location)}</loc>\n\t</sitemap>`)
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${children.join("\n")}\n` +
    `</sitemapindex>`
  )
}

/// Builds one `/sitemap_page_<n>.xml` shard from its slice of entries.
export function buildSitemapUrlsetXml(origin: string, entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const location = pageUrl(origin, entry.slug)
    const lastmod = formatSitemapLastmod(entry.last_modified)
    return (
      `\t<url>\n` +
      `\t\t<loc>${escapeXml(location)}</loc>\n` +
      `\t\t<lastmod>${escapeXml(lastmod)}</lastmod>\n` +
      `\t</url>`
    )
  })
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls.join("\n")}\n` +
    `</urlset>`
  )
}
