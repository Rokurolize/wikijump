export type WikidotHashMagicPagePane = "files" | "history" | "edit-page" | "edit-tags"

const HASH_MAGIC_COMMAND = /#_(\w*)/u

const PANE_BY_COMMAND: Record<string, WikidotHashMagicPagePane> = {
  files: "files",
  history: "history",
  editpage: "edit-page",
  edittags: "edit-tags"
}

/**
 * Resolve the page-pane Hash Magic commands that current Wikidot checks
 * once while the document initializes. `#_editpage` and `#_edittags` are
 * verified compatibility commands; unknown commands are deliberately left
 * inert and ordinary document anchors never match the `#_` prefix.
 */
export function resolveWikidotHashMagicPagePane(
  href: string
): WikidotHashMagicPagePane | null {
  const command = HASH_MAGIC_COMMAND.exec(href)?.[1]?.toLowerCase() ?? ""
  return PANE_BY_COMMAND[command] ?? null
}
