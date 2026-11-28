import { pages } from "./data.ts"

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const expandIncludes = (source: string) => {
  let expanded = source
  for (let depth = 0; depth < 8; depth += 1) {
    const next = expanded.replace(
      /\[\[include\s+([^\s\]]+)\s*\]\]/gu,
      (_match, slug: string) => pages[slug]?.wikitext ?? ""
    )
    if (next === expanded) return expanded
    expanded = next
  }
  return expanded
}

const renderInline = (value: string) =>
  escapeHtml(value)
    .replace(/\*\*([^*\n]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/(^|[^:])\/\/([^/\n]+)\/\//gu, "$1<em>$2</em>")

export const renderFixtureWikitext = (source: string) => {
  const withoutComments = source.replace(/\[!--[\s\S]*?--\]/gu, "")
  return expandIncludes(withoutComments)
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const heading = /^(\+{1,6})\s+([\s\S]*)$/u.exec(block)
      if (heading) {
        const level = heading[1].length
        return `<h${level}>${renderInline(heading[2]).replaceAll("\n", "<br>")}</h${level}>`
      }
      return `<p>${renderInline(block).replaceAll("\n", "<br>")}</p>`
    })
    .join("\n")
}
