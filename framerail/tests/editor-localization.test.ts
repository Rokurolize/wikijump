import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildEditorLabels,
  editorEnglishLabels,
  editorLabelKeys,
  interpolateEditorLabel,
  type EditorCatalogue
} from "../src/lib/wikidot/editor-labels.ts"

const catalogueRoot = new URL("../../locales/fluent/base/", import.meta.url)
const locales = ["en", "ja", "ko", "pl", "vi", "zh_Hans"]
const catalogueKeys = new Set(["wiki-page-source", "preview", "cancel", "save"])
type EditorLabelId = keyof typeof editorEnglishLabels

const parseCatalogue = (locale: string): EditorCatalogue => {
  const source = readFileSync(new URL(`${locale}.ftl`, catalogueRoot), "utf8")
  const catalogue: EditorCatalogue = {}
  for (const line of source.split("\n")) {
    const match = /^([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(.+)$/u.exec(line)
    if (match) catalogue[match[1]] = match[2].trim()
  }
  return catalogue
}

test("every editor string has a catalogue entry in every UI locale", () => {
  for (const locale of locales) {
    const catalogue = parseCatalogue(locale)
    for (const [rawId, key] of Object.entries(editorLabelKeys)) {
      const id = rawId as EditorLabelId
      if (catalogueKeys.has(key)) continue
      const value = catalogue[key]
      assert.equal(typeof value, "string", `${locale} is missing ${key}`)
      assert.ok(value!.length > 0, `${locale} has an empty value for ${key}`)
      if (locale === "en") {
        assert.equal(value, editorEnglishLabels[id])
      }
    }
  }
})

test("editor label resolution falls back to English without leaking identifiers", () => {
  const empty = buildEditorLabels({})
  for (const [rawId, key] of Object.entries(editorLabelKeys)) {
    const id = rawId as EditorLabelId
    assert.equal(empty[id], editorEnglishLabels[id])
    assert.notEqual(empty[id], key)
  }

  const transformed = buildEditorLabels({
    "editor-preview-current": "Custom current preview",
    "editor-toolbar-note": "editor-toolbar-note"
  })
  assert.equal(transformed.previewCurrent, "Custom current preview")
  assert.equal(transformed.toolbarNote, editorEnglishLabels.toolbarNote)
})

test("each locale resolves editor labels through its catalogue without raw identifiers", () => {
  for (const locale of locales) {
    const catalogue = parseCatalogue(locale)
    const labels = buildEditorLabels(catalogue)
    for (const [rawId, key] of Object.entries(editorLabelKeys)) {
      const id = rawId as EditorLabelId
      assert.notEqual(labels[id], key, `${locale} leaked ${key}`)
      assert.ok(labels[id].length > 0)
    }
  }
})

test("Fluent variables interpolate into editor statuses without altering other text", () => {
  assert.equal(
    interpolateEditorLabel(editorEnglishLabels.hintNotice, { count: 3 }),
    "Editor heuristic warnings: 3 — not render errors."
  )
  assert.equal(
    interpolateEditorLabel(editorEnglishLabels.draftSyncError, { message: "offline" }),
    "The page draft is not synchronized: offline"
  )
  assert.equal(
    interpolateEditorLabel(editorEnglishLabels.previewCurrent),
    editorEnglishLabels.previewCurrent
  )
})
