export type ToolbarOperationId =
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "bold"
  | "italic"
  | "strike"
  | "teletype"
  | "quote"
  | "bullet-list"
  | "numbered-list"
  | "horizontal-rule"
  | "raw"
  | "link"
  | "image"
  | "table"
  | "code"
  | "footnote"
  | "math"
  | "inline-math"

export type ToolbarShortcut = {
  key: string
  display: string
  aria: string
}

export type ToolbarOperationDefinition = {
  id: ToolbarOperationId
  label: string
  accessibleLabel: string
  shortcut?: ToolbarShortcut
}

export type EditorTextTransformInput = {
  text: string
  from: number
  to: number
}

export type EditorTextTransformResult = EditorTextTransformInput

export type ToolbarOperationOptions = {
  linkTarget?: string
  imageSource?: string
}

const modShortcut = (key: string, base: string, display: string): ToolbarShortcut => ({
  key,
  display,
  aria: `Control+${base} Meta+${base}`
})

const altShortcut = (key: string, base: string, display: string): ToolbarShortcut => ({
  key,
  display,
  aria: `Alt+${base}`
})

export const toolbarOperations: ToolbarOperationDefinition[] = [
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    id: `heading${level}` as ToolbarOperationId,
    label: `H${level}`,
    accessibleLabel: `Heading level ${level}`,
    shortcut: altShortcut(`Alt-${level}`, `${level}`, `Alt+${level}`)
  })),
  {
    id: "bold",
    label: "B",
    accessibleLabel: "Bold",
    shortcut: modShortcut("Mod-b", "B", "Ctrl/Cmd+B")
  },
  {
    id: "italic",
    label: "I",
    accessibleLabel: "Italic",
    shortcut: modShortcut("Mod-i", "I", "Ctrl/Cmd+I")
  },
  {
    id: "strike",
    label: "S",
    accessibleLabel: "Strikethrough",
    shortcut: modShortcut("Mod-Shift-x", "Shift+X", "Ctrl/Cmd+Shift+X")
  },
  {
    id: "teletype",
    label: "TT",
    accessibleLabel: "Teletype",
    shortcut: altShortcut("Alt-t", "T", "Alt+T")
  },
  {
    id: "quote",
    label: "Quote",
    accessibleLabel: "Quote block",
    shortcut: altShortcut("Alt-q", "Q", "Alt+Q")
  },
  {
    id: "bullet-list",
    label: "• List",
    accessibleLabel: "Bulleted list",
    shortcut: altShortcut("Alt-u", "U", "Alt+U")
  },
  {
    id: "numbered-list",
    label: "1. List",
    accessibleLabel: "Numbered list",
    shortcut: altShortcut("Alt-o", "O", "Alt+O")
  },
  {
    id: "horizontal-rule",
    label: "HR",
    accessibleLabel: "Horizontal rule"
  },
  {
    id: "raw",
    label: "Raw",
    accessibleLabel: "Raw text"
  },
  {
    id: "link",
    label: "Link",
    accessibleLabel: "Insert link",
    shortcut: modShortcut("Mod-k", "K", "Ctrl/Cmd+K")
  },
  {
    id: "image",
    label: "Image",
    accessibleLabel: "Insert image",
    shortcut: altShortcut("Alt-g", "G", "Alt+G")
  },
  {
    id: "table",
    label: "Table",
    accessibleLabel: "Insert table skeleton"
  },
  {
    id: "code",
    label: "Code",
    accessibleLabel: "Code block",
    shortcut: altShortcut("Alt-c", "C", "Alt+C")
  },
  {
    id: "footnote",
    label: "Footnote",
    accessibleLabel: "Footnote"
  },
  {
    id: "math",
    label: "Math",
    accessibleLabel: "Math block"
  },
  {
    id: "inline-math",
    label: "Inline math",
    accessibleLabel: "Inline math"
  }
]

const normalizedRange = ({ text, from, to }: EditorTextTransformInput) => {
  const lower = Math.max(0, Math.min(from, to))
  const upper = Math.max(0, Math.max(from, to))
  return {
    text,
    from: Math.min(lower, text.length),
    to: Math.min(upper, text.length)
  }
}

