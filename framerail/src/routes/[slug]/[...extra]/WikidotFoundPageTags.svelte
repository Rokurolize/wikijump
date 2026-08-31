<script lang="ts">
  import { buildWikidotPageTagsHtml } from "$lib/wikidot/wikidot-page-tags"

  let {
    tags,
    hidden = false
  }: {
    tags: string[]
    hidden?: boolean
  } = $props()
</script>

{#if tags.length}
  <div class="page-tags" class:hidden>
    {@html buildWikidotPageTagsHtml(tags)}
  </div>
{/if}
