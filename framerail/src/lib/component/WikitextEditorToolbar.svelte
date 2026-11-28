<script lang="ts">
  import { currentEditorLabels } from "$lib/wikidot/editor-labels-client"
  import type { EditorLabelId, EditorLabels } from "$lib/wikidot/editor-labels"
  import {
    toolbarOperations,
    type ToolbarOperationId
  } from "$lib/wikidot/wikitext-editor-toolbar"

  let {
    onOperate,
    labels = currentEditorLabels(),
    noteId = "wikitext-editor-toolbar-note"
  }: {
    onOperate: (operation: ToolbarOperationId) => void
    labels?: EditorLabels
    noteId?: string
  } = $props()

  const labelIds: Record<ToolbarOperationId, EditorLabelId> = {
    heading1: "toolbarHeading1",
    heading2: "toolbarHeading2",
    heading3: "toolbarHeading3",
    heading4: "toolbarHeading4",
    heading5: "toolbarHeading5",
    heading6: "toolbarHeading6",
    bold: "toolbarBold",
    italic: "toolbarItalic",
    strike: "toolbarStrike",
    teletype: "toolbarTeletype",
    quote: "toolbarQuote",
    "bullet-list": "toolbarBulletedList",
    "numbered-list": "toolbarNumberedList",
    "horizontal-rule": "toolbarHorizontalRule",
    raw: "toolbarRaw",
    link: "toolbarLink",
    image: "toolbarImage",
    table: "toolbarTable",
    code: "toolbarCode",
    footnote: "toolbarFootnote",
    math: "toolbarMath",
    "inline-math": "toolbarInlineMath"
  }
</script>

<div
  class="wikitext-editor-toolbar"
  role="toolbar"
  aria-label={labels.toolbarLabel}
  aria-describedby={noteId}
>
  <div class="wikitext-editor-toolbar-buttons">
    {#each toolbarOperations as operation (operation.id)}
      <button
        type="button"
        data-editor-action={operation.id}
        aria-label={labels[labelIds[operation.id]]}
        aria-keyshortcuts={operation.shortcut?.aria}
        title={operation.shortcut
          ? `${labels[labelIds[operation.id]]} (${operation.shortcut.display})`
          : labels[labelIds[operation.id]]}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => onOperate(operation.id)}>{operation.label}</button
      >
    {/each}
  </div>
  <p class="wikitext-editor-toolbar-note" id={noteId}>
    {labels.toolbarNote}
  </p>
</div>
