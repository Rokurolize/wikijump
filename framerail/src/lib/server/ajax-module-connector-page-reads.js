/** @param {string} value */
const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

/** @param {string} wikitext */
export const renderWikidotViewSource = (wikitext) =>
  `<h1>Page Source</h1>\n\n<div class="page-source">\n\t${escapeHtml(wikitext)}\n</div>\n`

/**
 * @param {string} pageSlug
 * @param {{
 *   file_id: number
 *   name: string
 *   mime: string
 *   size: number
 * }[]} files
 */
export const renderWikidotPageFiles = (pageSlug, files) => {
  if (files.length === 0) {
    return "<h1>Files</h1>\n<p>No files attached to this page</p>"
  }

  const escapedSlug = encodeURIComponent(pageSlug)
  const rows = files
    .map(
      (file) =>
        `<tr id="file-row-${file.file_id}"><td><a href="/local--files/${escapedSlug}/${encodeURIComponent(file.name)}">${escapeHtml(file.name)}</a></td><td><span title="${escapeHtml(file.mime)}">${escapeHtml(file.mime)}</span></td><td>${file.size} Bytes</td></tr>`
    )
    .join("")
  return `<h1>Files</h1>\n<table class="page-files"><tbody>${rows}</tbody></table>`
}
