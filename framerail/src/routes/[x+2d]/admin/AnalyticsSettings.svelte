<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()
  const { form, enhance } = superForm(
    untrack(() => data.analyticsForm),
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
      onResult: async ({ result, cancel }) => {
        if (result.type === "success" && result.data?.res) await invalidateAll()
        if (result.type === "failure" && result.data) {
          cancel()
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
    $form.enabled = data.site.google_analytics_enabled
    $form.profile = data.site.google_analytics_profile ?? ""
  })
</script>

<section id="google-analytics-settings" class="admin-section">
  <h2>Google Analytics</h2>
  <form
    id="sm-ganalytics-form"
    class="form-horizontal"
    action="?/analytics"
    method="POST"
    use:enhance
  >
    <div class="control-group">
      <label class="control-label" for="sm-ganalytics-key">Google Analytics key</label>
      <div class="controls">
        <input
          id="sm-ganalytics-key"
          name="key"
          class="text"
          size="15"
          type="text"
          bind:value={$form.profile}
        />
      </div>
    </div>
    <div class="control-group">
      <label class="control-label" for="sm-ganalytics-use">Enable Google Analytics</label>
      <div class="controls">
        <input
          id="sm-ganalytics-use"
          name="use"
          class="checkbox"
          type="checkbox"
          bind:checked={$form.enabled}
        />
      </div>
    </div>
    <button id="sm-ganalytics-save" class="btn btn-primary" type="submit"
      >Save changes</button
    >
  </form>
</section>
