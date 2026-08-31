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

export const customThemeHeadHtml = (theme) => {
  const normalized = normalizeThemeSetting(theme)
  return normalized.type === "custom"
    ? `<style data-wikidot-site-theme>${normalized.css}</style>`
    : ""
}
