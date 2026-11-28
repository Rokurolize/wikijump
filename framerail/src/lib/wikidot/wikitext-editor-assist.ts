import {
  autocompletion,
  closeCompletion,
  snippetCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from "@codemirror/autocomplete"
import { linter, type Diagnostic } from "@codemirror/lint"
import { Prec, type Text } from "@codemirror/state"
import { hoverTooltip, keymap, type EditorView, type Tooltip } from "@codemirror/view"

import catalog from "./wikitext-catalog.json" with { type: "json" }

type CatalogBlock = (typeof catalog)["blocks"][number]
type CatalogModule = (typeof catalog)["modules"][number]
type CatalogArgument = {
  name: string
  type: string
  description: string
  default?: string | boolean | number
  values?: string[]
  minValue?: number
  maxValue?: number
}

const argumentsOf = (entry: CatalogBlock | CatalogModule): readonly CatalogArgument[] =>
  entry.arguments as readonly CatalogArgument[]

export type WikitextHover = {
  kind: "block" | "module" | "argument"
  title: string
  detail: string
  description: string
  from: number
  to: number
}

type Owner = {
  kind: "block" | "module"
  entry: CatalogBlock | CatalogModule
}

type CompletionTarget = {
  kind: "blocks" | "modules" | "arguments" | "values"
  from: number
  prefix: string
  owner?: Owner
  argument?: CatalogArgument
}

const HEURISTIC_PREFIX = "Editor heuristic (not a render error):"
const MAX_HEURISTICS = 24

const blockByName = new Map<string, CatalogBlock>()
const moduleByName = new Map<string, CatalogModule>()
for (const block of catalog.blocks) {
  for (const name of block.names) blockByName.set(name.toLowerCase(), block)
}
for (const module of catalog.modules) {
  for (const name of module.names) moduleByName.set(name.toLowerCase(), module)
}

const argumentDetail = (argument: CatalogArgument) => {
  const parts = [`type: ${argument.type}`]
  if ("values" in argument && Array.isArray(argument.values)) {
    parts.push(`one of ${argument.values.join(", ")}`)
  }
  if ("default" in argument) parts.push(`default: ${String(argument.default)}`)
  return parts.join(" · ")
}

const entryInfo = (entry: CatalogBlock | CatalogModule) =>
  [entry.description, `body: ${entry.body}`, "head" in entry ? `head: ${entry.head}` : ""]
    .filter(Boolean)
    .join("\n")

const activeOpener = (text: string, offset: number): number | null => {
  const opener = text.lastIndexOf("[[", Math.max(0, offset - 1))
  if (opener === -1) return null
  const head = text.slice(opener + 2, offset)
  if (head.includes("]]") || head.startsWith("!--") || head.startsWith("[")) return null
  return opener
}

const headInfo = (doc: Text, position: number) => {
  const line = doc.lineAt(position)
  const offset = position - line.from
  const opener = activeOpener(line.text, offset)
  if (opener === null) return null
  const headStart = line.from + opener + 2
  return {
    headOffset: position - headStart,
    headStart,
    head: line.text.slice(opener + 2, offset)
  }
}

const ownerForName = (name: string, kind: "block" | "module"): Owner | null => {
  const entry =
    kind === "module"
      ? moduleByName.get(name.toLowerCase())
      : blockByName.get(name.toLowerCase())
  return entry ? { kind, entry } : null
}

const byPrefix = <T>(names: Map<string, T>, token: string): T | null => {
  if (names.has(token.toLowerCase())) return names.get(token.toLowerCase()) ?? null
  const matches = [...names.entries()].filter(([name]) =>
    name.startsWith(token.toLowerCase())
  )
  const distinct = new Set(matches.map(([, entry]) => entry))
  return distinct.size === 1 ? [...distinct][0] : null
}

const lastSegment = (text: string) => {
  const start = Math.max(text.lastIndexOf(" "), text.lastIndexOf("\t")) + 1
  return { text: text.slice(start), start }
}

const argumentTarget = (
  owner: Owner,
  from: number,
  segment: string,
  explicit: boolean
): CompletionTarget | null => {
  if (!explicit && segment === "") return null
  const equals = segment.indexOf("=")
  if (equals >= 0) {
    const name = segment.slice(0, equals)
    const argument = argumentsOf(owner.entry).find(
      (entry) => entry.name.toLowerCase() === name.toLowerCase()
    )
    if (argument && "values" in argument && Array.isArray(argument.values)) {
      return {
        kind: "values",
        from: from + equals + 1,
        prefix: segment.slice(equals + 1),
        argument,
        owner
      }
    }
  }
  return { kind: "arguments", from, prefix: segment.replace(/=.*$/u, ""), owner }
}

const completionTarget = (
  doc: Text,
  position: number,
  explicit: boolean
): CompletionTarget | null => {
  const info = headInfo(doc, position)
  if (!info) {
    return explicit ? { kind: "blocks", from: position, prefix: "" } : null
  }
  const { headStart, head } = info

  const moduleHead = /^module\s+/iu.exec(head)
  if (moduleHead) {
    const rest = head.slice(moduleHead[0].length)
    const segment = lastSegment(rest)
    const hasSpace = segment.start > 0
    const name = hasSpace ? rest.slice(0, segment.start).trim() : rest
    const owner = ownerForName(name, "module")
    if (!hasSpace || !owner) {
      return {
        kind: "modules",
        from: headStart + moduleHead[0].length + segment.start,
        prefix: segment.text
      }
    }
    return argumentTarget(
      owner,
      headStart + moduleHead[0].length + segment.start,
      segment.text,
      explicit
    )
  }

  const nameMatch = /^[^\s\]]+/u.exec(head)
  if (!nameMatch) {
    return explicit ? { kind: "blocks", from: headStart, prefix: "" } : null
  }
  const name = nameMatch[0]
  const after = head.slice(name.length)
  if (after === "") return { kind: "blocks", from: headStart, prefix: name }
  if (/^\s/u.test(after)) {
    const owner = ownerForName(name, "block")
    const segment = lastSegment(after)
    if (
      owner &&
      "head" in owner.entry &&
      (owner.entry.head === "map" || owner.entry.head === "value+map")
    ) {
      return argumentTarget(
        owner,
        headStart + name.length + segment.start,
        segment.text,
        explicit
      )
    }
  }
  return explicit ? { kind: "blocks", from: headStart, prefix: name } : null
}

