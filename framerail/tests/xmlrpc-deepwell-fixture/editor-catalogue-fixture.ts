import { readFileSync } from "node:fs"

import {
  editorEnglishLabels,
  editorLabelKeys,
  interpolateEditorLabel,
  type EditorCatalogue
} from "../../src/lib/wikidot/editor-labels.ts"

const parseCatalogue = (locale: string, domain: string): EditorCatalogue => {
  const source = readFileSync(
    new URL(`../../../locales/fluent/${domain}/${locale}.ftl`, import.meta.url),
    "utf8"
  )
  const catalogue: EditorCatalogue = {}
  for (const line of source.split("\n")) {
    const match = /^([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(.+)$/u.exec(line)
    if (match) catalogue[match[1]] = match[2].trim()
  }
  return catalogue
}

const loadCatalogue = (locale: string): EditorCatalogue => ({
  ...parseCatalogue(locale, "base"),
  ...parseCatalogue(locale, "wiki-page")
})

const catalogues: Record<string, EditorCatalogue> = {
  en: loadCatalogue("en"),
  ja: loadCatalogue("ja")
}

const englishByKey = new Map<string, string>(
  Object.entries(editorLabelKeys).map(([id, key]) => [
    key,
    editorEnglishLabels[id as keyof typeof editorEnglishLabels]
  ])
)

export const editorFixtureKeys = new Set<string>(Object.values(editorLabelKeys))

export const resolveEditorFixtureLabel = (
  key: string,
  japanese: boolean,
  variables: Record<string, string | number> = {}
): string => {
  const catalogue = japanese ? catalogues.ja : catalogues.en
  const template =
    catalogue[key] && catalogue[key] !== key
      ? catalogue[key]
      : (catalogues.en[key] ?? englishByKey.get(key) ?? key)
  return interpolateEditorLabel(template, variables)
}
