<script lang="ts">
  import { getPageLayoutContext } from "$lib/layout/page-layout-context"
  import { Layout } from "$lib/types"
  import {
    currentEditorLabels,
    formatEditorLabel
  } from "$lib/wikidot/editor-labels-client"
  import type { EditorLabels } from "$lib/wikidot/editor-labels"
  import { focusDialog } from "$lib/util/editor-focus"
  import { onDestroy, onMount } from "svelte"

  import type { EditLeaseConflict } from "$lib/wikidot/wikidot-edit-lease.js"

  export type EditLeaseDialogKind = "conflict" | "page_changed" | "other_locks"

  let {
    kind,
    conflicts = [],
    onForce,
    onCancel,
    onViewPage,
    onReload,
    onCopyText,
    onReacquire,
    onLeave,
    onClose,
    labels = currentEditorLabels()
  }: {
    kind: EditLeaseDialogKind
    conflicts?: EditLeaseConflict[]
    onForce?: () => void
    onCancel?: () => void
    onViewPage?: () => void
    onReload?: () => void
    onCopyText?: () => void
    onReacquire?: () => void
    onLeave?: () => void
    onClose?: () => void
    labels?: EditorLabels
  } = $props()

  const pageLayoutContext = getPageLayoutContext()
  let dialog = $state<HTMLDivElement>()
  let restoreFocus: (() => void) | undefined

  onMount(() => {
    if (dialog) restoreFocus = focusDialog(dialog)
  })

  onDestroy(() => {
    restoreFocus?.()
  })

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    const dismiss = onClose ?? onCancel
    if (!dismiss) return
    event.preventDefault()
    dismiss()
  }

  const formatRemaining = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return `${minutes}:${String(rest).padStart(2, "0")}`
  }

  const modeLabel = (conflict: EditLeaseConflict): string =>
    conflict.mode === "section"
      ? `section ${conflict.sectionIndex ?? ""}`.trim()
      : conflict.mode
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet body()}
  {#if kind === "conflict"}
    <h1 id="edit-lease-dialog-title">{labels.leaseTitleConflict}</h1>
    <p>
      {labels.leaseConflictDescription}
    </p>
    <ul class="edit-lease-conflicts">
      {#each conflicts as conflict (conflict.userId + conflict.mode)}
        <li>
          {formatEditorLabel(labels, "leaseConflictUser", {
            user: conflict.userId,
            mode: modeLabel(conflict),
            remaining: formatRemaining(conflict.secondsRemaining)
          })}
        </li>
      {/each}
    </ul>
    <p>
      {labels.leaseConflictChoice}
    </p>
  {:else if kind === "page_changed"}
    <h1 id="edit-lease-dialog-title">{labels.leaseTitleChanged}</h1>
    <p>
      {labels.leaseChangedDescription}
    </p>
    <p>
      {labels.leaseChangedChoice}
    </p>
  {:else}
    <h1 id="edit-lease-dialog-title">{labels.leaseTitleTaken}</h1>
    <p>
      {labels.leaseTakenDescription}
    </p>
  {/if}
{/snippet}

{#snippet buttons()}
  {#if kind === "conflict"}
    <button class="btn btn-primary" onclick={onForce} type="button">
      {labels.leaseEditAnyway}
    </button>
    <button class="btn btn-danger" onclick={onCancel} type="button">
      {labels.leaseCancel}
    </button>
  {:else if kind === "page_changed"}
    <button class="btn btn-primary" onclick={onViewPage} type="button">
      {labels.leaseViewPage}
    </button>
    <button class="btn" onclick={onReload} type="button">
      {labels.leaseReload}
    </button>
    {#if onCopyText}
      <button class="btn" onclick={onCopyText} type="button">
        {labels.leaseCopyText}
      </button>
    {/if}
    <button class="btn btn-danger" onclick={onClose} type="button">
      {labels.leaseClose}
    </button>
  {:else}
    <button class="btn btn-primary" onclick={onReacquire} type="button">
      {labels.takeLockBack}
    </button>
    <button class="btn" onclick={onLeave} type="button">
      {labels.leaseLeave}
    </button>
    <button class="btn btn-danger" onclick={onClose} type="button">
      {labels.leaseClose}
    </button>
  {/if}
{/snippet}

{#if pageLayoutContext.current === Layout.WIKIDOT}
  <div id="odialog-shader" class="odialog-shader"></div>
  <div id="odialog-container" style:display="block" class="odialog-container">
    <div
      id="owindow-1"
      class="owindow edit-lease-dialog"
      bind:this={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-lease-dialog-title"
      tabindex="-1"
    >
      <div class="title modal-header">{labels.leaseDialogTitle}</div>
      <div class="content modal-body">
        {@render body()}
      </div>
      <div class="button-bar modal-footer">
        {@render buttons()}
      </div>
    </div>
  </div>
{:else}
  <div class="modal-container" role="presentation">
    <div
      class="modal edit-lease-dialog"
      bind:this={dialog}
      aria-labelledby="edit-lease-dialog-title"
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
{/if}

<style lang="scss">
  .edit-lease-conflicts {
    text-align: start;
  }

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
    padding: 10px;
    margin: 40vh auto;
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
