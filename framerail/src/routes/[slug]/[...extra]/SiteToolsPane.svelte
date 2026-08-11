<script lang="ts">
  import { requestWikidotSiteToolsModule } from "$lib/wikidot/wikidot-site-tools"

  let shell = $state("")
  let report = $state("")

  async function load(moduleName: string, callbackIndex: number) {
    const result = await requestWikidotSiteToolsModule(fetch, moduleName, callbackIndex)
    if (result.status !== "ok") return
    if (moduleName === "sitetools/SiteToolsModule") shell = result.body
    else report = result.body
  }

  function selectReport(event: Event) {
    const id = (event.target as Element | null)?.closest("a")?.id
    if (id === "st-wanted-pages-button") {
      void load("sitetools/WantedPagesModule", 2)
    } else if (id === "st-orphaned-pages-button") {
      void load("sitetools/OrphanedPagesModule", 3)
    } else if (id === "st-draft-pages-button") {
      void load("list/ListDraftsModule", 4)
    }
  }

  function selectReportFromKeyboard(event: KeyboardEvent) {
    if (event.key !== " ") return
    event.preventDefault()
    selectReport(event)
  }

  $effect(() => {
    void load("sitetools/SiteToolsModule", 1)
  })
</script>

<div
  onclick={selectReport}
  onkeydown={selectReportFromKeyboard}
  role="toolbar"
  tabindex="0"
>
  {#if shell}
    {@html shell}
  {:else}
    <p aria-live="polite">Loading…</p>
  {/if}
</div>
<div aria-live="polite">{@html report}</div>
