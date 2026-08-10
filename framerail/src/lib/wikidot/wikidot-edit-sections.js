const renderedHeadingSelector =
  "h1[id^='toc'], h2[id^='toc'], h3[id^='toc'], h4[id^='toc'], h5[id^='toc'], h6[id^='toc']"
const editControlsByPage = new WeakMap()

/**
 * @typedef {object} WikidotEditSection
 * @property {number} index
 * @property {number} level
 * @property {number} start
 * @property {number} end
 */

/**
 * Match source-owned headings to the direct rendered Wikidot heading sequence.
 *
 * @param {string} source
 * @param {{ children: ArrayLike<Element>, querySelectorAll: (selector: string) => ArrayLike<Element> }} pageContent
 * @returns {WikidotEditSection[]}
 */
export const findWikidotEditSections = (source, pageContent) => {
  const descendantHeadings = Array.from(
    pageContent.querySelectorAll(renderedHeadingSelector)
  )
  const directHeadings = Array.from(pageContent.children).filter(
    (element) => /^H[1-6]$/.test(element.tagName) && /^toc\d+$/.test(element.id)
  )

  if (
    directHeadings.length === 0 ||
    descendantHeadings.length !== directHeadings.length
  ) {
    return []
  }

  const sourceHeadings = Array.from(
    source.matchAll(/^(\+{1,6})[ \t]+[^\r\n]+/gm),
    (match) => ({ level: match[1].length, start: match.index })
  )
  if (sourceHeadings.length !== directHeadings.length) return []

  for (const [index, heading] of directHeadings.entries()) {
    if (
      heading.id !== `toc${index}` ||
      heading.tagName !== `H${sourceHeadings[index].level}` ||
      descendantHeadings[index] !== heading
    ) {
      return []
    }
  }

  return sourceHeadings.map((heading, index) => {
    const nextPeer = sourceHeadings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level)
    return {
      index,
      level: heading.level,
      start: heading.start,
      end: nextPeer?.start ?? source.length
    }
  })
}

/**
 * Insert or remove Wikidot's direct-child section edit controls.
 *
 * @param {HTMLElement} pageContent
 * @param {string} source
 * @param {(section: WikidotEditSection) => void} edit
 * @returns {boolean} Whether controls are visible after the toggle.
 */
export const toggleWikidotEditSections = (pageContent, source, edit) => {
  const existing = editControlsByPage.get(pageContent)
  if (existing) {
    for (const control of existing) control.remove()
    editControlsByPage.delete(pageContent)
    return false
  }

  const sections = findWikidotEditSections(source, pageContent)
  const directHeadings = Array.from(pageContent.children).filter(
    (element) => /^H[1-6]$/.test(element.tagName) && /^toc\d+$/.test(element.id)
  )
  const controls = []
  for (const section of sections) {
    const heading = directHeadings[section.index]
    const control = pageContent.ownerDocument.createElement("a")
    control.className = "edit-section-button"
    control.href = "javascript:;"
    control.id = `edit-section-b-${section.index}`
    control.textContent = "edit"
    control.addEventListener("click", (event) => {
      event.preventDefault()
      edit(section)
    })
    heading.before(control)
    controls.push(control)
  }
  if (sections.length > 0) {
    editControlsByPage.set(pageContent, controls)
  }
  return sections.length > 0
}

/**
 * @param {string} source
 * @param {WikidotEditSection} section
 * @param {string} replacement
 */
export const buildWikidotSectionEditSource = (source, section, replacement) =>
  source.slice(0, section.start) + replacement + source.slice(section.end)

/**
 * Build the existing edit action payload without allowing section editing to
 * change page metadata.
 *
 * @param {Record<string, unknown>} form
 * @param {{ siteId: number, pageId: number | undefined, revisionId: number | undefined, title: string, altTitle: string, tags: string, source: string }} revision
 * @param {WikidotEditSection} section
 * @param {string} replacement
 */
export const buildWikidotSectionEditSubmission = (
  form,
  revision,
  section,
  replacement
) => ({
  ...form,
  siteId: revision.siteId,
  pageId: revision.pageId,
  lastRevisionId: revision.revisionId,
  title: revision.title,
  altTitle: revision.altTitle,
  tags: revision.tags,
  wikitext: buildWikidotSectionEditSource(revision.source, section, replacement)
})
