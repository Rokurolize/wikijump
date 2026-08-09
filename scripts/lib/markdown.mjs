export function escapeMarkdownTableCell(value) {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
