const GOOGLE_ANALYTICS_PROFILE = /^UA-[0-9]+-[0-9]+$(?![\s\S])/u

export const isGoogleAnalyticsProfile = (value) =>
  typeof value === "string" && GOOGLE_ANALYTICS_PROFILE.test(value)

/** @typedef {import("./types").ThemeSetting} ThemeSetting */

export const normalizeGoogleAnalyticsSettings = (settings) => ({
  enabled: settings?.enabled === true,
  profile: isGoogleAnalyticsProfile(settings?.profile) ? settings.profile : null
})

export const googleAnalyticsQueueScript = (settings) => {
  const normalized = normalizeGoogleAnalyticsSettings(settings)
  if (!normalized.enabled || normalized.profile === null) return ""

  return [
    `_gaq.push(['userTracker._setAccount', '${normalized.profile}']);`,
    "_gaq.push(['userTracker._trackPageview']);"
  ].join("\n")
}

export const googleAnalyticsHeadHtml = (settings) => {
  const queue = googleAnalyticsQueueScript(settings)
  if (!queue) return ""
  return `<script>globalThis._gaq=globalThis._gaq||[];\n${queue}</script>`
}

/** @type {ThemeSetting} */
const BUILT_IN_THEME = { type: "built_in", id: 1 }
const WIKIDOT_THEME_ASSET_ORIGIN =
  "http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--theme"

/**
 * Ordered common--theme directories served for each persisted built-in
 * theme id, captured from the authenticated live appearance render. The
 * directory list is the authoritative asset set and ordering for the id.
 * Ids 8248876+ are site custom themes (bootstrap-base plus local--theme)
 * and are not built-in themes.
 *
 * @type {Readonly<Record<number, readonly string[]>>}
 */
export const BUILT_IN_THEME_ASSET_DIRS = Object.freeze({
  1: ["base"],
  162746: ["bootstrap-base"],
  6651: ["base", "basic"],
  6258: ["base", "bloo"],
  6650: ["base", "bloo", "bloo-no-side-bar"],
  25: ["base", "cappuccino"],
  26: ["base", "cappuccino", "cappuccino-right"],
  2: ["base", "clean"],
  3: ["base", "clean", "clean-no-side-bar"],
  56: ["base", "co"],
  121: ["base", "co", "co-no-side-bar"],
  5: ["base", "flannel"],
  9: ["base", "flannel-nature"],
  10: ["base", "flannel-nature", "flannel-nature-no-side-bar"],
  6: ["base", "flannel", "flannel-no-side-bar"],
  7: ["base", "flannel-ocean"],
  8: ["base", "flannel-ocean", "flannel-ocean-no-side-bar"],
  57: ["base", "flower-blossom"],
  75: ["base", "flower-blossom", "flower-blossom-no-side-bar"],
  54: ["base", "gila"],
  55: ["base", "gila", "gila-no-side-bar"],
  58: ["base", "localize"],
  59: ["base", "localize", "localize-no-side-bar"],
  2439: ["base", "shiny"],
  2440: ["base", "shiny", "shiny-no-side-bar"],
  2437: ["base", "webbish2"],
  2438: ["base", "webbish2", "webbish2-no-side-bar"],
  122: ["base", "webbish"],
  123: ["base", "webbish", "webbish-no-side-bar"]
})
const EXTERNAL_THEME_HOSTS = new Set([
  "cdn.scpwiki.com",
  "d3g0gp89917ko0.cloudfront.net",
  "fonts.bunny.net",
  "fonts.googleapis.com",
  "maxcdn.bootstrapcdn.com",
  "nu-scptheme.github.io",
  "rsms.me",
  "scp-wiki-cdn.nyc3.cdn.digitaloceanspaces.com"
])

// S755_EXTERNAL_RESOURCE_FAILURE_POLICY: admission only; the browser owns redirects, timeouts, MIME, and transfer-size failures, with no server fetch or stale fallback.
const isAllowedExternalThemeUrl = (url) =>
  url.protocol === "https:" &&
  url.port === "" &&
  !url.username &&
  !url.password &&
  (EXTERNAL_THEME_HOSTS.has(url.hostname) || url.hostname.endsWith(".wdfiles.com"))

/**
 * @param {{ type?: unknown; id?: unknown; url?: unknown; css?: unknown }
 *   | null
 *   | undefined} theme
 * @returns {ThemeSetting}
 */
export const normalizeThemeSetting = (theme) => {
  if (
    theme?.type === "built_in" &&
    typeof theme.id === "number" &&
    Number.isSafeInteger(theme.id) &&
    theme.id > 0
  ) {
    return { type: "built_in", id: theme.id }
  }
  if (theme?.type === "external" && typeof theme.url === "string") {
    try {
      const url = new URL(theme.url)
      if (isAllowedExternalThemeUrl(url)) {
        return { type: "external", url: url.href }
      }
    } catch {
      return { ...BUILT_IN_THEME }
    }
  }
  if (
    theme?.type === "custom" &&
    typeof theme.css === "string" &&
    theme.css.length <= 65_535 &&
    !theme.css.toLowerCase().includes("</style")
  ) {
    return { type: "custom", css: theme.css }
  }
  return { ...BUILT_IN_THEME }
}

