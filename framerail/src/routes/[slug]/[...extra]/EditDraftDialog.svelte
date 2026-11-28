<script lang="ts">
  import { currentEditorLabels } from "$lib/wikidot/editor-labels-client"
  import type { EditorLabels } from "$lib/wikidot/editor-labels"
  import { focusDialog } from "$lib/util/editor-focus"
  import { onDestroy, onMount } from "svelte"

  let {
    title,
    onRestore,
    onDiscard,
    onDismiss,
    labels = currentEditorLabels()
  }: {
    title: string
    onRestore: () => void
    onDiscard: () => void
    onDismiss?: () => void
    labels?: EditorLabels
  } = $props()

  let dialog = $state<HTMLDivElement>()
  let restoreFocus: (() => void) | undefined

  onMount(() => {
    if (dialog) restoreFocus = focusDialog(dialog)
  })

  onDestroy(() => {
    restoreFocus?.()
  })

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !onDismiss) return
    event.preventDefault()
    onDismiss()
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet body()}
  <h1 id="edit-draft-dialog-title">{labels.draftTitle}</h1>
  <p>
    {labels.draftDescription}
  </p>
  <p>{labels.draftTitleLabel} <strong>{title}</strong></p>
  <p>
    {labels.draftChoice}
  </p>
{/snippet}

{#snippet buttons()}
  <button class="btn btn-primary" onclick={onRestore} type="button">
    {labels.draftRestore}
  </button>
  <button class="btn btn-danger" onclick={onDiscard} type="button">
    {labels.draftDiscard}
  </button>
{/snippet}

<div class="modal-container" role="presentation">
  <div
    class="modal edit-draft-dialog"
    bind:this={dialog}
    aria-labelledby="edit-draft-dialog-title"
    aria-modal="true"
    role="dialog"
    tabindex="-1"
  >
    <div class="modal-message">
      {@render body()}
    </div>
    <div class="button-bar">
      {@render buttons()}
    </div>
  </div>
</div>

<style lang="scss">
  .modal-container {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 100;
    width: 100%;
    height: 100%;
    text-align: center;
    background-color: #57575788;
  }

  .modal-container > .modal {
    display: inline-block;
    width: 30%;
    max-height: 70vh;
    padding: 10px;
    margin: 20vh auto;
    overflow: auto;
    color: var(--wj-text);
    text-align: center;
    background-color: var(--wj-background);
    border: 1px solid var(--wj-border);
    border-radius: 10px;
  }

  .modal-container > .modal h1 {
    margin-top: 0;
    font-size: 1.2em;
  }

  @media (width <= 480px), (pointer: coarse) {
    .modal-container > .modal {
      width: min(92vw, 26rem);
      margin-block: 10vh;
    }

    .modal-container > .modal button {
      min-height: 2.75rem;
    }
  }
</style>
