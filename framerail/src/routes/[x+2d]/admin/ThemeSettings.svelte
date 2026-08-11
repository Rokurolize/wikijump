<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()
  const { form, enhance } = superForm(
    untrack(() => data.themeForm),
    {
      dataType: "json",
      resetForm: false,
      onSubmit: async ({ jsonData }) => {
        jsonData({ ...$form, siteId: data.site.site_id })
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
    $form.themeType = category.theme_kind
    $form.builtinId = category.theme_builtin_id ?? 1
    $form.externalUrl = category.theme_external_url ?? ""
    $form.customCss = category.theme_custom_css ?? ""
  }

  $effect(() => {
    const siteId = data.site.site_id
    const categories = data.categories
    untrack(() => {
      $form.siteId = siteId
      if (
        categories.length > 0 &&
        !categories.some((category) => category.category_id === $form.categoryId)
      ) {
        loadCategory(categories[0].category_id)
      }
    })
  })
</script>

<section id="site-theme-settings" class="admin-section">
  <div class="page-header"><h2>Themes</h2></div>
  {#if data.categories.length > 0}
    <form
      id="sm-appearance-form"
      class="form form-horizontal"
      action="?/theme"
      method="POST"
      use:enhance
    >
      <label class="control-label" for="sm-appearance-cats">Category</label>
      <select
        id="sm-appearance-cats"
        name="category"
        onchange={() => loadCategory($form.categoryId)}
        bind:value={$form.categoryId}
      >
        {#each data.categories as category (category.category_id)}
          <option value={category.category_id}>{category.slug}</option>
        {/each}
      </select>

      <label class="control-label" for="sm-appearance-theme-type">Theme source</label>
      <select id="sm-appearance-theme-type" bind:value={$form.themeType}>
        <option value="inherit">Inherit from _default</option>
        <option value="built_in">Built-in</option>
        <option value="external">External HTTPS</option>
        <option value="custom">Custom CSS</option>
      </select>

      {#if $form.themeType === "built_in"}
        <label for="sm-appearance-built-in-id">Built-in theme ID</label>
        <input
          id="sm-appearance-built-in-id"
          min="1"
          type="number"
          bind:value={$form.builtinId}
        />
      {:else if $form.themeType === "external"}
        <label class="control-label" for="sm-appearance-external-url">URL</label>
        <input
          id="sm-appearance-external-url"
          name="sm-appearance-external-url"
          class="text"
          size="36"
          type="url"
          bind:value={$form.externalUrl}
        />
      {:else if $form.themeType === "custom"}
        <label for="sm-appearance-custom-css">CSS</label>
        <textarea id="sm-appearance-custom-css" rows="12" bind:value={$form.customCss}
        ></textarea>
      {/if}

      <button id="sm-appearance-save" class="btn btn-primary" type="submit"
        >Save Changes</button
      >
    </form>
  {:else}
    <p>No page categories are available.</p>
  {/if}
</section>
