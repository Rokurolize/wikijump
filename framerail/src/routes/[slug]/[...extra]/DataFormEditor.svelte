<script lang="ts">
  import { goto } from "$app/navigation"
  import { resolve } from "$app/paths"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import {
    buildWikidotDataFormState,
    serializeWikidotDataFormSource
  } from "$lib/wikidot/wikidot-data-form.js"
  import { superForm } from "sveltekit-superforms"
  import { untrack } from "svelte"

  import type { DataFormDefinition } from "$lib/server/deepwell/views"
  import type { buildPageForms } from "$lib/server/load/page/page-forms"

  type PageEditForm = Awaited<ReturnType<typeof buildPageForms>>["pageEditForm"]

  let {
    definition,
    editForm,
    initialValues,
    initialSource,
    initialTitle,
    initialAltTitle = "",
    initialTags = "",
    initialComments = "",
    initialParent = "",
    siteId,
    pageId,
    lastRevisionId,
    slug,
    creating
  }: {
    definition: DataFormDefinition
    editForm: PageEditForm
    initialValues: Record<string, string>
    initialSource: string
    initialTitle: string
    initialAltTitle?: string
    initialTags?: string
    initialComments?: string
    initialParent?: string
    siteId: number
    pageId?: number
    lastRevisionId?: number
    slug: string
    creating: boolean
  } = $props()

  let values = $state<Record<string, string>>(
    untrack(() => buildWikidotDataFormState(definition, initialValues))
  )
  const category = $derived(
    slug.includes(":") ? slug.slice(0, slug.indexOf(":")) : "_default"
  )
  const headingCategory = $derived(category.charAt(0).toUpperCase() + category.slice(1))

  const { form, enhance } = superForm(
    untrack(() => editForm),
    {
      dataType: "json",
      onSubmit: async ({ jsonData, cancel }) => {
        if (creating && initialTags) {
          cancel()
          errorPopupState.current = {
            state: true,
            message: "An error occurred while processing the request.",
            data: {}
          }
          return
        }
        if (
          !creating &&
          (!Number.isSafeInteger(pageId) ||
            (pageId ?? 0) <= 0 ||
            !Number.isSafeInteger(lastRevisionId) ||
            (lastRevisionId ?? 0) <= 0)
        ) {
          cancel()
          errorPopupState.current = {
            state: true,
            message: "The data-form edit target is incomplete.",
            data: {}
          }
          return
        }
        $form.wikitext = serializeWikidotDataFormSource(definition, values)
        jsonData({
          ...$form,
          siteId,
          pageId: creating ? 0 : pageId,
          lastRevisionId: creating ? 0 : lastRevisionId
        })
      },
      onResult: async ({ result, cancel }) => {
        if (result.type === "success" && result.data) {
          cancel()
          goto(resolve(`/${slug}`, {}), { noScroll: true })
        }
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

  $form.title = untrack(() => initialTitle)
  $form.altTitle = untrack(() => initialAltTitle)
  $form.wikitext = untrack(() => initialSource)
  $form.tags = untrack(() => initialTags)
  $form.parent = untrack(() => initialParent)
  $form.comments = untrack(() => initialComments)

  function cancelEdit() {
    goto(resolve(`/${slug}`, {}), { noScroll: true })
  }
</script>

<h1>{creating ? "Create" : "Edit"} {headingCategory}</h1>

<!-- svelte-ignore a11y_no_redundant_roles -->
<form
  id="edit-page-form"
  class="form-horizontal data-form"
  action="?/edit"
  method="POST"
  role="form"
  use:enhance
>
  <input name="page_id" type="hidden" value={pageId ?? ""} />
  <input name="form-use" type="hidden" value="true" />
  <input
    name="form-fields"
    type="hidden"
    value={definition.fields.map((field) => field.name).join(",")}
  />
  <input name="form-file-still-uploading" type="hidden" value="0" />

  <div class="form-group">
    <label class="col-sm-2 control-label" for="edit-page-title">Title</label>
    <div class="col-sm-5">
      <input
        id="edit-page-title"
        name="title"
        class="form-control text"
        onkeypress={(event) => {
          if (event.key === "Enter") event.preventDefault()
        }}
        type="text"
        bind:value={$form.title}
      />
    </div>
  </div>

  {#each definition.fields as field (field.name)}
    <div class="form-group">
      <label class="col-sm-2 control-label" for={`field-${field.name}`}>
        {field.label}
      </label>
      <div class="col-sm-5">
        <span class={`form-value field-${field.name}`}>
          {#if field.field_type === "select"}
            {#each field.values as option (option.value)}
              <label class="radio-inline">
                <input
                  name={`field-${field.name}`}
                  class="form-select"
                  checked={values[field.name] === option.value}
                  onchange={() => (values[field.name] = option.value)}
                  type="radio"
                  value={option.value}
                />{option.label}
              </label>
            {/each}
          {:else}
            <input
              id={`field-${field.name}`}
              name={`field-${field.name}`}
              class="form-control form-text"
              onkeypress={(event) => {
                if (event.key === "Enter") event.preventDefault()
              }}
              placeholder={field.hint}
              size="40"
              type="text"
              bind:value={values[field.name]}
            />
          {/if}
          <span class="form-message text-danger"></span>
        </span>
      </div>
    </div>
  {/each}

  <div class="form-group">
    <div class="col-sm-offset-2 col-sm-5">
      <!-- svelte-ignore a11y_invalid_attribute -->
      <a
        id="edit-cancel-button"
        class="btn btn-danger"
        href="javascript:;"
        onclick={cancelEdit}>Cancel</a
      >
      <!-- svelte-ignore a11y_invalid_attribute -->
      <a
        id="edit-save-button"
        class="btn btn-primary"
        href="javascript:;"
        onclick={() =>
          document.querySelector<HTMLFormElement>("#edit-page-form")?.requestSubmit()}
        >Save</a
      >
    </div>
  </div>
</form>
