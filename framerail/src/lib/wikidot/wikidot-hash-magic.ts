export type WikidotHashMagicPagePane = "files" | "history"

const HASH_MAGIC_COMMAND = /#_(\w*)/u

/**
 * Resolve the page-pane Hash Magic command that Wikidot checks once while
 * the document initializes. Unsupported commands are deliberately left to
 * their owning runtime surfaces.
 */
export function resolveWikidotHashMagicPagePane(
  href: string
): WikidotHashMagicPagePane | null {
  const command = HASH_MAGIC_COMMAND.exec(href)?.[1]?.toLowerCase()
  return command === "history" || command === "files" ? command : null
}
