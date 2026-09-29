<script lang="ts">
  import type { Nullable, UserInfo } from "$lib/types"

  interface Props {
    author: Nullable<UserInfo>
    userId?: number
  }

  let { author, userId }: Props = $props()
</script>

{#if author}
  {@const profileUrl = author["user-profile-url"].replace(/^http:/u, "https:")}
  <span class="printuser avatarhover">
    {#if author["user-avatar-data"]}
      <a href={profileUrl}>
        <img
          class="small"
          src={author["user-avatar-data"].replace(/^http:/u, "https:")}
          alt={author["user-name"]}
          style={`background-image:url(https://www.wikidot.com/userkarma.php?u=${author["user-id"]})`}
        />
      </a>
    {/if}
    <a href={profileUrl}>{author["user-name"]}</a>
  </span>
{:else}
  <span class="printuser deleted" data-id={userId}></span>
{/if}
