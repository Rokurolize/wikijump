import type { Nullable, SiteModel } from "$lib/types"
import { siteIconRedirectLocation } from "./site-icon-source.ts"

/** Wikidot serves a site's configured favicon from this fixed route. */
export const FAVICON_ROUTE_PREFIX = "/local--favicon/"

/** Fixed icon routes must be revalidated after site settings change. */
export const SITE_ICON_CACHE_CONTROL = "no-store"

/** Wikidot serves a site's configured iOS icons from this fixed route. */
export const IOS_ICON_ROUTE_PREFIX = "/local--iosicon/"

/** Wikidot serves a site's configured Windows 8 tile from this fixed route. */
export const WINDOWS_TILE_ROUTE_PREFIX = "/local--wp8icon/"

/** The single Windows 8 tile filename Wikidot declares in the page head. */
export const WINDOWS_TILE_FILENAME = "wp8icon.png"

/**
 * The iOS icon filenames Wikidot derives from one uploaded icon, paired
 * with the `sizes` attribute it declares for each. The first has no
 * `sizes`.
 */
export const IOS_ICON_DECLARATIONS: { filename: string; sizes: Nullable<string> }[] = [
  { filename: "iosicon_57.png", sizes: null },
  { filename: "iosicon_72.png", sizes: "72x72" },
  { filename: "iosicon.png", sizes: "114x114" }
]

/**
 * MIME types for the icon extensions this declaration path supports.
 *
 * An unmapped extension declares nothing rather than guessing a type,
 * since the declaration carries the type attribute Wikidot emits.
 */
const FAVICON_MIME_TYPES: Record<string, string> = {
  gif: "image/gif",
  ico: "image/x-icon",
  png: "image/png"
}

export interface FaviconDeclaration {
  href: string
  type: string
}

function extensionOf(source: string): Nullable<string> {
  const withoutQuery = source.split(/[?#]/, 1)[0]
  const lastDot = withoutQuery.lastIndexOf(".")
  if (lastDot < 0 || lastDot === withoutQuery.length - 1) return null
  return withoutQuery.slice(lastDot + 1).toLowerCase()
}

/**
 * The favicon route and MIME type for a site, or null when it has no
 * usable configured icon.
 *
 * The href keeps Wikidot's local route shape rather than the configured
 * source, because that is what the live page declares regardless of
 * whether the icon was uploaded or linked.
 */
export function faviconDeclaration(
  site: Nullable<SiteModel>
): Nullable<FaviconDeclaration> {
  if (!site) return null
  const source = siteIconRedirectLocation(site, site.favicon_source, "favicon")
  if (source === null) return null

  const extension = extensionOf(source)
  if (!extension) return null

  if (!FAVICON_MIME_TYPES[extension]) return null

  return { href: `${FAVICON_ROUTE_PREFIX}favicon.gif`, type: "image/gif" }
}

/** Whether a site declares Wikidot's iOS touch icons. */
export function hasIosIcons(site: Nullable<SiteModel>): boolean {
  return (
    site !== null && siteIconRedirectLocation(site, site.ios_icon_source, "ios") !== null
  )
}

export interface WindowsTileDeclaration {
  href: string
}

/**
 * The Windows 8 tile declaration for a site, or null when it has no
 * usable configured tile.
 *
 * The href keeps Wikidot's local route shape rather than the configured
 * source, because that is what the live page declares regardless of
 * whether the tile was uploaded or linked.
 */
export function windowsTileDeclaration(
  site: Nullable<SiteModel>
): Nullable<WindowsTileDeclaration> {
  if (!site) return null
  if (siteIconRedirectLocation(site, site.windows_tile_source, "windows") === null) {
    return null
  }
  return { href: `${WINDOWS_TILE_ROUTE_PREFIX}${WINDOWS_TILE_FILENAME}` }
}
