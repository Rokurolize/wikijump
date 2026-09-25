<script lang="ts">
  import { deserialize } from "$app/forms"
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { getPageLayoutContext } from "$lib/layout/page-layout-context"

  import { Layout } from "$lib/types"
  import { onDestroy, tick } from "svelte"
  import { SvelteMap } from "svelte/reactivity"

  import type { PageProps } from "./$types"
  import type {
    PageRevisionModelFiltered,
    CreatePageRevisionOutput,
    PageRevisionDiffOutput
  } from "$lib/server/deepwell/page"
  import type { Optional } from "$lib/types"
  import RevisionAuthor from "./RevisionAuthor.svelte"

  interface Props extends PageProps {
    setShowRevision: (val: boolean) => void
    setRevision: (rev: Optional<PageRevisionModelFiltered>) => void
  }

  let { setShowRevision, setRevision, data }: Props = $props()

  const pageLayoutContext = getPageLayoutContext()

  let revisionMap = new SvelteMap<number, PageRevisionModelFiltered>()
  let revision = $state<Optional<PageRevisionModelFiltered>>(undefined)
  let showRevisionSource = $state<boolean>(false)
  let fromRevisionNumber = $state<Optional<number>>(undefined)
  let toRevisionNumber = $state<Optional<number>>(undefined)
  let revisionDiff = $state<Optional<PageRevisionDiffOutput>>(undefined)
  let revisionDiffLoading = $state(false)
  let revisionDiffCompareButton = $state<HTMLButtonElement | undefined>(undefined)
  let revisionDiffRequestId = 0
  let active = true

  onDestroy(() => {
    active = false
    revisionDiffRequestId += 1
  })

  const SVELTEKIT_ACTION_HEADERS = {
    accept: "application/json",
    "content-type": "text/plain;charset=UTF-8",
    "x-sveltekit-action": "true"
  }

  async function fetchHistory() {
    const res = await fetch("?/history", {
      method: "POST",
      headers: SVELTEKIT_ACTION_HEADERS,
      body: JSON.stringify({
        siteId: data.site.site_id,
        pageId: data.page?.page_id
      })
    }).then((res) => res.text())

    const result = deserialize<
      { res: PageRevisionModelFiltered[] },
      { message: string; code: string; data: Record<string, unknown> }
    >(res)

    if (!active) return

    if (result.type === "failure" && result.data?.message) {
      errorPopupState.current = {
        state: true,
        message: result.data.message,
        data: result.data
      }
    } else if (result.type === "success" && result.data?.res) {
      revisionMap.clear()
      result.data.res.forEach((rev) => {
        revisionMap.set(rev.revision_number, rev)
      })
      const revisionNumbers = result.data.res
        .map((rev) => rev.revision_number)
        .sort((a, b) => a - b)
      if (fromRevisionNumber === undefined) {
        fromRevisionNumber = revisionNumbers.at(-2)
      }
      if (toRevisionNumber === undefined) {
        toRevisionNumber = revisionNumbers.at(-1)
      }
    }
  }

  async function fetchRevisionDiff() {
    if (fromRevisionNumber === undefined || toRevisionNumber === undefined) return

    const restoreCompareFocus = document.activeElement === revisionDiffCompareButton
    const requestedFromRevisionNumber = fromRevisionNumber
    const requestedToRevisionNumber = toRevisionNumber
    const requestId = ++revisionDiffRequestId
    revisionDiffLoading = true
    try {
      const res = await fetch("?/revisionDiff", {
        method: "POST",
        headers: SVELTEKIT_ACTION_HEADERS,
        body: JSON.stringify({
          siteId: data.site.site_id,
          pageId: data.page?.page_id,
          fromRevisionNumber: requestedFromRevisionNumber,
          toRevisionNumber: requestedToRevisionNumber
        })
      }).then((response) => response.text())

      const result = deserialize<
        { res: Optional<PageRevisionDiffOutput> },
        { message: string; code: string; data: Record<string, unknown> }
      >(res)

      if (
        !active ||
        requestId !== revisionDiffRequestId ||
        requestedFromRevisionNumber !== fromRevisionNumber ||
        requestedToRevisionNumber !== toRevisionNumber
      ) {
        return
      }

      if (result.type === "failure" && result.data?.message) {
        errorPopupState.current = {
          state: true,
          message: result.data.message,
          data: result.data
        }
      } else if (result.type === "success") {
        revisionDiff = result.data?.res
      }
    } finally {
      if (requestId === revisionDiffRequestId) {
        revisionDiffLoading = false
        if (restoreCompareFocus) {
          await tick()
          revisionDiffCompareButton?.focus()
        }
      }
    }
  }

  function clearRevisionDiff() {
    revisionDiffRequestId += 1
    revisionDiff = undefined
    revisionDiffLoading = false
  }

  function swapRevisionDiff() {
    const previousFrom = fromRevisionNumber
    fromRevisionNumber = toRevisionNumber
    toRevisionNumber = previousFrom
    clearRevisionDiff()
  }

  async function getRevision(
    revisionNumber: number,
    compiledHtml: boolean,
    wikitext: boolean
  ) {
    const rev = revisionMap.get(revisionNumber)
    // Try to see if the cached revision already has the wanted data
    if (
      compiledHtml &&
      rev?.compiled_body_html &&
      rev.compiled_body_styles !== undefined
    ) {
      setRevision(rev)
      revision = rev
    } else if (wikitext && rev?.wikitext) {
      setRevision(rev)
      revision = rev
    } else {
      const res = await fetch("?/revision", {
        method: "POST",
        headers: SVELTEKIT_ACTION_HEADERS,
        body: JSON.stringify({
          siteId: data.site.site_id,
          pageId: data.page?.page_id,
          revisionNumber,
          compiledHtml,
          wikitext
        })
      }).then((res) => res.text())

      const result = deserialize<
        { res: Optional<PageRevisionModelFiltered> },
        { message: string; code: string; data: Record<string, unknown> }
      >(res)

      if (!active) return

      if (result.type === "failure" && result.data?.message) {
        errorPopupState.current = {
          state: true,
          message: result.data.message,
          data: result.data
        }
      } else if (result.type === "success" && result.data?.res) {
        if (!rev) {
          // This is a revision we didn't even cache...?
          revisionMap.set(revisionNumber, result.data.res)
          setRevision(result.data.res)
        } else if (compiledHtml) {
          rev.compiled_body_html = result.data.res.compiled_body_html
          rev.compiled_body_styles = result.data.res.compiled_body_styles
          setRevision(rev)
          revision = rev
        } else if (wikitext) {
          rev.wikitext = result.data.res.wikitext
          setRevision(rev)
          revision = rev
        }
      }
    }
  }

  async function rollbackRevision(revisionNumber: number, comments?: string) {
    const res = await fetch("?/rollback", {
      method: "POST",
      headers: SVELTEKIT_ACTION_HEADERS,
      body: JSON.stringify({
        siteId: data.site.site_id,
        pageId: data.page?.page_id,
        revisionNumber,
        lastRevisionId: data.page_revision?.revision_id,
        comments
      })
    }).then((res) => res.text())

    const result = deserialize<
      { res: Optional<CreatePageRevisionOutput> },
      { message: string; code: string; data: Record<string, unknown> }
    >(res)

    if (!active) return

    if (result.type === "failure" && result.data?.message) {
      errorPopupState.current = {
        state: true,
        message: result.data.message,
        data: result.data
      }
    } else if (result.type === "success" && result.data?.res) {
      invalidateAll()
    }
  }

  $effect(() => {
    fetchHistory()
  })
