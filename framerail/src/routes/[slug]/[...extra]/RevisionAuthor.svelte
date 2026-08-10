<script lang="ts">
  import type { Nullable, UserInfo } from "$lib/types"

  interface Props {
    author: Nullable<UserInfo>
  }

  let { author }: Props = $props()
</script>

{#if author}
  <span class="printuser"
    ><a href={author["user-profile-url"]}>{author["user-name"]}</a></span
  >
{/if}
