import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { CompletionContext } from "@codemirror/autocomplete"
import { EditorState } from "@codemirror/state"

import catalog from "../src/lib/wikidot/wikitext-catalog.json" with { type: "json" }
import {
  wikitextCompletionSource,
  wikitextHeuristics,
  wikitextHoverAt
} from "../src/lib/wikidot/wikitext-editor-assist.ts"

const stateFor = (document: string) => EditorState.create({ doc: document })

const completionsAt = async (document: string, position: number, explicit: boolean) =>
  wikitextCompletionSource(new CompletionContext(stateFor(document), position, explicit))

test("the committed catalog comes from the FTML revision Deepwell pins", () => {
  const manifest = readFileSync(
    new URL("../../deepwell/Cargo.toml", import.meta.url),
    "utf8"
  )
  const pins = [
    ...manifest.matchAll(/ftml\s*=\s*\{[^}]*rev\s*=\s*"([0-9a-f]+)"[^}]*\}/gu)
  ].map((match) => match[1])
  assert.equal(pins.length, 2)
  assert.equal(new Set(pins).size, 1)
  assert.equal(catalog.source.revision.startsWith(pins[0]), true)
  assert.equal(catalog.source.revision.length, 40)
  assert.ok(catalog.blocks.length >= 60)
  assert.ok(catalog.modules.length >= 9)
})

test("block and module completions come from the generated metadata", async () => {
  const explicit = await completionsAt("", 0, true)
  const labels = explicit?.options.map((option) => option.label) ?? []
  assert.ok(labels.includes("div"))
  assert.ok(labels.includes("collapsible"))
  assert.ok(labels.includes("module Rate"))
  assert.ok(labels.includes("**strong text**"))

  const automaticBlock = await completionsAt("[[di", 4, false)
  const blockLabels = automaticBlock?.options.map((option) => option.label) ?? []
  assert.ok(blockLabels.includes("div"))
  assert.ok(blockLabels.includes("div (paired)"))
  assert.equal(automaticBlock?.from, 2)

  const automaticModule = await completionsAt("[[module Ra", 11, false)
  assert.ok(automaticModule?.options.some((option) => option.label === "Rate"))
  assert.ok(automaticModule?.options.some((option) => option.label === "Redirect"))
})

test("arguments and enum values are completed from pinned FTML metadata", async () => {
  const argumentsResult = await completionsAt("[[collapsible fol", 17, false)
  assert.deepEqual(
    argumentsResult?.options.map((option) => option.label),
    ["folded", "hide", "hideLocation", "show"]
  )
  assert.equal(argumentsResult?.from, 14)

  const valuesResult = await completionsAt('[[collapsible hideLocation="to', 30, false)
  assert.deepEqual(
    valuesResult?.options.map((option) => option.label),
    ["top", "both", "bottom", "neither"]
  )
})

test("explicit autocomplete works outside a block, automatic completion does not", async () => {
  const automatic = await completionsAt("ordinary prose ", 15, false)
  assert.equal(automatic, null)
  const explicit = await completionsAt("ordinary prose ", 15, true)
  assert.ok((explicit?.options.length ?? 0) > 0)
})

test("hover help covers a block, a module, and an argument", () => {
  const block = wikitextHoverAt(stateFor("[[div]]").doc, 5)
  assert.equal(block?.kind, "block")
  assert.equal(block?.title, "div")
  assert.match(String(block?.detail), /body: elements/u)

  const module = wikitextHoverAt(stateFor("[[module Rate]]").doc, 13)
  assert.equal(module?.kind, "module")
  assert.equal(module?.title, "Rate")

  const argument = wikitextHoverAt(stateFor('[[collapsible folded="true"]]').doc, 20)
  assert.equal(argument?.kind, "argument")
  assert.equal(argument?.title, "collapsible.folded")
  assert.match(String(argument?.detail), /type: bool/u)
})

test("diagnostics are heuristic warnings with an explicit not-a-render-error label", () => {
  const diagnostics = wikitextHeuristics(stateFor("[[module NotARealModule]]\n[[div").doc)
  assert.equal(diagnostics.length, 2)
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.severity, "warning")
    assert.equal(diagnostic.markClass, "cm-wikitext-heuristic")
    assert.match(diagnostic.message, /Editor heuristic \(not a render error\)/u)
  }
  assert.deepEqual(wikitextHeuristics(stateFor("[[div]]\nplain **bold**").doc), [])
})

test("broken wikitext degrades gracefully in completion, hover, and diagnostics", async () => {
  const broken = [
    "[[",
    "[[[[[",
    "[[module",
    '[[div class="unclosed',
    "[!-- unclosed comment [[module Ghost",
    "]]] stray [[[",
    '[[collapsible hideLocation="',
    "[[module ".repeat(80),
    "[[".repeat(200)
  ]
  for (const document of broken) {
    const state = stateFor(document)
    for (let position = 0; position <= document.length; position += 1) {
      assert.doesNotThrow(() => {
        void wikitextCompletionSource(new CompletionContext(state, position, false))
        void wikitextHoverAt(state.doc, position)
        void wikitextHeuristics(state.doc)
      })
    }
  }
  const bounded = wikitextHeuristics(stateFor("[[module ".repeat(200)).doc)
  assert.ok(bounded.length <= 24)
  assert.ok(bounded.every((diagnostic) => diagnostic.severity !== "error"))
})
