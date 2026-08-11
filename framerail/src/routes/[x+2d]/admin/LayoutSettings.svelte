<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { Layout } from "$lib/types"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()
  const { form, enhance } = superForm(
    untrack(() => data.layoutForm),
    {
      dataType: "json",
      resetForm: false,
      onSubmit: async ({ jsonData }) => {
        jsonData({
          ...$form,
          siteId: data.site.site_id,
          expectedSettingsRevision: data.site.settings_revision
        })
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

  $effect(() => {
    $form.siteId = data.site.site_id
    $form.expectedSettingsRevision = data.site.settings_revision
    $form.layout = data.site.layout
  })
</script>

<section id="wikijump-layout-settings" class="admin-section">
  <h2>Wikijump layout</h2>
  <form class="editor" action="?/siteLayout" method="POST" use:enhance>
    <label for="wikijump-site-layout">Page layout</label>
    <select id="wikijump-site-layout" name="layout" bind:value={$form.layout}>
      <option value={null}>Platform default</option>
      {#each Object.values(Layout) as layout (layout)}
        <option value={layout}>{layout}</option>
      {/each}
    </select>
    <button type="submit">Save layout</button>
  </form>
</section>
