import assert from "node:assert/strict"
import test from "node:test"

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import { classHighlighter, highlightTree } from "@lezer/highlight"

import { wikitextEditorLanguage } from "../src/lib/wikidot/wikitext-editor-language.ts"

const highlightedTokens = (document: string) => {
  const state = EditorState.create({
    doc: document,
    extensions: [wikitextEditorLanguage.extension]
  })
  const tree = ensureSyntaxTree(state, document.length, 1000) ?? syntaxTree(state)
  const tokens: { text: string; classes: string }[] = []
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    tokens.push({ text: document.slice(from, to), classes })
  })
  return tokens
}

test("the editor presentation lexer marks common Wikidot-shaped constructs", () => {
  const tokens = highlightedTokens(
    [
      "+ Heading",
      "",
      "[[include component:x]]",
      "[[module Rate]]",
      "[[div]]",
      "[[/div]]",
      "[[[page|label]]",
      "[https://example.test label]",
      "**bold** //italic//",
      "[!-- one",
      "two --]",
      "%%title%% {$variable}"
    ].join("\n")
  )

  assert.deepEqual(
    tokens.map(({ classes }) => classes),
    [
      "tok-heading",
      "tok-keyword",
      "tok-keyword",
      "tok-keyword",
      "tok-keyword",
      "tok-link",
      "tok-link",
      "tok-strong",
      "tok-emphasis",
      "tok-comment",
      "tok-comment",
      "tok-meta",
      "tok-meta"
    ]
  )
  assert.equal(tokens[0].text, "+ Heading")
  assert.equal(tokens[1].text, "[[include component:x]]")
  assert.equal(tokens[5].text, "[[[page|label]]")
  assert.equal(tokens[9].text, "[!-- one")
  assert.equal(tokens[10].text, "two --]")
})

test("the presentation lexer leaves ordinary text unmarked", () => {
  assert.deepEqual(highlightedTokens("plain text\nhttps://example.test/path"), [])
})
