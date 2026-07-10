/**
 * @typedef {{
 *   priority?: string | null
 *   themes?: string[]
 *   css?: string | null
 *   origin?: string | null
 * }} WikidotStyleFrameInput
 */

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
const escapeHtml = (value) => {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

/**
 * @param {string} value
 * @returns {string}
 */
const safeInlineCss = (value) => value.replace(/<\/(style|script)/giu, "<\\/$1")

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
export const isUsableStyleFrameCss = (value) => {
  if (!value) return false
  const trimmed = value.trim()
  return trimmed.length > 0 && !["{$css}", "$css"].includes(trimmed)
}

/**
 * Map Wikidot page-owned local files/code to the current local file host.
 * CDN theme URLs are intentionally preserved; offline mirroring is a later
 * policy slice, not hidden here.
 *
 * @param {string} themeUrl
 * @param {string | null | undefined} origin
 * @returns {string}
 */
export const localizeWikidotThemeUrl = (themeUrl, origin) => {
  if (!origin) return themeUrl
  let parsed
  let localOrigin
  try {
    parsed = new URL(themeUrl)
    localOrigin = new URL(origin)
  } catch {
    return themeUrl
  }

  if (
    !["scp-wiki.wikidot.com", "scp-wiki.wdfiles.com"].includes(parsed.hostname) ||
    !parsed.pathname.startsWith("/local--")
  ) {
    return themeUrl
  }

  const localHost = localOrigin.hostname.replace(
    /\.wikijump\.localhost$/u,
    ".wjfiles.localhost"
  )
  if (localHost === localOrigin.hostname) return themeUrl
  parsed.protocol = localOrigin.hostname.endsWith(".wikijump.localhost")
    ? "https:"
    : localOrigin.protocol
  parsed.host = localHost
  return parsed.toString()
}

/**
 * @param {WikidotStyleFrameInput} input
 * @returns {string}
 */
export const buildWikidotStyleFrameHtml = ({
  priority = "",
  themes = [],
  css = "",
  origin = null
}) => {
  const localizedThemes = themes
    .filter((theme) => theme.trim().length > 0)
    .map((theme) => localizeWikidotThemeUrl(theme, origin))
  const inlineCss = isUsableStyleFrameCss(css) ? safeInlineCss(css ?? "") : ""
  const themeList = localizedThemes
    .map((theme) => `<li>${escapeHtml(theme)}</li>`)
    .join("")
  const styleLinks = localizedThemes
    .map((theme) => `<link rel="stylesheet" href="${escapeHtml(theme)}">`)
    .join("\n    ")
  const styleBlock = inlineCss ? `<style>${inlineCss}</style>` : ""

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Local Wikidot style frame</title>
    <meta name="wikidot-style-priority" content="${escapeHtml(priority)}">
    <meta name="wikidot-style-theme-count" content="${localizedThemes.length}">
    <meta name="wikidot-style-inline-css" content="${inlineCss ? "true" : "false"}">
    ${styleLinks}
    ${styleBlock}
  </head>
  <body>
    <ul hidden>${themeList}</ul>
  </body>
</html>
`
}
