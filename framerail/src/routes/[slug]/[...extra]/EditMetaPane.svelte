<script lang="ts">
  import { onMount } from "svelte"

  import type { PageMetaTagView } from "$lib/server/deepwell/views"
  import {
    deleteWikidotMetaTag,
    loadWikidotEditMetaRows,
    saveWikidotMetaTag
  } from "$lib/wikidot/wikidot-edit-meta"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()
  let rows = $state<PageMetaTagView[] | null>(null)
  let adding = $state(false)
  let metaName = $state("")
  let metaContent = $state("")
  let error = $state("")
  let busy = $state(false)

  async function reloadPane() {
    if (!data.page) return
    rows = await loadWikidotEditMetaRows(fetch, data.page.page_id)
  }

  async function runMutation(mutation: () => Promise<unknown>) {
    busy = true
    error = ""
    try {
      await mutation()
      adding = false
      metaName = ""
      metaContent = ""
      await reloadPane()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Edit Meta request failed."
    } finally {
      busy = false
    }
  }

  function save(allPages: boolean) {
    if (!data.page || metaName.length === 0) return
    return runMutation(() =>
      saveWikidotMetaTag(fetch, {
        pageId: data.page!.page_id,
        name: metaName,
        content: metaContent,
        allPages
      })
    )
  }

  function remove(row: PageMetaTagView) {
    if (!data.page) return
    return runMutation(() =>
      deleteWikidotMetaTag(fetch, {
        pageId: data.page!.page_id,
        name: row.name,
        allPages: row.all_pages
      })
    )
  }

  onMount(() => {
    void reloadPane().catch((cause) => {
      error = cause instanceof Error ? cause.message : "Edit Meta request failed."
      rows = []
    })
  })
</script>

<h1>Meta tags for the page</h1>
<p>Using the interface below you can edit special HTML &lt;meta&gt; tags for the page.</p>
<h2>Current meta tags:</h2>

{#if rows === null}
  <p class="pane-loading" aria-live="polite">Loading…</p>
{:else}
  <div style="padding-left:3em;">
    {#each rows as row (`${row.all_pages}:${row.name}`)}
      <div>
        <button
          class="edit-meta-remove"
          disabled={busy}
          onclick={() => remove(row)}
          type="button">remove</button
        >
        &lt;meta name="{row.name}" content="{row.content}"/&gt;{#if row.all_pages}
          (all pages)
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if adding}
  <div id="edit-meta-newtag">
    <h2>Add a new meta tag</h2>
    <form id="edit-meta-newtag-form" onsubmit={(event) => event.preventDefault()}>
      <table style="margin: 0 auto;">
        <tbody>
          <tr>
            <td>&lt;meta&nbsp;&nbsp;&nbsp;name="</td>
            <td><input bind:value={metaName} name="metaName" type="text" size="20" /></td>
            <td>"&nbsp;&nbsp;&nbsp;content="</td>
            <td
              ><input bind:value={metaContent} name="metaContent" type="text" size="30"
            /></td>
            <td>" /&gt;</td>
          </tr>
        </tbody>
      </table>
      <div style="text-align: center; padding: 1em;">
        <button
          class="btn btn-danger btn-small btn-sm"
          disabled={busy}
          onclick={() => (adding = false)}
          type="button">Cancel</button
        >
        <button
          class="btn btn-primary btn-small btn-sm"
          disabled={busy || metaName.length === 0}
          onclick={() => save(true)}
          type="button">Add to All Pages</button
        >
        <button
          class="btn btn-primary btn-small btn-sm"
          disabled={busy || metaName.length === 0}
          onclick={() => save(false)}
          type="button">Add to This Page</button
        >
      </div>
    </form>
  </div>
{:else}
  <p id="edit-meta-addbutton">
    <button class="btn btn-primary" onclick={() => (adding = true)} type="button"
      >Add a new meta tag</button
    >
  </p>
{/if}

<p>Adding a meta tag with the name already used will effectively replace the existing entry. <br /><br /> Meta entries added to a page override global meta information added to all pages.</p>

<style lang="scss">
  .edit-meta-remove {
    margin-right: 2em;
  }
</style>