/**
 * Normalize a browser-requested ThemePreviewer stylesheet with the same
 * policy used for stored external themes. Invalid values fail closed so
 * the browser keeps the stored site theme and no server-side stylesheet
 * fetch is needed.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export const normalizeThemePreviewUrl = (value) => {
  const normalized = normalizeThemeSetting({ type: "external", url: value })
  return normalized.type === "external" ? normalized.url : null
}

/**
 * Resolve a browser-requested ThemePreviewer stylesheet only when
 * Deepwell's source-owned PageView sidecar recognizes an executable noUi
 * invocation. This boundary deliberately does not inspect wikitext or
 * compiled HTML.
 *
 * @param {unknown} themePreviewerNoUi
 * @param {unknown} value
 * @returns {string | null}
 */
export const resolveThemePreviewUrl = (themePreviewerNoUi, value) =>
  themePreviewerNoUi === true ? normalizeThemePreviewUrl(value) : null

export const customThemeHeadHtml = (theme, site = null, filesAuthority = null) => {
  const normalized = normalizeThemeSetting(theme)
  if (normalized.type !== "custom") return ""
  const css = localizeSiteFileUrlsInCss(normalized.css, site, filesAuthority)
  return `<style data-wikidot-site-theme>${css}</style>`
}

/**
 * Site carried by the page view, the only local-existence evidence the
 * head may use: an imported site's own files live on its own WDFiles host.
 *
 * @typedef {object} LocalSiteEvidence
 * @property {unknown} slug
 * @property {unknown} from_wikidot
 */

const WDFILES_HOST_SUFFIXES = [".wdfiles.com", ".wikidot.com"]
const SITE_SLUG_PATTERN = /^[a-z0-9-]+$/u
const WIKIDOT_WWW_HOSTS = new Set(["www.wikidot.com", "www.wdfiles.com"])

/**
 * Split an absolute http(s) URL into its lowercased host and the untouched
 * remainder (path, query, fragment), preserving the original encoding
 * byte-for-byte. Protocol-relative URLs are read as https. Returns null
 * for anything that is not a plain same-shape candidate.
 *
 * @param {unknown} rawUrl
 * @returns {{ host: string, rest: string } | null}
 */
const splitAbsoluteHttpUrl = (rawUrl) => {
  if (typeof rawUrl !== "string") return null
  const trimmed = rawUrl.trim()
  if (trimmed === "") return null
  const withoutProtocol = trimmed.startsWith("//")
    ? trimmed.slice(2)
    : trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u, "")
  if (withoutProtocol === trimmed && !trimmed.includes("://")) return null
  const scheme = trimmed.startsWith("//")
    ? "https:"
    : `${trimmed.slice(0, trimmed.indexOf("://")).toLowerCase()}:`
  if (scheme !== "http:" && scheme !== "https:") return null
  const authority = withoutProtocol.split("/", 1)[0]
  // Userinfo and explicit ports never appear on Wikidot file hosts; treat
  // either as a non-candidate rather than guessing intent.
  if (authority === "" || authority.includes("@") || authority.includes(":")) {
    return null
  }
  const host = authority.toLowerCase()
  const rest = withoutProtocol.slice(authority.length)
  if (!rest.startsWith("/")) return null
  return { host, rest }
}

/**
 * The viewed site's own WDFiles slug, or null when the host does not name a
 * site file host. Mirrors the renderer's host-to-slug reading without
 * duplicating its cross-site and lab-mirror branches, which need
 * server-side import topology the page does not carry.
 *
 * @param {string} host
 * @returns {string | null}
 */
const wdfilesAttachmentSiteSlug = (host) => {
  for (const suffix of WDFILES_HOST_SUFFIXES) {
    if (!host.endsWith(suffix)) continue
    const slug = host.slice(0, -suffix.length)
    if (slug !== "" && SITE_SLUG_PATTERN.test(slug)) return slug
  }
  return null
}

/**
 * Whether the viewed imported site is the evidence that a WDFiles
 * attachment URL names a local file: same-site slugs only (G06 www hosts
 * never match). Corpus aliases, translated-branch sharing, and lab
 * mirrors need server-side import topology and stay literal until
 * Deepwell attests them per asset.
 *
 * @param {string} slug
 * @param {LocalSiteEvidence | null | undefined} site
 * @returns {boolean}
 */
const isViewedSiteWdfilesSlug = (slug, site) => {
  if (typeof slug !== "string" || slug === "") return false
  if (!site || site.from_wikidot !== true) return false
  if (typeof site.slug !== "string" || !SITE_SLUG_PATTERN.test(site.slug)) {
    return false
  }
  return site.slug.toLowerCase() === slug
}

