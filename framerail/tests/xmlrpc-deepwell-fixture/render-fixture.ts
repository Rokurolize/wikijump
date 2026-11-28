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

const evaluateIftags = (expression: string, tags: readonly string[]) => {
  const terms = expression.trim().split(/\s+/u).filter(Boolean)
  const positive = terms.filter((term) => !term.startsWith("-"))
  const negative = terms
    .filter((term) => term.startsWith("-"))
    .map((term) => term.slice(1))
  return (
    positive.every((term) => tags.includes(term.replace(/^\+/u, ""))) &&
    negative.every((term) => !tags.includes(term))
  )
}

const expandIftags = (source: string, tags: readonly string[]) =>
  source.replace(
    /\[\[iftags\s+([^\]\n]+)\]\]([\s\S]*?)\[\[\/iftags\]\]/gu,
    (_match, expression: string, body: string) =>
      evaluateIftags(expression, tags) ? body : ""
  )

export const renderFixtureWikitext = (source: string, tags: readonly string[] = []) => {
  const withoutComments = source.replace(/\[!--[\s\S]*?--\]/gu, "")
  return expandIncludes(expandIftags(withoutComments, tags))
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
