<script lang="ts">
  import { page } from "$app/state"
  import { isPageErrorData } from "$lib/page-error-data"
  import WikiPageError from "./WikiPageError.svelte"

  const pageErrorData = $derived(isPageErrorData(page.error) ? page.error : null)
  const httpErrorTitle = $derived(
    page.status === 404
      ? "Not Found"
      : page.status === 403
        ? "Forbidden"
        : page.status >= 500
          ? "Internal Error"
          : "Request Error"
  )

  const httpErrorMessage = $derived(
    page.status === 404
      ? "The requested resource could not be found."
      : page.status === 403
        ? "You do not have permission to access this resource."
        : page.status >= 500
          ? "Something went wrong while handling your request."
          : "The request could not be completed."
  )
</script>

<svelte:head>
  <title>{httpErrorTitle}</title>
</svelte:head>

{#if pageErrorData}
  <WikiPageError errorData={pageErrorData} />
{:else}
  <main id="route-error" data-status={page.status}>
    <h1>{httpErrorTitle}</h1>
    <p>{httpErrorMessage}</p>
  </main>
{/if}