/**
 * Rewrite one WDFiles attachment URL to the local files authority when the
 * viewed site itself is the evidence the file is local, else null (the
 * caller keeps the source URL literal). Query, fragment, and encoding are
 * preserved; only the origin is swapped.
 *
 * @param {unknown} rawUrl
 * @param {LocalSiteEvidence | null | undefined} site
 * @param {unknown} filesAuthority
 * @returns {string | null}
 */
export const localizeSiteFileUrl = (rawUrl, site, filesAuthority) => {
  if (
    typeof filesAuthority !== "string" ||
    filesAuthority.trim() === "" ||
    filesAuthority.includes("/") ||
    filesAuthority.includes("://")
  ) {
    return null
  }
  const split = splitAbsoluteHttpUrl(rawUrl)
  if (!split || WIKIDOT_WWW_HOSTS.has(split.host)) return null
  if (!split.rest.startsWith("/local--files/")) return null
  if (split.rest.length <= "/local--files/".length) return null
  const slug = wdfilesAttachmentSiteSlug(split.host)
  if (!isViewedSiteWdfilesSlug(slug ?? "", site)) return null
  return `https://${filesAuthority.trim()}${split.rest}`
}

const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/giu
const CSS_BARE_IMPORT_PATTERN = /@import\s+(?!url\()\s*(['"])([^'"]+?)\1/giu

/**
 * Rewrite same-site WDFiles attachment URLs inside stored CSS (`url(...)`
 * and bare `@import "..."`), keeping every other byte literal.
 *
 * @param {unknown} css
 * @param {LocalSiteEvidence | null | undefined} site
 * @param {unknown} filesAuthority
 * @returns {string}
 */
export const localizeSiteFileUrlsInCss = (css, site, filesAuthority) => {
  if (typeof css !== "string") return typeof css === "undefined" ? "" : css
  const rewriteMatch = (match, url) => {
    const rewritten = localizeSiteFileUrl(url, site, filesAuthority)
    if (!rewritten || rewritten === url) return match
    const index = match.indexOf(url)
    return index < 0
      ? match
      : match.slice(0, index) + rewritten + match.slice(index + url.length)
  }
  return css
    .replace(CSS_URL_PATTERN, (match, _quote, url) => rewriteMatch(match, url))
    .replace(CSS_BARE_IMPORT_PATTERN, (match, _quote, url) => rewriteMatch(match, url))
}

/**
 * Resolve the head `<link>` href for an external theme: the normalized
 * source URL, rewritten to the local files authority only when the viewed
 * site itself evidences the file is local.
 *
 * @param {{ type?: unknown; id?: unknown; url?: unknown; css?: unknown }
 *   | null
 *   | undefined} theme
 * @param {LocalSiteEvidence | null | undefined} site
 * @param {unknown} filesAuthority
 * @returns {string | null}
 */
export const resolveExternalThemeHref = (theme, site, filesAuthority) => {
  const normalized = normalizeThemeSetting(theme)
  if (normalized.type !== "external") return null
  return localizeSiteFileUrl(normalized.url, site, filesAuthority) ?? normalized.url
}

/**
 * @param {{ type?: unknown; id?: unknown; url?: unknown; css?: unknown }
 *   | null
 *   | undefined} theme
 * @returns {readonly string[]}
 */
export const builtInThemeAssetDirs = (theme) => {
  const normalized = normalizeThemeSetting(theme)
  if (normalized.type !== "built_in") return []
  return (
    BUILT_IN_THEME_ASSET_DIRS[normalized.id] ??
    BUILT_IN_THEME_ASSET_DIRS[BUILT_IN_THEME.id]
  )
}

/**
 * Resolve the exact evidenced immutable stylesheet URLs for a built-in
 * theme id, in served order. Non-built-in themes resolve to no URLs; an
 * unmapped id resolves to Base. Missing-resource fallback was not observed
 * on live Wikidot, so unresolved ids keep the Base asset set rather than
 * inventing a substitute.
 *
 * @param {{ type?: unknown; id?: unknown; url?: unknown; css?: unknown }
 *   | null
 *   | undefined} theme
 * @returns {string[]}
 */
export const builtInThemeAssetUrls = (theme) =>
  builtInThemeAssetDirs(theme).map(
    (dir) => `${WIKIDOT_THEME_ASSET_ORIGIN}/${dir}/css/style.css`
  )

/**
 * Emit the live inline `@import` form for the theme directories beyond the
 * established local Base assets, in evidenced order. The local Wikidot
 * Base stylesheets already serve common--theme/base, so Base itself emits
 * nothing and id 1 stays byte-identical to the existing head.
 *
 * @param {{ type?: unknown; id?: unknown; url?: unknown; css?: unknown }
 *   | null
 *   | undefined} theme
 * @returns {string}
 */
export const builtInThemeHeadHtml = (theme) => {
  const dirs = builtInThemeAssetDirs(theme).filter((dir) => dir !== "base")
  if (dirs.length === 0) return ""
  const imports = dirs
    .map((dir) => `@import url(${WIKIDOT_THEME_ASSET_ORIGIN}/${dir}/css/style.css);`)
    .join("\n")
  return `<style type="text/css" id="internal-style">\n${imports}\n</style>`
}
