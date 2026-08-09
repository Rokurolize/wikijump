<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { WIKIDOT_SITE_LANGUAGES } from "$lib/admin/wikidot-site-languages.js"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()

  const { form, enhance } = superForm(
    untrack(() => data.adminForm),
    {
      dataType: "json",
      resetForm: false,
      onSubmit: async ({ jsonData }) => {
        jsonData({
          ...$form,
          siteId: data.site.site_id,
          expectedSettingsRevision: data.site.settings_revision,
          action: "edit"
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
    $form.name = data.site.name
    $form.slug = data.site.slug
    $form.tagline = data.site.tagline
    $form.description = data.site.description
    $form.defaultPage = data.site.default_page
    $form.welcomePage = data.site.welcome_page
    $form.locale = data.site.locale
    $form.siteId = data.site.site_id
    $form.expectedSettingsRevision = data.site.settings_revision
  })
</script>

<h1>Site manager</h1>

<form
  id="sm-general-form"
  class="form-horizontal editor"
  action="?/site"
  method="POST"
  use:enhance
>
  <div class="control-group">
    <label class="control-label" for="appendedInput">Wiki address</label>
    <div class="controls">
      <input
        id="appendedInput"
        name="unixName"
        class="span2"
        type="text"
        bind:value={$form.slug}
      />
    </div>
  </div>

  <div class="control-group">
    <label class="control-label" for="sm-general-name">Wiki title</label>
    <div class="controls">
      <input
        id="sm-general-name"
        name="name"
        class="text"
        size="40"
        type="text"
        bind:value={$form.name}
      />
    </div>
  </div>

  <div class="control-group">
    <label class="control-label" for="sm-general-subtitle">Tagline / subtitle</label>
    <div class="controls">
      <input
        id="sm-general-subtitle"
        name="subtitle"
        class="text"
        size="40"
        type="text"
        bind:value={$form.tagline}
      />
    </div>
  </div>

  <div class="control-group">
    <label class="control-label" for="sm-general-language">Language</label>
    <div class="controls">
      <select name="language" id="sm-general-language" bind:value={$form.locale}>
        {#each ["Stable", "Experimental"] as group (group)}
          <optgroup label={group}>
            {#each WIKIDOT_SITE_LANGUAGES.filter((entry) => entry.group === group) as entry (entry.value)}
              <option label={entry.label} value={entry.value}>{entry.label}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </div>
  </div>

  <div class="control-group">
    <label class="control-label" for="site-description-field">Description</label>
    <div class="controls">
      <textarea
        name="description"
        id="site-description-field"
        cols="40"
        rows="3"
        bind:value={$form.description}></textarea>
      <span class="help-block">Please keep it short.</span>
    </div>
  </div>

  <div class="control-group">
    <label class="control-label" for="sm-general-start">Default start page</label>
    <div class="controls">
      <input
        id="sm-general-start"
        name="default_page"
        class="autocomplete-input text"
        size="35"
        type="text"
        bind:value={$form.defaultPage}
      />
      <div id="sm-general-start-list" class="autocomplete-list"></div>
    </div>
  </div>

  <div class="control-group">
    <label class="control-label" for="sm-general-welcome">Welcome page</label>
    <div class="controls">
      <input
        id="sm-general-welcome"
        name="welcome_page"
        class="autocomplete-input text"
        size="35"
        type="text"
        bind:value={$form.welcomePage}
      />
      <div id="sm-general-welcome-list" class="autocomplete-list"></div>
    </div>
  </div>

  <div class="form-actions">
    <button id="sm-general-save" class="btn btn-primary" type="submit"
      >Save changes</button
    >
  </div>
</form>
