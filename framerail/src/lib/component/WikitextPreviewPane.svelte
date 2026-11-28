<script lang="ts">
  import { deserialize } from "$app/forms"
  import { buildGeneratedPageStylesHead } from "$lib/generated-page-styles"
  import { onDestroy } from "svelte"

  const PREVIEW_DEBOUNCE_MS = 450
  const PREVIEW_TIMEOUT_MS = 10_000

  type PreviewStatus = "loading" | "rendering" | "current" | "stale" | "paused" | "error"

  let {
    siteId,
    title,
    wikitext,
    label = "Preview"
  }: {
    siteId: number
    title: string
    wikitext: string
    label?: string
  } = $props()

  let renderedHtml = $state("")
  let renderedStyles = $state<string[]>([])
  let renderedKey = $state<string | null>(null)
  let failedKey = $state<string | null>(null)
  let failureMessage = $state("")
  let paused = $state(false)
  let renderOutstanding = $state(false)
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let activeController: AbortController | undefined
  let requestSequence = 0

  const previewKey = (previewTitle: string, previewWikitext: string) =>
    JSON.stringify([previewTitle, previewWikitext])
  let sourceKey = $derived(previewKey(title, wikitext))
  let status = $derived<PreviewStatus>(
    paused
      ? "paused"
      : failedKey === sourceKey
        ? "error"
        : renderedKey !== sourceKey
          ? renderedKey === null
            ? "loading"
            : "stale"
          : renderOutstanding
            ? "rendering"
            : "current"
  )
  let renderedStylesHtml = $derived(
    buildGeneratedPageStylesHead(renderedStyles, ' data-live-preview-style=""')
  )
  let statusText = $derived(
    status === "paused"
      ? "Preview paused. Changes are not being rendered."
      : status === "error"
        ? "Preview failed. Editing and saving remain available."
        : status === "stale"
          ? "Preview is stale. Waiting for the latest edit to render."
          : status === "current"
            ? "Preview is up to date."
            : "Rendering preview…"
  )

  async function renderPreview(key: string) {
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    const sequence = ++requestSequence
    const requestTitle = title
    const requestWikitext = wikitext
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, PREVIEW_TIMEOUT_MS)
    renderOutstanding = true
    try {
      const response = await fetch("?/preview", {
        method: "POST",
        body: JSON.stringify({
          siteId,
          title: requestTitle,
          wikitext: requestWikitext
        }),
        signal: controller.signal
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Preview request returned HTTP ${response.status}.`)
      }
      const result = deserialize<
        { res: { body: string; styles: string[] } },
        { message: string }
      >(text)
      if (result.type !== "success" || typeof result.data?.res.body !== "string") {
        throw new Error(
          result.type === "failure" && result.data?.message
            ? result.data.message
            : "Preview request failed."
        )
      }
      if (sequence !== requestSequence || previewKey(title, wikitext) !== key) return
      renderedHtml = result.data.res.body
      renderedStyles = Array.isArray(result.data.res.styles) ? result.data.res.styles : []
      renderedKey = key
      failedKey = null
      failureMessage = ""
    } catch (error) {
      if (controller.signal.aborted && !timedOut) return
      if (sequence !== requestSequence || previewKey(title, wikitext) !== key) return
      failedKey = key
      failureMessage = timedOut
        ? "Preview render timed out."
        : error instanceof Error
          ? error.message
          : "Preview failed."
    } finally {
      clearTimeout(timeout)
      if (sequence === requestSequence) {
        renderOutstanding = false
        activeController = undefined
      }
    }
  }

  function togglePaused() {
    paused = !paused
    if (paused) {
      activeController?.abort()
      return
    }
    if (failedKey === sourceKey) {
      failedKey = null
      failureMessage = ""
    }
  }

  function retryPreview() {
    if (failedKey !== sourceKey) return
    failedKey = null
    failureMessage = ""
  }

  $effect(() => {
    const key = sourceKey
    if (paused || key === renderedKey || key === failedKey) return
    debounceTimer = setTimeout(() => {
      void renderPreview(key)
    }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(debounceTimer)
  })

  onDestroy(() => {
    clearTimeout(debounceTimer)
    activeController?.abort()
  })
</script>

<section class="wikitext-live-preview" data-preview-state={status} aria-label={label}>
  <div class="wikitext-live-preview-header">
    <h2 class="wikitext-live-preview-heading">{label}</h2>
    <div class="wikitext-live-preview-controls">
      {#if status === "error"}
        <button
          id="edit-preview-retry-button"
          type="button"
          class="wikitext-live-preview-control"
          onclick={retryPreview}
        >
          Retry preview
        </button>
      {/if}
      <button
        id="edit-preview-pause-button"
        type="button"
        class="wikitext-live-preview-control"
        aria-pressed={paused}
        onclick={togglePaused}
      >
        {paused ? "Resume preview" : "Pause preview"}
      </button>
    </div>
  </div>
  <p
    id="edit-preview-status"
    class="wikitext-live-preview-status"
    class:wikitext-live-preview-status-error={status === "error"}
    role="status"
  >
    {statusText}
  </p>
  {#if status === "error"}
    <p class="wikitext-live-preview-error" role="alert">
      Preview render failed: {failureMessage}
    </p>
  {/if}
  <div id="live-preview-body" class="wikitext-live-preview-body">
    {@html renderedHtml}
  </div>
  <div class="wikitext-live-preview-styles">{@html renderedStylesHtml}</div>
</section>

<style lang="scss">
  .wikitext-live-preview {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    margin: 1em 0 2em;
    border: 1px solid rgb(170, 170, 170);
  }

  .wikitext-live-preview-header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5em;
    align-items: center;
    justify-content: space-between;
    padding: 0.45em 0.7em;
    background: rgb(238, 238, 238);
    border-bottom: 1px solid rgb(170, 170, 170);
  }

  .wikitext-live-preview-heading {
    margin: 0;
    font-size: 1em;
  }

  .wikitext-live-preview-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em;
  }

  .wikitext-live-preview-control {
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;
  }

  .wikitext-live-preview-status {
    margin: 0;
    padding: 0.35em 0.7em;
    font-size: 0.9em;
    border-bottom: 1px solid rgb(210, 210, 210);
  }

  .wikitext-live-preview[data-preview-state="stale"] .wikitext-live-preview-status,
  .wikitext-live-preview[data-preview-state="paused"] .wikitext-live-preview-status {
    color: rgb(102, 75, 0);
    background: rgb(255, 245, 205);
  }

  .wikitext-live-preview-status-error {
    color: rgb(120, 0, 0);
    background: rgb(255, 230, 230);
  }

  .wikitext-live-preview-error {
    margin: 0;
    padding: 0.35em 0.7em;
    color: rgb(120, 0, 0);
    background: rgb(255, 230, 230);
    border-bottom: 1px solid rgb(210, 160, 160);
  }

  .wikitext-live-preview-body {
    min-height: 4em;
    padding: 0.7em;
    overflow-wrap: anywhere;
  }
</style>