</script>

{#if pageLayoutContext.current === Layout.WIKIDOT}
  <h1 class="page-revision-header">
    {data.internationalization?.["wiki-page-revision-history"]}
  </h1>
  <div class="revision-list">
    <table class="page-history">
      <tbody>
        <tr class="revision-header">
          <td class="revision-attribute revision-number">
            {data.internationalization?.["wiki-page-revision-number"]}
          </td>
          <td class="revision-attribute action"></td>
          <td class="revision-attribute revision-type">
            {data.internationalization?.["wiki-page-revision-type"]}
          </td>
          <td class="revision-attribute user">
            {data.internationalization?.["wiki-page-revision-user"]}
          </td>
          <td class="revision-attribute created-at">
            {data.internationalization?.["wiki-page-revision-created-at"]}
          </td>
          <td class="revision-attribute comments">
            {data.internationalization?.["wiki-page-revision-comments"]}
          </td>
        </tr>
        <!-- Here we sort the list in descending order. -->
        {#each [...revisionMap].sort((a, b) => b[0] - a[0]) as [, revisionItem] (revisionItem.revision_number)}
          <tr
            id={`revision-row-${revisionItem.revision_id}`}
            class="revision-row"
            data-id={revisionItem.revision_id}
          >
            <td class="revision-attribute revision-number" data-label={data.internationalization?.["wiki-page-revision-number"]}>
              {revisionItem.revision_number}
            </td>
            <td class="revision-attribute action optionstd">
              {#if ["create", "regular"].includes(revisionItem.revision_type)}
                <!-- svelte-ignore a11y_invalid_attribute -->
                <a
                  class="view-revision"
                  href="javascript:;"
                  onclick={(event) => {
                    event.stopPropagation()
                    getRevision(revisionItem.revision_number, true, false).then(() => {
                      if (!active) return
                      setShowRevision(true)
                      showRevisionSource = false
                    })
                  }}
                  type="button"
                >
                  V
                </a>
                <!-- svelte-ignore a11y_invalid_attribute -->
                <a
                  class="view-revision-source"
                  href="javascript:;"
                  onclick={(event) => {
                    event.stopPropagation()
                    getRevision(revisionItem.revision_number, false, true).then(() => {
                      if (!active) return
                      setShowRevision(false)
                      showRevisionSource = true
                    })
                  }}
                  type="button"
                >
                  S
                </a>
                <!-- svelte-ignore a11y_invalid_attribute -->
                <a
                  class="revision-rollback"
                  href="javascript:;"
                  onclick={(event) => {
                    event.stopPropagation()
                    rollbackRevision(revisionItem.revision_number)
                  }}
                  type="button"
                >
                  R
                </a>
              {/if}
            </td>
            <td class="revision-attribute revision-type" data-label={data.internationalization?.["wiki-page-revision-type"]}>
              {data.internationalization?.[
                `wiki-page-revision-type.${revisionItem.revision_type}`
              ]}
            </td>
            <td class="revision-attribute user" data-label={data.internationalization?.["wiki-page-revision-user"]}>
              <RevisionAuthor author={revisionItem.author} />
            </td>
            <td class="revision-attribute created-at" data-label={data.internationalization?.["wiki-page-revision-created-at"]}>
              {new Date(revisionItem.created_at).toLocaleString()}
            </td>
            <td class="revision-attribute comments" data-label={data.internationalization?.["wiki-page-revision-comments"]}>
              {revisionItem.comments}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if showRevisionSource}
    <div id="history-subarea">
      <textarea class="page-source" readonly={true}>{revision?.wikitext ?? ""}</textarea>
    </div>
  {/if}
{:else}
  <h2 class="page-revision-header">
    {data.internationalization?.["wiki-page-revision-history"]}
  </h2>
  <div class="revision-list">
    <div class="revision-header">
      <div class="revision-attribute action"></div>
      <div class="revision-attribute revision-number">
        {data.internationalization?.["wiki-page-revision-number"]}
      </div>
      <div class="revision-attribute revision-type">
        {data.internationalization?.["wiki-page-revision-type"]}
      </div>
      <div class="revision-attribute created-at">
        {data.internationalization?.["wiki-page-revision-created-at"]}
      </div>
      <div class="revision-attribute user">
        {data.internationalization?.["wiki-page-revision-user"]}
      </div>
      <div class="revision-attribute comments">
        {data.internationalization?.["wiki-page-revision-comments"]}
      </div>
    </div>
    <!-- Here we sort the list in descending order. -->
    {#each [...revisionMap].sort((a, b) => b[0] - a[0]) as [, revisionItem] (revisionItem.revision_number)}
      <div class="revision-row" data-id={revisionItem.revision_id}>
        <div class="revision-attribute action">
          {#if ["create", "regular"].includes(revisionItem.revision_type)}
            <button
              class="action-button view-revision clickable"
              onclick={(event) => {
                event.stopPropagation()
                getRevision(revisionItem.revision_number, true, false).then(() => {
                  if (!active) return
                  setShowRevision(true)
                  showRevisionSource = false
                })
              }}
              type="button"
            >
              {data.internationalization?.view}
            </button>
            <button
              class="action-button view-revision-source clickable"
              onclick={(event) => {
                event.stopPropagation()
                getRevision(revisionItem.revision_number, false, true).then(() => {
                  if (!active) return
                  setShowRevision(false)
                  showRevisionSource = true
                })
              }}
              type="button"
            >
              {data.internationalization?.["wiki-page-view-source"]}
            </button>
            <button
              class="action-button revision-rollback clickable"
              onclick={(event) => {
                event.stopPropagation()
                rollbackRevision(revisionItem.revision_number)
              }}
              type="button"
            >
              {data.internationalization?.["wiki-page-revision-rollback"]}
            </button>
          {/if}
        </div>
        <div class="revision-attribute revision-number">
          {revisionItem.revision_number}
        </div>
        <div class="revision-attribute revision-type">
          {data.internationalization?.[
            `wiki-page-revision-type.${revisionItem.revision_type}`
          ]}
        </div>
        <div class="revision-attribute created-at">
          {new Date(revisionItem.created_at).toLocaleString()}
        </div>
        <div class="revision-attribute user">
          <RevisionAuthor author={revisionItem.author} />
        </div>
        <div class="revision-attribute comments">
          {revisionItem.comments}
        </div>
      </div>
    {/each}
  </div>

  {#if showRevisionSource}
    <textarea class="revision-source" readonly={true}>{revision?.wikitext ?? ""}</textarea
    >
  {/if}
{/if}

{#if revisionMap.size >= 2}
  <section class="revision-diff-panel" aria-labelledby="revision-diff-heading">
    <h2 id="revision-diff-heading">
      {data.internationalization?.["wiki-page-revision-diff"]}
    </h2>
    <div class="revision-diff-controls">
      <label for="revision-diff-from">
        {data.internationalization?.["wiki-page-revision-diff.from"]}
      </label>
      <select
        id="revision-diff-from"
        onchange={clearRevisionDiff}
        bind:value={fromRevisionNumber}
      >
        {#each [...revisionMap.keys()].sort((a, b) => a - b) as revisionNumber (revisionNumber)}
          <option value={revisionNumber}>{revisionNumber}</option>
        {/each}
      </select>
      <label for="revision-diff-to">
        {data.internationalization?.["wiki-page-revision-diff.to"]}
      </label>
      <select
        id="revision-diff-to"
        onchange={clearRevisionDiff}
        bind:value={toRevisionNumber}
      >
        {#each [...revisionMap.keys()].sort((a, b) => a - b) as revisionNumber (revisionNumber)}
          <option value={revisionNumber}>{revisionNumber}</option>
        {/each}
      </select>
      <button class="action-button clickable" onclick={swapRevisionDiff} type="button">
        {data.internationalization?.["wiki-page-revision-diff.swap"]}
      </button>
      <button
        bind:this={revisionDiffCompareButton}
        class="action-button clickable"
        disabled={revisionDiffLoading}
        onclick={fetchRevisionDiff}
        type="button"
      >
        {revisionDiffLoading
          ? data.internationalization?.["wiki-page-revision-diff.loading"]
          : data.internationalization?.["wiki-page-revision-diff.compare"]}
      </button>
    </div>
    {#if revisionDiff}
      {#if revisionDiff.lines.length === 0}
        <p>{data.internationalization?.["wiki-page-revision-diff.no-changes"]}</p>
      {:else}
        <pre
          class="revision-diff"
          aria-live="polite">{#each revisionDiff.lines as line, lineIndex (lineIndex)}<span
              class="revision-diff-line"
              class:added={line.kind === "added"}
              class:removed={line.kind === "removed"}
              class:unchanged={line.kind === "unchanged"}
              >{line.kind === "added"
                ? "+"
                : line.kind === "removed"
                  ? "-"
                  : " "}{line.text}&#10;</span
            >{/each}</pre>
      {/if}
    {/if}
  </section>
{/if}

<style lang="scss">
  textarea.revision-source {
    width: 100%;
    height: 60vh;
  }

  .revision-list {
    display: table;
    width: 100%;

    .revision-header,
    .revision-row {
      display: table-row;

      .revision-attribute {
        display: table-cell;
      }
    }
  }

  // Themes often assume a particular fixed width for the imported Wikidot
  // History table. In the current JP action pane, that assumption squeezes
  // the author and turns the V/S/R controls into a vertical column. Give the
  // semantic columns stable minimums while leaving the theme in control of
  // colors, borders, and row decoration.
  @media (min-width: 601px) {
    :global(#action-area .revision-list .page-history) {
      display: block !important;
      width: 100% !important;
      table-layout: fixed !important;
    }

    :global(#action-area .revision-list .page-history tbody) {
      display: block !important;
      width: 100% !important;
    }

    :global(#action-area .revision-list .page-history tr.revision-header),
    :global(#action-area .revision-list .page-history tr.revision-row) {
      display: grid !important;
      grid-template-columns: minmax(3rem, auto) minmax(5.5rem, max-content) minmax(4rem, 0.65fr) minmax(7rem, 0.9fr) minmax(10rem, 1fr) minmax(12rem, 1.4fr) !important;
      // Imported themes may provide a named Wikidot grid with a fixed first
      // row and a fractional comments row. The SCP-JP semantic table has no
      // radio column, so those named areas place timestamps and comments on
      // top of each other. Reset only placement geometry; keep theme styling.
      grid-template-areas: none !important;
      grid-template-rows: auto auto !important;
      grid-auto-rows: auto !important;
      align-items: start;
      width: 100% !important;
      box-sizing: border-box;
    }

    :global(#action-area .revision-list .page-history .revision-attribute) {
      display: block !important;
      box-sizing: border-box;
      grid-area: auto !important;
      min-width: 0 !important;
      max-width: 100%;
      overflow-wrap: anywhere;
      position: static !important;
      float: none !important;
      vertical-align: top;
    }

    // Candidate themes may assign named grid areas and implicit placements
    // to the imported revision table. Those area names do not exist on the JP
    // semantic grid, so map each data column explicitly and put comments on a
    // separate full-width row. Preserve theme colors, borders and typography.
    :global(#action-area .revision-list .page-history tbody > tr.revision-row > td.revision-attribute.revision-number) {
      grid-column: 1 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-row > td.revision-attribute.action) {
      grid-column: 2 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-row > td.revision-attribute.revision-type) {
      grid-column: 3 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-row > td.revision-attribute.user) {
      grid-column: 4 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-row > td.revision-attribute.created-at) {
      grid-column: 5 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-row > td.revision-attribute.comments) {
      grid-column: 1 / -1 !important;
      grid-row: 2 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-header > td.revision-attribute.revision-number) {
      grid-column: 1 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-header > td.revision-attribute.action) {
      grid-column: 2 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-header > td.revision-attribute.revision-type) {
      grid-column: 3 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-header > td.revision-attribute.user) {
      grid-column: 4 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-header > td.revision-attribute.created-at) {
      grid-column: 5 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-header > td.revision-attribute.comments) {
      grid-column: 6 !important;
      grid-row: 1 !important;
    }

    :global(#action-area .revision-list .page-history .revision-attribute.action) {
      white-space: nowrap !important;
    }

    :global(#action-area .revision-list .page-history .revision-attribute.action a) {
      display: inline-block !important;
      min-width: 1.25rem;
      margin-inline-end: 0.15rem;
      text-align: center;
      white-space: nowrap !important;
    }

    :global(#action-area .revision-list .page-history .revision-attribute.user) {
      min-width: 7rem !important;
      overflow-wrap: normal;
    }

    :global(#action-area .revision-list .page-history tr.revision-header > *) {
      min-width: 0 !important;
      overflow-wrap: anywhere;
    }

    :global(#action-area .revision-list .page-history .revision-attribute.comments) {
      grid-column: 1 / -1;
    }
  }

  @media (min-width: 601px) and (max-width: 900px) {
    :global(#action-area .revision-list .page-history tbody > tr.revision-header),
    :global(#action-area .revision-list .page-history tbody > tr.revision-row) {
      grid-template-columns: minmax(2.5rem, auto) minmax(4rem, max-content) minmax(3rem, 0.6fr) minmax(6.5rem, 0.8fr) minmax(7rem, 1fr) minmax(5.5rem, 1.2fr) !important;
    }

    :global(#action-area .revision-list .page-history tbody > tr.revision-row > td.revision-attribute.user) {
      min-width: 6.5rem !important;
    }
  }

  @media (max-width: 600px) {
    .page-revision-header {
      // Theme action panes commonly float their shared Close control at the
      // upper-right. Clear that control so a wrapped Japanese/English heading
      // cannot flow under it or collide with the revision list.
      clear: both !important;
      max-width: 100% !important;
      box-sizing: border-box;
      white-space: normal !important;
      overflow-wrap: anywhere;
    }

    .revision-list {
      display: block;
      max-width: 100%;
      margin-top: 1.25rem !important;
      overflow-x: visible;
    }

    .revision-list .page-history {
      display: block;
      width: 100%;
      min-width: 0;
      border-collapse: separate;

      tbody {
        display: block;
      }

      .revision-header {
        // Theme styles can give this compatibility table row an explicit
        // display value (often with higher selector specificity). At phone
        // widths its labels are repeated on the actual cards below, so the
        // wide column header must not consume space or appear as a second
        // malformed card.
        display: none !important;
      }

      .revision-row {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0.35rem;
        width: 100%;
        box-sizing: border-box;
        padding: 0.6rem;
        margin-block: 0.5rem;
        border: 1px solid currentColor;
      }

      .revision-attribute {
        display: grid;
        grid-template-columns: minmax(5.5rem, 34%) minmax(0, 1fr);
        gap: 0.5rem;
        min-width: 0;
        width: 100%;
        box-sizing: border-box;
        padding: 0.15rem 0;
        overflow-wrap: anywhere;
      }

      .revision-number::before,
      .revision-type::before,
      .user::before,
      .created-at::before,
      .comments::before {
        content: attr(data-label);
        font-weight: 600;
      }

      // Comments inherit strongly varied table typography from themes. Give
      // their value the full card width so large or monospace text wraps at
      // natural word boundaries instead of being squeezed beside its label.
      .comments {
        grid-template-columns: minmax(0, 1fr) !important;
      }

      .comments::before {
        grid-column: 1 / -1;
      }

      .action {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        min-width: 0;
        white-space: normal;
      }
    }

    // Keep this global selector outside the nested .revision-list block. If
    // SCSS nests it, the generated descendant chain becomes impossible to
    // match (#action-area is an ancestor of .revision-list).
    :global(#action-area .revision-list .page-history tbody tr.revision-row > td.revision-attribute::before) {
      content: attr(data-label) !important;
      position: static !important;
      inset: auto !important;
      display: block !important;
      width: auto !important;
      max-width: 100% !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: inherit !important;
      font-family: inherit !important;
      font-size: inherit !important;
      font-weight: 600 !important;
      line-height: inherit !important;
      text-align: left !important;
      text-transform: none !important;
    }
  }

  .revision-diff-panel {
    margin-top: 1rem;
  }

  .revision-diff-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .revision-diff {
    padding: 0.75rem;
    margin-top: 0.75rem;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: auto;
    box-sizing: border-box;
    white-space: pre-wrap !important;
    overflow-wrap: anywhere !important;
    word-break: normal;

    .revision-diff-line {
      display: block;
    }

    .added {
      background: rgb(220 255 220);
    }

    .removed {
      background: rgb(255 225 225);
    }
  }

  // Theme selectors commonly target `pre` descendants with `white-space: pre`.
  // Keep the UI's individual revision lines bounded and readable even when
  // that upstream declaration would otherwise make the pre horizontally wider
  // than a phone viewport.
  :global(#action-area pre.revision-diff > .revision-diff-line) {
    white-space: pre-wrap !important;
    overflow-wrap: anywhere !important;
    max-width: 100%;
    box-sizing: border-box;
  }

  /* Theme CSS can set the page-wide light text color with enough reach to
     wash out these pale semantic diff rows. Keep added/removed source legible
     while retaining the conventional green/red distinction in every theme. */
  :global(#action-area .revision-diff .revision-diff-line.added) {
    color: #173421 !important;
    background-color: rgb(220 255 220) !important;
  }

  :global(#action-area .revision-diff .revision-diff-line.removed) {
    color: #4a2020 !important;
    background-color: rgb(255 225 225) !important;
  }
</style>