const replaceRange = (
  input: EditorTextTransformInput,
  replacement: string,
  selectionFrom: number,
  selectionTo: number
): EditorTextTransformResult => {
  const { text, from, to } = normalizedRange(input)
  return {
    text: `${text.slice(0, from)}${replacement}${text.slice(to)}`,
    from: selectionFrom,
    to: selectionTo
  }
}

const wrapInline = (
  input: EditorTextTransformInput,
  open: string,
  close = open
): EditorTextTransformResult => {
  const { text, from, to } = normalizedRange(input)
  const selected = text.slice(from, to)

  if (
    selected.length >= open.length + close.length &&
    selected.startsWith(open) &&
    selected.endsWith(close)
  ) {
    const inner = selected.slice(open.length, selected.length - close.length)
    return replaceRange({ text, from, to }, inner, from, from + inner.length)
  }

  if (
    from >= open.length &&
    text.slice(from - open.length, from) === open &&
    text.slice(to, to + close.length) === close
  ) {
    const innerStart = from - open.length
    return {
      text: `${text.slice(0, innerStart)}${selected}${text.slice(to + close.length)}`,
      from: innerStart,
      to: innerStart + selected.length
    }
  }

  const replacement = `${open}${selected}${close}`
  const innerStart = from + open.length
  return replaceRange(
    { text, from, to },
    replacement,
    innerStart,
    innerStart + selected.length
  )
}

const lineRange = (text: string, from: number, to: number) => {
  const previousNewline = text.lastIndexOf("\n", Math.max(0, from - 1))
  const start = previousNewline + 1
  let effectiveEnd = Math.max(from, to)
  if (to > from && text[to - 1] === "\n") effectiveEnd -= 1
  const nextNewline = text.indexOf("\n", effectiveEnd)
  const end = nextNewline === -1 ? text.length : nextNewline
  return { start, end }
}

const transformLines = (
  input: EditorTextTransformInput,
  transform: (lines: string[]) => string[]
): EditorTextTransformResult => {
  const { text, from, to } = normalizedRange(input)
  const range = lineRange(text, from, to)
  const lines = text.slice(range.start, range.end).split("\n")
  const replacement = transform(lines).join("\n")
  const cursorAtEnd = range.start + replacement.length
  return {
    text: `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`,
    from: from === to ? cursorAtEnd : range.start,
    to: from === to ? cursorAtEnd : range.start + replacement.length
  }
}

const transformPrefixedLines = (
  input: EditorTextTransformInput,
  prefix: string,
  prefixPattern: RegExp
): EditorTextTransformResult =>
  transformLines(input, (lines) => {
    const unwrap = lines.every((line) => prefixPattern.test(line))
    return lines.map((line) => {
      if (unwrap) return line.replace(prefixPattern, "")
      return prefixPattern.test(line) ? line : `${prefix}${line}`
    })
  })

const headingPattern = /^\+{1,6}(?!\+)\*?(?:\s+|$)/u

const transformHeading = (
  input: EditorTextTransformInput,
  level: number
): EditorTextTransformResult => {
  const prefix = `${"+".repeat(level)} `
  const sameHeadingPattern = new RegExp(`^\\+{${level}}(?!\\+)\\*?(?:\\s+|$)`, "u")
  return transformLines(input, (lines) => {
    const nonEmptyLines = lines.filter((line) => line !== "")
    const unwrap =
      nonEmptyLines.length > 0 &&
      nonEmptyLines.every((line) => sameHeadingPattern.test(line))
    return lines.map((line) => {
      if (line === "" && lines.length > 1) return line
      const unwrapped = line.replace(headingPattern, "")
      return unwrap ? unwrapped : `${prefix}${unwrapped}`
    })
  })
}

const insertBlock = (
  input: EditorTextTransformInput,
  block: string,
  selectionOffset: number,
  selectionLength = 0
): EditorTextTransformResult => {
  const { text, from, to } = normalizedRange(input)
  const before = from > 0 && text[from - 1] !== "\n" ? "\n" : ""
  const after = to < text.length && text[to] !== "\n" ? "\n" : ""
  const replacement = `${before}${block}${after}`
  const selectionStart = from + before.length + selectionOffset
  return replaceRange(
    { text, from, to },
    replacement,
    selectionStart,
    selectionStart + selectionLength
  )
}

