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

/** @param {string} value */
const escapeHtmlAttribute = (value) => escapeHtml(value).replaceAll("'", "&#39;")

/** @param {string} createdAt */
const wikidotDateText = (createdAt) => {
  const date = new Date(createdAt)
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ]
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/**
 * @typedef {{
 *   revision_id: number
 *   revision_type: string
 *   revision_number: number
 *   created_at: string
 *   user_id: number
 *   author: null | {
 *     "user-id": number
 *     "user-slug": string
 *     "user-name": string
 *   }
 *   changes: string[]
 *   comments: string | null
 *   wikitext: string | null
 *   compiled_body_html: string | null
 * }} WikidotHistoryRevision
 */

/** @param {WikidotHistoryRevision} revision */
const renderWikidotRevisionFlags = (revision) => {
  if (revision.revision_type === "create") {
    return '<span class="spantip" title="New page">N</span>'
  }
  if (revision.revision_type === "move") {
    return '<span class="spantip" title="Page renamed">R</span>'
  }
  if (revision.changes.some((change) => change !== "wikitext")) {
    return '<span class="spantip" title="Metadata changed">M</span>'
  }
  return ""
}

/** @param {WikidotHistoryRevision} revision */
const renderWikidotRevisionAuthor = (revision) => {
  if (!revision.author) {
    return `<span class="printuser deleted" data-id="${revision.user_id}"></span>`
  }
  const userId = revision.author["user-id"]
  const userSlug = escapeHtmlAttribute(revision.author["user-slug"])
  const userName = escapeHtml(revision.author["user-name"])
  return `<span class="printuser"><a href="http://www.wikidot.com/user:info/${userSlug}" onclick="WIKIDOT.page.listeners.userInfo(${userId}); return false;">${userName}</a></span>`
}

/** @param {WikidotHistoryRevision[]} revisions */
export const renderWikidotPageRevisionList = (revisions) => {
  const rows = revisions
    .map((revision, index) => {
      const revisionId = revision.revision_id
      const fromChecked = index === 1 ? ' checked="checked"' : ""
      const toChecked = index === 0 ? ' checked="checked"' : ""
      const timestamp = Math.floor(new Date(revision.created_at).getTime() / 1000)
      return `<tr id="revision-row-${revisionId}"><td>${revision.revision_number + 1}.</td><td><input type="radio" name="from" value="${revisionId}"${fromChecked} /><input type="radio" name="to" value="${revisionId}"${toChecked} /></td><td>${renderWikidotRevisionFlags(revision)}</td><td><a href="javascript:;" onclick="showVersion(${revisionId})">V</a> <a href="javascript:;" onclick="showSource(${revisionId})">S</a></td><td>${renderWikidotRevisionAuthor(revision)}</td><td><span class="odate time_${timestamp}">${wikidotDateText(revision.created_at)}</span></td><td>${escapeHtml(revision.comments ?? "")}</td></tr>`
    })
    .join("")
  return `<table class="page-history"><tr><td>rev.</td><td>&nbsp;</td><td>flags</td><td>action</td><td>by</td><td>date</td><td>comment</td></tr>${rows}</table>`
}

/** @param {WikidotHistoryRevision} revision */
export const renderWikidotPageRevisionSource = (revision) =>
  `<div class="page-source">${escapeHtml(revision.wikitext ?? "")}</div>`

/** @param {WikidotHistoryRevision} revision */
export const renderWikidotPageRevisionVersion = (revision) =>
  revision.compiled_body_html ?? ""

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
