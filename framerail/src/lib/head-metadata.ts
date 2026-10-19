import type { Nullable, SiteModel } from "$lib/types"

/** One text/social head entry: the `name`/`content` pair of a `<meta>` tag. */
export interface HeadMetaTag {
  name: string
  content: string
}

/** A stored page meta-tag row, as projected by the page head. */
export interface EffectiveHeadMetaTag extends HeadMetaTag {
  all_pages: boolean
}

type HeadFallbackSite = Pick<SiteModel, "description" | "name">

/**
 * The site-field fallbacks for the text/social head contract.
 *
 * The sealed live contract always pairs the site description with the site
 * name, so both entries stay gated on a configured description; a site
 * without one keeps the existing empty head rather than gaining a
 * half-derived tag. Blank values are omitted, never emitted.
 */
export function siteHeadFallbacks(site: Nullable<HeadFallbackSite>): HeadMetaTag[] {
  if (!site || typeof site.description !== "string" || site.description.trim() === "") {
    return []
  }
  return [
    { name: "description", content: site.description },
    { name: "og:site_name", content: site.name }
  ]
}

/**
 * The fallbacks that still apply once stored rows are projected.
 *
 * Stored effective rows (page-over-site precedence is applied upstream)
 * win over a same-named fallback, so the final head never carries
 * duplicate or conflicting entries for one name. The page head renders the
 * effective rows themselves unchanged.
 */
export function unsupersededHeadFallbacks(
  fallbacks: readonly HeadMetaTag[],
  effective: readonly Pick<EffectiveHeadMetaTag, "name">[]
): HeadMetaTag[] {
  const superseded = new Set(effective.map((tag) => tag.name))
  return fallbacks.filter((tag) => !superseded.has(tag.name))
}
