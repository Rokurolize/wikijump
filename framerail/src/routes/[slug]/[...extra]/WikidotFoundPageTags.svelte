<script lang="ts">
  import { buildWikidotPageTagsHtml } from "$lib/wikidot/wikidot-page-tags"

  let {
    currentTags,
    revisionTags,
    showRevision = false,
    hidden = false
  }: {
    currentTags: string[]
    revisionTags?: string[]
    showRevision?: boolean
    hidden?: boolean
  } = $props()

  let tags = $derived(showRevision ? (revisionTags ?? []) : currentTags)
</script>

{#if tags.length}
  <div class="page-tags" class:hidden>
    {@html buildWikidotPageTagsHtml(tags)}
  </div>
{/if}
