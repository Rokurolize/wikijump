<script lang="ts">
  import { page } from "$app/state"

  import type { TranslatedKeys } from "$lib/types"

  type AdminErrorData = NonNullable<typeof page.error> & {
    html?: string
    internationalization?: TranslatedKeys
  }

  let errorData: AdminErrorData = $derived(page.error as AdminErrorData)
</script>

<h1>{errorData?.internationalization?.["error"]}</h1>

<!--
Use svelte-switch-case package with {#switch data.view}
as soon as we can figure out prettier support for it.
-->
{#if errorData.view === "admin_permissions"}
  {errorData.internationalization?.["admin-unauthorized"]}
  {@html errorData.html ?? ""}
{:else}
  {errorData.internationalization?.["error-api.GENERIC"]}
{/if}

