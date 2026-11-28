import { page } from "$app/state"

import {
  buildEditorLabels,
  interpolateEditorLabel,
  type EditorCatalogue,
  type EditorLabelId,
  type EditorLabels
} from "./editor-labels"

export const currentEditorLabels = (): EditorLabels =>
  buildEditorLabels(
    (page.data?.internationalization ??
      page.error?.internationalization ??
      {}) as EditorCatalogue
  )

export const formatEditorLabel = (
  labels: EditorLabels,
  id: EditorLabelId,
  variables: Record<string, string | number> = {}
): string => interpolateEditorLabel(labels[id], variables)
