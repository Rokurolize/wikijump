<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()
  const { form, enhance } = superForm(
    untrack(() => data.autonumberForm),
    {
      dataType: "json",
      resetForm: false,
      onSubmit: async ({ jsonData }) => {
        jsonData({ ...$form, siteId: data.site.site_id, enabled: true })
      },
      onResult: async ({ result }) => {
        if (result.type === "success" && result.data?.res) await invalidateAll()
        if (result.type === "failure" && result.data) {
          errorPopupState.current = {
            state: true,
            message: result.data.message,
            data: result.data.data
          }
        }
      }
    }
  )

  function loadCategory(categoryId: number) {
    const category = data.categories.find(
      (candidate) => candidate.category_id === categoryId
    )
    if (!category) return
    $form.categoryId = category.category_id
    $form.expectedSettingsRevision = category.settings_revision
  }

  $effect(() => {
    $form.siteId = data.site.site_id
    $form.enabled = true
    if (
      data.categories.length > 0 &&
      !data.categories.some((category) => category.category_id === $form.categoryId)
    ) {
      loadCategory(data.categories[0].category_id)
    }
  })
</script>

<section id="autonumerate" class="admin-section">
  <div class="page-header">
    <h2>Autonumbering <small>Automatic page numbering</small></h2>
  </div>
  <p>
    This setting saves each new page in a selected category with an incremental number and
    ignores its suggested page name.
  </p>
  <h3>Categories with autonumbering</h3>
  {#if data.categories.some((category) => category.autonumber_enabled)}
    <ul>
      {#each data.categories.filter((category) => category.autonumber_enabled) as category (category.category_id)}
        <li>{category.slug}</li>
      {/each}
    </ul>
  {:else}
    <div class="alert">Currently no categories are marked as autonumbered.</div>
  {/if}

  {#if data.categories.length > 0}
    <form
      id="sm-autonumerate-add-category"
      action="?/autonumber"
      method="POST"
      use:enhance
    >
      <h3>Add autonumbering to a category</h3>
      <select
        id="sm-autonumerate-add-catname1"
        onchange={() => loadCategory($form.categoryId)}
        bind:value={$form.categoryId}
      >
        <option value={0}>Choose an existing category</option>
        {#each data.categories.filter((category) => !category.autonumber_enabled) as category (category.category_id)}
          <option value={category.category_id}>{category.slug}</option>
        {/each}
      </select>
      <button class="btn btn-primary" type="submit">Save changes</button>
    </form>
  {/if}
</section>
