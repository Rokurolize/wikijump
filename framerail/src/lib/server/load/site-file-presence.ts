import { pageGet } from "$lib/server/deepwell/page"
import { pageFileList } from "$lib/server/deepwell/page-file"
import {
  SITE_FILE_PRESENCE_SEPARATOR,
  extractCssAssetUrls,
  parseSiteFileReference,
  siteFilePresenceKey
} from "$lib/site-settings.js"

import type { RequestContext } from "../request-context"

/**
 * A theme asset's referenced page file: the page slug and file name parsed
 * from its `/local--files/<page>/<name>` path.
 */
export interface SiteFileReference {
  page: string
  name: string
}

/**
 * Collect the distinct same-site file references named by a page theme's
 * asset URLs: the external theme href, or the raw URLs inside stored
 * custom CSS. Only references the head could rewrite are collected; every
 * other URL stays literal downstream without a lookup.
 *
 * @param theme The page view's theme setting, if any.
 * @param site The viewed site (`slug` and `from_wikidot`).
 */
export function collectThemeSiteFileReferences(
  theme: unknown,
  site: { slug?: unknown; from_wikidot?: unknown } | null
): SiteFileReference[] {
  const urls: string[] = []
  if (typeof theme === "object" && theme !== null) {
    const candidate = theme as { type?: unknown; url?: unknown; css?: unknown }
    if (candidate.type === "external" && typeof candidate.url === "string") {
      urls.push(candidate.url)
    } else if (candidate.type === "custom" && typeof candidate.css === "string") {
      urls.push(...extractCssAssetUrls(candidate.css))
    }
  }
  const seen = new Set<string>()
  const references: SiteFileReference[] = []
  for (const url of urls) {
    const reference = parseSiteFileReference(url, site)
    if (!reference) continue
    const key = siteFilePresenceKey(reference.page, reference.name)
    if (key === null || seen.has(key)) continue
    seen.add(key)
    references.push({ page: reference.page, name: reference.name })
  }
  return references
}

/**
 * Request-scoped memo of per-page local file names. One loader creates one
 * cache per page view so repeated references to the same page cost a
 * single file listing; nothing is shared across requests, so an import
 * that lands mid-request cannot serve stale presence to a later view.
 */
export interface SiteFilePresenceCache {
  pages: Map<string, Promise<ReadonlySet<string>>>
}

export const createSiteFilePresenceCache = (): SiteFilePresenceCache => ({
  pages: new Map()
})

const cacheKey = (siteId: number, page: string): string =>
  `${siteId}${SITE_FILE_PRESENCE_SEPARATOR}${page}`

/**
 * List one page's live local file names, or the empty set when the page is
 * missing, unreadable, or its listing fails. Unknown means absent
 * downstream: the head keeps the source URL literal.
 */
async function lookupLocalFileNames(
  siteId: number,
  page: string,
  requestContext: RequestContext | undefined,
  cache: SiteFilePresenceCache | undefined
): Promise<ReadonlySet<string>> {
  const key = cacheKey(siteId, page)
  const cached = cache?.pages.get(key)
  if (cached) return cached
  const pending = (async (): Promise<ReadonlySet<string>> => {
    try {
      const viewed = (await pageGet(siteId, page, requestContext)) as {
        page_id?: unknown
      } | null
      const pageId = viewed?.page_id
      if (typeof pageId !== "number" || !Number.isSafeInteger(pageId)) return new Set()
      const files = await pageFileList(siteId, pageId, false, requestContext)
      return new Set(files.map((file) => file.name))
    } catch {
      return new Set<string>()
    }
  })()
  cache?.pages.set(key, pending)
  return pending
}

/**
 * Resolve which referenced page files exist locally, as presence-set keys
 * (`page + separator + name`). References whose page is missing or whose
 * listing fails are omitted: the rewrite treats absent and unknown alike
 * as literal. One file listing runs per distinct page at most.
 */
export async function resolveSiteFilePresence(
  references: readonly SiteFileReference[],
  options: {
    siteId: number
    requestContext?: RequestContext
    cache?: SiteFilePresenceCache
  }
): Promise<Set<string>> {
  const { siteId, requestContext, cache } = options
  const present = new Set<string>()
  const byPage = new Map<string, SiteFileReference[]>()
  for (const reference of references) {
    const group = byPage.get(reference.page)
    if (group) group.push(reference)
    else byPage.set(reference.page, [reference])
  }
  await Promise.all(
    [...byPage].map(async ([page, group]) => {
      const names = await lookupLocalFileNames(siteId, page, requestContext, cache)
      for (const reference of group) {
        if (!names.has(reference.name)) continue
        const key = siteFilePresenceKey(reference.page, reference.name)
        if (key !== null) present.add(key)
      }
    })
  )
  return present
}
