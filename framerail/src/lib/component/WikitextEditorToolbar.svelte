<script lang="ts">
  import {
    toolbarOperations,
    type ToolbarOperationId
  } from "$lib/wikidot/wikitext-editor-toolbar"

  let {
    onOperate
  }: {
    onOperate: (operation: ToolbarOperationId) => void
  } = $props()
</script>

<div
  class="wikitext-editor-toolbar"
  role="toolbar"
  aria-label="Wikitext source editing toolbar"
>
  <div class="wikitext-editor-toolbar-buttons">
    {#each toolbarOperations as operation (operation.id)}
      <button
        type="button"
        data-editor-action={operation.id}
        aria-label={operation.accessibleLabel}
        aria-keyshortcuts={operation.shortcut?.aria}
        title={operation.shortcut
          ? `${operation.accessibleLabel} (${operation.shortcut.display})`
          : operation.accessibleLabel}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => onOperate(operation.id)}>{operation.label}</button
      >
    {/each}
  </div>
  <p class="wikitext-editor-toolbar-note">
    Source editing: buttons insert or wrap Wikidot source; they do not create WYSIWYG
    output, and the text source remains authoritative. Shortcuts: Ctrl/Cmd+B bold,
    Ctrl/Cmd+I italic, Ctrl/Cmd+K link. Other shortcuts are listed in button tooltips.
  </p>
</div>
