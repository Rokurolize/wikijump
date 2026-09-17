const escapeHtml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const WIKIDOT_PRINTER_FRIENDLY_PREFIX = "/printer--friendly/"

/**
 * Build the live Wikidot printer-friendly child URL. The page path already
 * begins with `/`, which preserves Wikidot's exact doubled slash
 * (`/printer--friendly//<page>`).
 *
 * @param {string} pagePath
 * @returns {string}
 */
export const buildWikidotPrinterFriendlyUrl = (pagePath) =>
  `${WIKIDOT_PRINTER_FRIENDLY_PREFIX}${pagePath}`

/** @type {readonly string[]} */
export const WIKIDOT_PRINT_FONT_SIZES = Object.freeze([
  "6pt",
  "8pt",
  "10pt",
  "12pt",
  "14pt",
  "16pt"
])

const fontSizesHtml = WIKIDOT_PRINT_FONT_SIZES.map(
  (size) =>
    `<a href="javascript:;" onclick="WIKIDOT.printview.listeners.changeFontSize(event, '${size}')">${size}</a>`
).join(" | ")

/**
 * Wikidot's verified printer-friendly option rows. Only the base font size
 * choices carry a retained live handler shape; every other row stays literal
 * until a retained interaction capture establishes its behavior.
 */
export const buildWikidotPrintOptionsHtml = () =>
  [
    '<div id="print-options">',
    "<table>",
    "<tbody>",
    "<tr>",
    "<td>",
    "Base font size:",
    "</td>",
    `<td>${fontSizesHtml}</td>`,
    "</tr>",
    "<tr>",
    "<td>",
    "Body font:",
    "</td>",
    "<td>original font | Georgia | Times New Roman | Serif | Serif (generic) | Arial/Helvetica</td>",
    "</tr>",
    "<tr>",
    "<td>",
    "Source info:",
    "</td>",
    "<td>toggle visibility</td>",
    "</tr>",
    "<tr>",
    "<td>",
    "Options:",
    "</td>",
    '<td><b><a href="javascript:;" onclick="window.print()">PRINT THE PAGE</a></b> | <a href="javascript:;">Close this window</a></td>',
    "</tr>",
    "</tbody>",
    "</table>",
    "</div>"
  ].join("\n")

/**
 * @param {{
 *   siteName: string
 *   siteUrl: string
 *   pageTitle: string
 *   pageUrl: string
 * }} input
 * @returns {string}
 */
export const buildWikidotPrintSourceInfoHtml = ({
  siteName,
  siteUrl,
  pageTitle,
  pageUrl
}) =>
  [
    '<div id="print-source-info">',
    `Site: <b>${escapeHtml(siteName)}</b> at ${escapeHtml(siteUrl)}`,
    `Source page: <b>${escapeHtml(pageTitle)}</b> at ${escapeHtml(pageUrl)}`,
    "</div>"
  ].join("\n")

const CHANGE_FONT_SIZE_ONCLICK =
  /^WIKIDOT\.printview\.listeners\.changeFontSize\(event, '([0-9]+pt)'\)$/u

/**
 * Bind the printer-friendly child window's trusted behavior. Served markup
 * keeps Wikidot's exact inert `javascript:;` anchors and generated handler
 * attributes; this action supplies the executable property under CSP without
 * evaluating authored script.
 *
 * @param {HTMLElement} root
 */
export const wikidotPrintView = (root) => {
  /** @type {Array<() => void>} */
  const releases = []
  const bind = (element, listener) => {
    element.addEventListener("click", listener)
    releases.push(() => element.removeEventListener("click", listener))
  }
  const content = () => root.querySelector("#print-content")

  for (const element of root.querySelectorAll(
    'a[onclick^="WIKIDOT.printview.listeners.changeFontSize"]'
  )) {
    const match = CHANGE_FONT_SIZE_ONCLICK.exec(element.getAttribute("onclick") ?? "")
    if (!match) continue
    const size = match[1]
    bind(element, (event) => {
      event.preventDefault()
      const target = content()
      if (target) target.style.fontSize = size
    })
  }

  for (const element of root.querySelectorAll('a[onclick="window.print()"]')) {
    bind(element, (event) => {
      event.preventDefault()
      globalThis.print()
    })
  }

  for (const element of root.querySelectorAll(
    '#print-options a[href="javascript:;"]:not([onclick])'
  )) {
    bind(element, (event) => {
      event.preventDefault()
      globalThis.close()
    })
  }

  return {
    destroy() {
      for (const release of releases) release()
      releases.length = 0
    }
  }
}
