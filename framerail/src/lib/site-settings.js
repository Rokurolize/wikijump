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

export const customThemeHeadHtml = (theme) => {
  const normalized = normalizeThemeSetting(theme)
  return normalized.type === "custom"
    ? `<style data-wikidot-site-theme>${normalized.css}</style>`
    : ""
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
