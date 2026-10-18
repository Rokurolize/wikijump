<script lang="ts">
  import { page } from "$app/state"

  import type { PageData } from "./$types"
  let errorData: PageData | null = $derived(page.error as unknown as PageData)
</script>

<h1>{errorData?.internationalization?.["error"]}</h1>

<!--
Use svelte-switch-case package with {#switch data.view}
as soon as we can figure out prettier support for it.
-->
{#if errorData.view === "user_missing"}
  {#if page.route.id === "/[x+2d]/user"}
    {errorData.internationalization?.["user-not-logged-in"]}
  {:else}
    {errorData.internationalization?.["user-not-exist"]}
  {/if}
{:else}
  {errorData?.internationalization?.["error-api.GENERIC"]}
{/if}

