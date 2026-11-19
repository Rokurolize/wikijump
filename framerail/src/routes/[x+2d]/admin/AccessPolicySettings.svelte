<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { ACCESS_POLICIES } from "$lib/admin/admin-access-policy"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()

  const { form, enhance } = superForm(
    untrack(() => data.accessPolicyForm),
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
    $form.accessPolicy = data.site_settings.access_policy ?? "open"
  })
</script>

<section id="wikidot-access-policy-settings" class="admin-section">
  <div class="page-header"><h2>Access policy</h2></div>
  <form class="editor" action="?/accessPolicy" method="POST" use:enhance>
    {#each ACCESS_POLICIES as policy (policy)}
      <label class="checkbox-label">
        <input
          type="radio"
          name="accessPolicy"
          value={policy}
          bind:group={$form.accessPolicy}
        />
        {policy.slice(0, 1).toUpperCase() + policy.slice(1)}
      </label>
    {/each}
    <div class="action-row">
      <button type="submit">Save access policy</button>
    </div>
  </form>
</section>
