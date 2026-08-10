<script lang="ts">
  import RevisionAuthor from "./RevisionAuthor.svelte"

  import type { UserInfo } from "$lib/types"

  let { watchers }: { watchers: UserInfo[] } = $props()
</script>

<ul class="page-watchers-list">
  {#each watchers as watcher (watcher["user-id"])}
    <li><RevisionAuthor author={watcher} /></li>
  {/each}
</ul>
