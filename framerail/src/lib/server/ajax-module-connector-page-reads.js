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

/** @param {string} value */
const escapeJavascriptSingleQuotedString = (value) =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("<", "\\x3c")

/**
 * @param {{ name: string; content: string; all_pages: boolean }[]} tags
 */
export const renderWikidotEditMeta = (tags) => {
  const renderRow = ({ name, content, all_pages: allPages }) => {
    const deleteArguments = `'${escapeJavascriptSingleQuotedString(name)}'${allPages ? ", true" : ""}`
    return `<div>\n\t\t\t\t<a href="javascript:;" style="margin-right: 2em"\n\t\t\t\t\tonclick="WIKIDOT.modules.EditMetaModule.listeners.deleteTag(event, ${escapeHtml(deleteArguments)})">remove</a>\n\t\t\t\t&lt;meta name="${escapeHtml(name)}" content="${escapeHtml(content)}"/&gt;${allPages ? " (all pages)\t\t\t</div>\n\t\t\t\t" : "\n\t\t\t</div>\n\t\t"}`
  }
  const globalRows = tags
    .filter((tag) => tag.all_pages)
    .map((tag) => `\t\t\t\t\t${renderRow(tag)}`)
    .join("")
  const pageRows = tags
    .filter((tag) => !tag.all_pages)
    .map((tag) => `\t\t\t${renderRow(tag)}`)
    .join("")

  return `<h1>Meta tags for the page</h1>

<p>
\tUsing the interface below you can edit special HTML &lt;meta&gt; tags for the page.</p>


\t<h2>Current meta tags:</h2>
\t
\t<div style="padding-left:3em;">
${globalRows}${pageRows}\t</div>

<p id="edit-meta-addbutton">
\t<a href="javascript:;" onclick="WIKIDOT.modules.EditMetaModule.listeners.add(event)" class="btn btn-primary"><i class="icon-plus"></i> Add a new meta tag</a>
</p>

<div id="edit-meta-newtag" style="display:none;">

\t<h2>Add a new meta tag</h2>
\t<form id="edit-meta-newtag-form" onsubmit="return false">
\t\t<table style="margin: 0 auto;">
\t\t\t<tr>
\t\t\t\t<td>
\t\t\t\t\t&lt;meta&nbsp;&nbsp;&nbsp;name="
\t\t\t\t</td>
\t\t\t\t<td>
\t\t\t\t\t<input name="metaName" type="text" class="text" size="20"/>
\t\t\t\t</td>
\t\t\t\t<td>
\t\t\t\t\t"&nbsp;&nbsp;&nbsp;content="
\t\t\t\t</td>
\t\t\t\t<td>
\t\t\t\t\t<input name="metaContent" type="text" class="text" size="30"/>
\t\t\t\t</td>
\t\t\t\t<td>
\t\t\t\t\t" /&gt;
\t\t\t\t</td>
\t\t\t</tr>
\t\t</table>
\t\t<div style="text-align: center; padding: 1em;">
\t\t\t<a href="javascript:;" class="button btn btn-danger btn-small btn-sm" onclick="WIKIDOT.modules.EditMetaModule.utils.reload(event)">Cancel</a>
\t\t\t<a href="javascript:;" class="button btn btn-primary btn-small btn-sm" onclick="WIKIDOT.modules.EditMetaModule.listeners.save(event, true)"><i class"icon-plus"></i> Add to All Pages</a>
\t\t\t<a href="javascript:;" class="button btn btn-primary btn-small btn-sm" onclick="WIKIDOT.modules.EditMetaModule.listeners.save(event)"><i class"icon-plus"></i> Add to This Page</a>
\t\t</div>
\t</form>
</div>

<p>
    Adding a meta tag with the name already used will effectively replace the existing entry.  <br/><br/>  Meta entries added to a page override global meta information added to all pages.</p>`
}

/**
 * @typedef {{
 *   user: {
 *     "user-id": number
 *     "user-name": string
 *     "user-slug": string
 *   }
 *   value: number
 * }} WikidotWhoRatedVote
 */

/** @param {WikidotWhoRatedVote[]} votes */
export const renderWikidotWhoRated = (votes) => {
  const rows = votes
    .map(({ user, value }) => {
      if (value !== 1 && value !== -1) {
        throw new TypeError("WhoRated supports only observed plus/minus vote values")
      }
      const userId = user["user-id"]
      const userSlug = escapeHtmlAttribute(user["user-slug"])
      const profileUrl = `http://www.wikidot.com/user:info/${userSlug}`
      const userName = escapeHtml(user["user-name"])
      const sign = value === 1 ? "+" : "-"
      return `<span class="printuser avatarhover"><a href="${profileUrl}" onclick="WIKIDOT.page.listeners.userInfo(${userId}); return false;">${userName}</a></span>\n        <span style="color:#777">\n                    ${sign}              </span><br/>`
    })
    .join("")
  return `<h2>Users who rated:</h2>\n\n<div style="-moz-column-count:3">${rows}</div>`
}

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