const argumentCompletion = (argument: CatalogArgument): Completion => {
  const firstValue =
    "values" in argument && Array.isArray(argument.values)
      ? String(argument.values[0])
      : ""
  return snippetCompletion(`${argument.name}="${firstValue}"`, {
    label: argument.name,
    type: "property",
    detail: argumentDetail(argument),
    info: argument.description || `Argument ${argument.name} (${argument.type})`
  })
}

const blockCompletions = (): Completion[] => {
  const options: Completion[] = []
  for (const block of catalog.blocks) {
    for (const name of block.names) {
      options.push({
        label: name,
        type: "keyword",
        detail: `block · body: ${block.body}`,
        info: entryInfo(block)
      })
      if (block.body === "elements" && !block.special) {
        options.push(
          snippetCompletion(`${name}]]\n\${}\n[[/${name}]]`, {
            label: `${name} (paired)`,
            type: "keyword",
            detail: `paired block · ${name}`,
            info: entryInfo(block)
          })
        )
      }
    }
  }
  for (const module of catalog.modules) {
    for (const name of module.names) {
      options.push(
        snippetCompletion(`module ${name}`, {
          label: `module ${name}`,
          type: "keyword",
          detail: "module",
          info: entryInfo(module)
        })
      )
    }
  }
  return options
}

const syntaxCompletions = (): Completion[] =>
  catalog.syntax.map((entry) =>
    snippetCompletion(entry.insert, {
      label: entry.label,
      type: "text",
      detail: "Wikidot syntax",
      info: `${entry.description}\nPinned FTML source: ${entry.source}`
    })
  )

export const wikitextCompletionSource = async (
  context: CompletionContext
): Promise<CompletionResult | null> => {
  const target = completionTarget(context.state.doc, context.pos, context.explicit)
  if (!target) return null
  if (!context.explicit && !target.prefix && target.kind !== "arguments") return null

  let options: Completion[]
  switch (target.kind) {
    case "modules":
      options = catalog.modules.flatMap((module) =>
        module.names.map((name) =>
          snippetCompletion(name, {
            label: name,
            type: "keyword",
            detail: "module",
            info: entryInfo(module)
          })
        )
      )
      break
    case "arguments":
      options = target.owner
        ? argumentsOf(target.owner.entry).map(argumentCompletion)
        : []
      break
    case "values":
      options =
        target.argument &&
        "values" in target.argument &&
        Array.isArray(target.argument.values)
          ? target.argument.values.map((value) => ({
              label: String(value),
              type: "constant"
            }))
          : []
      break
    default:
      options =
        context.explicit && target.from === context.pos
          ? [...syntaxCompletions(), ...blockCompletions()]
          : blockCompletions()
  }
  if (options.length === 0) return null
  return {
    from: target.from,
    to: context.pos,
    options,
    validFor: /^[^\s\]]*$/u
  }
}

