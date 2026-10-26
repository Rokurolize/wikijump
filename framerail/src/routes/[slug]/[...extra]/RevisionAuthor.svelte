<script lang="ts">
  import type { Nullable, UserInfo } from "$lib/types"

  interface Props {
    author: Nullable<UserInfo>
  }

  let { author }: Props = $props()
</script>

{#if author}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- absolute profile URL from user data -->
  <span class="printuser"
    ><a href={author["user-profile-url"]}>{author["user-name"]}</a></span
  >
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{/if}
