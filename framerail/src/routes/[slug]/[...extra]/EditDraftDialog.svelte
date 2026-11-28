<script lang="ts">
  let {
    title,
    onRestore,
    onDiscard
  }: {
    title: string
    onRestore: () => void
    onDiscard: () => void
  } = $props()
</script>

{#snippet body()}
  <h1 id="edit-draft-dialog-title">A saved draft is available</h1>
  <p>
    A draft exists for this page. It has not been published as a revision, and the current
    page text is still in the editor.
  </p>
  <p>Draft title: <strong>{title}</strong></p>
  <p>
    You can restore the draft into the editor or discard it. The draft will not be changed
    until you choose.
  </p>
{/snippet}

{#snippet buttons()}
  <button class="btn btn-primary" onclick={onRestore} type="button">
    Restore draft
  </button>
  <button class="btn btn-danger" onclick={onDiscard} type="button">
    Discard draft
  </button>
{/snippet}

<div class="modal-container" role="presentation">
  <div
    class="modal edit-draft-dialog"
    aria-describedby="edit-draft-dialog-title"
    role="dialog"
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
    padding: 10px;
    margin: 20vh auto;
    max-height: 70vh;
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
</style>