export const wikitextHoverAt = (doc: Text, position: number): WikitextHover | null => {
  const info = headInfo(doc, position)
  if (!info) return null
  const { headStart, head } = info
  const line = doc.lineAt(position)
  const cursor = position - line.from
  const isWord = (character: string | undefined) =>
    character !== undefined && /[A-Za-z0-9_<>-]/u.test(character)
  let start = cursor
  while (start > 0 && isWord(line.text[start - 1])) start -= 1
  let end = cursor
  while (end < line.text.length && isWord(line.text[end])) end += 1
  const word = line.text.slice(start, end)
  const wordFrom = line.from + start
  const wordTo = line.from + end
  if (!word || wordFrom < headStart) return null

  const moduleHead = /^module\s+/iu.exec(head)
  if (moduleHead && wordFrom >= headStart + moduleHead[0].length) {
    const entry = byPrefix(moduleByName, word)
    if (!entry) return null
    return {
      kind: "module",
      title: entry.key,
      detail: `Module · arguments: ${entry.arguments.map((arg) => arg.name).join(", ") || "none"}`,
      description: entry.description || `Module ${entry.key}.`,
      from: wordFrom,
      to: wordTo
    }
  }

  const nameMatch = /^[^\s\]]+/u.exec(head)
  if (!nameMatch) return null
  if (wordFrom === headStart) {
    const block = byPrefix(blockByName, word)
    if (!block) return null
    return {
      kind: "block",
      title: block.key,
      detail: `Block · head: ${block.head} · body: ${block.body}`,
      description: entryInfo(block),
      from: wordFrom,
      to: wordTo
    }
  }
  if (wordFrom > headStart + nameMatch[0].length) {
    const block = ownerForName(nameMatch[0], "block")?.entry
    if (!block) return null
    const candidates = argumentsOf(block).filter((entry) =>
      entry.name.toLowerCase().startsWith(word.toLowerCase())
    )
    const argument = candidates.length === 1 ? candidates[0] : undefined
    if (!argument) return null
    return {
      kind: "argument",
      title: `${nameMatch[0]}.${argument.name}`,
      detail: argumentDetail(argument),
      description:
        argument.description || `Argument ${argument.name} of ${nameMatch[0]}.`,
      from: wordFrom,
      to: wordTo
    }
  }
  return null
}

const wikitextHoverTooltip = (
  view: EditorView,
  position: number,
  side: -1 | 1
): Tooltip | null => {
  const doc = view.state.doc
  const near = side === -1 ? position - 1 : position
  const hover =
    wikitextHoverAt(doc, near) ??
    wikitextHoverAt(doc, Math.max(0, near - 1)) ??
    wikitextHoverAt(doc, Math.min(doc.length, near + 1))
  if (!hover || hover.from === hover.to) return null
  return {
    pos: hover.from,
    end: hover.to,
    above: true,
    create: () => {
      const dom = document.createElement("div")
      dom.className = `wikitext-assist-hover wikitext-assist-hover-${hover.kind}`
      const title = document.createElement("div")
      title.className = "wikitext-assist-hover-title"
      title.textContent = `${hover.title} — ${hover.kind}`
      const detail = document.createElement("div")
      detail.className = "wikitext-assist-hover-detail"
      detail.textContent = hover.detail
      const description = document.createElement("div")
      description.className = "wikitext-assist-hover-description"
      description.textContent = hover.description
      dom.append(title, detail, description)
      return { dom }
    }
  }
}

export const wikitextHeuristics = (doc: Text): Diagnostic[] => {
  const diagnostics: Diagnostic[] = []
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number)
    const text = line.text
    const moduleMatch = /\[\[module\s+([^\s\]]+)/iu.exec(text)
    if (moduleMatch && !moduleByName.has(moduleMatch[1].toLowerCase())) {
      diagnostics.push({
        from: line.from + moduleMatch.index,
        to: line.from + moduleMatch.index + moduleMatch[0].length,
        severity: "warning",
        markClass: "cm-wikitext-heuristic",
        source: "wikitext-editor-heuristic",
        message: `${HEURISTIC_PREFIX} ${moduleMatch[1]} is not in the FTML module catalog; application-provided modules may still be valid.`
      })
      if (diagnostics.length >= MAX_HEURISTICS) break
    }
    const opener = activeOpener(text, text.length)
    if (opener === null) continue
    const head = text.slice(opener + 2)
    if (/^\s*$/u.test(head)) continue
    diagnostics.push({
      from: line.from + opener,
      to: line.from + opener + 2,
      severity: "warning",
      markClass: "cm-wikitext-heuristic",
      source: "wikitext-editor-heuristic",
      message: `${HEURISTIC_PREFIX} this [[ opener has no closing ]] on its line; multi-line and literal blocks can be valid.`
    })
    if (diagnostics.length >= MAX_HEURISTICS) break
  }
  return diagnostics
}

const wikitextLintSource = (view: EditorView): Diagnostic[] =>
  wikitextHeuristics(view.state.doc)

export const wikitextAssistExtensions = [
  autocompletion({
    override: [wikitextCompletionSource],
    activateOnTyping: true,
    closeOnBlur: true,
    icons: false
  }),
  hoverTooltip(wikitextHoverTooltip),
  linter(wikitextLintSource, { delay: 600 }),
  Prec.high(
    keymap.of([
      { key: "Mod-Space", run: startCompletion },
      { key: "Escape", run: closeCompletion }
    ])
  )
]