const wrapBlock = (
  input: EditorTextTransformInput,
  open: string,
  close: string
): EditorTextTransformResult => {
  const { text, from, to } = normalizedRange(input)
  const selected = text.slice(from, to)
  const blockOpen = `${open}\n`
  const blockClose = `\n${close}`

  if (selected.startsWith(blockOpen) && selected.endsWith(blockClose)) {
    const inner = selected.slice(blockOpen.length, selected.length - blockClose.length)
    return replaceRange({ text, from, to }, inner, from, from + inner.length)
  }

  if (
    from >= blockOpen.length &&
    text.slice(from - blockOpen.length, from) === blockOpen &&
    text.slice(to, to + blockClose.length) === blockClose
  ) {
    const innerStart = from - blockOpen.length
    return {
      text: `${text.slice(0, innerStart)}${selected}${text.slice(to + blockClose.length)}`,
      from: innerStart,
      to: innerStart + selected.length
    }
  }

  const block = `${open}\n${selected}\n${close}`
  const innerOffset = open.length + 1
  const { text: insertedText, from: insertedFrom } = insertBlock(
    { text, from, to },
    block,
    innerOffset,
    selected.length
  )
  return { text: insertedText, from: insertedFrom, to: insertedFrom + selected.length }
}

const tableSkeleton = "||~ Heading 1 ||~ Heading 2 ||\n|| Cell 1 || Cell 2 ||"
const tableFirstCellOffset = tableSkeleton.indexOf("Heading 1")

const insertLink = (
  input: EditorTextTransformInput,
  target: string | undefined
): EditorTextTransformResult | null => {
  const normalizedTarget = target?.trim()
  if (!normalizedTarget) return null
  const { text, from, to } = normalizedRange(input)
  const selected = text.slice(from, to)
  const replacement = selected
    ? `[[[${normalizedTarget}|${selected}]]]`
    : `[[[${normalizedTarget}]]]`
  const end = from + replacement.length
  return replaceRange({ text, from, to }, replacement, end, end)
}

const insertImage = (
  input: EditorTextTransformInput,
  source: string | undefined
): EditorTextTransformResult | null => {
  const normalizedSource = source?.trim()
  if (!normalizedSource) return null
  const { text, from, to } = normalizedRange(input)
  const replacement = `[[image ${normalizedSource}]]`
  const end = from + replacement.length
  return replaceRange({ text, from, to }, replacement, end, end)
}

// Toolbar operations transform source text only; they never represent rendered output.
export const applyToolbarOperation = (
  input: EditorTextTransformInput,
  operation: ToolbarOperationId,
  options: ToolbarOperationOptions = {}
): EditorTextTransformResult | null => {
  if (operation.startsWith("heading")) {
    return transformHeading(input, Number(operation.slice("heading".length)))
  }

  switch (operation) {
    case "bold":
      return wrapInline(input, "**")
    case "italic":
      return wrapInline(input, "//")
    case "strike":
      return wrapInline(input, "--")
    case "teletype":
      return wrapInline(input, "{{", "}}")
    case "quote":
      return transformPrefixedLines(input, "> ", /^> ?/u)
    case "bullet-list":
      return transformPrefixedLines(input, "* ", /^\* /u)
    case "numbered-list":
      return transformPrefixedLines(input, "# ", /^# /u)
    case "horizontal-rule":
      return insertBlock(input, "----", 4)
    case "raw":
      return wrapInline(input, "@@")
    case "link":
      return insertLink(input, options.linkTarget)
    case "image":
      return insertImage(input, options.imageSource)
    case "table":
      return insertBlock(input, tableSkeleton, tableFirstCellOffset, "Heading 1".length)
    case "code":
      return wrapBlock(input, "[[code]]", "[[/code]]")
    case "footnote":
      return wrapInline(input, "[[footnote]]", "[[/footnote]]")
    case "math":
      return wrapBlock(input, "[[math]]", "[[/math]]")
    case "inline-math":
      return wrapInline(input, "[[$ ", " $]]")
    default:
      return null
  }
}
