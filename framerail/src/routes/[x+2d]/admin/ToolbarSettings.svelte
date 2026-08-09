<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()
  const { form, enhance } = superForm(
    untrack(() => data.toolbarForm),
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
    $form.top = data.site.show_top_toolbar
    $form.bottom = data.site.show_bottom_toolbar
  })
</script>

<section id="wikidot-toolbar-settings" class="admin-section">
  <div class="page-header"><h2>Wikidot Toolbars</h2></div>
  <form class="form form-horizontal" action="?/toolbar" method="POST" use:enhance>
    <div class="control-group">
      <label class="control-label" for="sm-show-toolbar-input1">Display top toolbar</label
      >
      <div class="controls">
        <input
          id="sm-show-toolbar-input1"
          name="showToolbar1"
          class="checkbox"
          type="checkbox"
          bind:checked={$form.top}
        />
      </div>
    </div>
    <div class="control-group">
      <label class="control-label" for="sm-show-toolbar-input2"
        >Display bottom toolbar</label
      >
      <div class="controls">
        <input
          id="sm-show-toolbar-input2"
          name="showToolbar2"
          class="checkbox"
          type="checkbox"
          bind:checked={$form.bottom}
        />
      </div>
    </div>
    <div class="control-group">
      <label class="control-label" for="sm-promote"
        >Promote this site on other sites</label
      >
      <div class="controls">
        <input id="sm-promote" name="promote" class="checkbox" type="checkbox" disabled />
      </div>
    </div>
    <button class="btn btn-primary" type="submit">Save changes</button>
  </form>
</section>
