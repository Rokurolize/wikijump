<script lang="ts">
  import { deserialize } from "$app/forms"
  import { resolve } from "$app/paths"
  import { errorPopupState } from "$lib/layout/stores.svelte"

  import type { PageBacklinkView } from "$lib/server/deepwell/page"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  let backlinks = $state<PageBacklinkView[]>()

  async function fetchBacklinks() {
    const response = await fetch("?/backlinks", { method: "POST" }).then((result) =>
      result.text()
    )
    const result = deserialize<
      { res: PageBacklinkView[] },
      { message: string; code: string; data: Record<string, unknown> }
    >(response)

    if (result.type === "failure" && result.data?.message) {
      errorPopupState.current = {
        state: true,
        message: result.data.message,
        data: result.data.data
      }
    } else if (result.type === "success") {
      backlinks = result.data?.res ?? []
    }
  }

  $effect(() => {
    fetchBacklinks()
  })
</script>

<h1 class="page-backlinks-header">
  {data.wikidot_page_actions?.backlinks ?? "Backlinks"}
</h1>

<div id="page-backlinks-list" aria-live="polite">
  {#if backlinks === undefined}
    <p>Loading…</p>
  {:else if backlinks.length === 0}
    <p>No pages link to this page.</p>
  {:else}
    <ul>
      {#each backlinks as backlink (backlink.slug)}
        <li><a href={resolve(`/${backlink.slug}`, {})}>{backlink.title}</a></li>
      {/each}
    </ul>
  {/if}
</div>
