<script lang="ts">
  import { goto } from "$app/navigation"
  import { resolve } from "$app/paths"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import {
    buildWikidotDataFormState,
    serializeWikidotDataFormSource
  } from "$lib/wikidot/wikidot-data-form.js"
  import WikidotDataFormMatchWorker from "$lib/wikidot/wikidot-data-form-match.worker.ts?worker"
  import { superForm } from "sveltekit-superforms"
  import { onDestroy, untrack } from "svelte"
  import { SvelteMap } from "svelte/reactivity"

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
  const validationErrors = new SvelteMap<string, string>()
  const category = $derived(
    slug.includes(":") ? slug.slice(0, slug.indexOf(":")) : "_default"
  )
  const headingCategory = $derived(category.charAt(0).toUpperCase() + category.slice(1))
  let activeValidationWorker: Worker | null = null
  let cancelActiveValidation: (() => void) | null = null
  let validationGeneration = 0

  type MatchField = {
    name: string
    pattern: string
    value: string
  }

  type MatchResult =
    | { kind: "complete"; results: { name: string; matches: boolean }[] }
    | { kind: "invalid"; name: string }
    | { kind: "unsafe" }
    | { kind: "cancelled" }

  function matchFieldsWithinBrowserBudget(
    fields: MatchField[],
    generation: number
  ): Promise<MatchResult> {
    return new Promise((resolve) => {
      const worker = new WikidotDataFormMatchWorker()
      activeValidationWorker = worker
      let complete = false
      const finish = (result: MatchResult) => {
        if (complete) return
        complete = true
        clearTimeout(timeout)
        worker.terminate()
        if (activeValidationWorker === worker) activeValidationWorker = null
        if (cancelActiveValidation === cancelValidation) cancelActiveValidation = null
        resolve(result)
      }
      const cancelValidation = () => finish({ kind: "cancelled" })
      cancelActiveValidation = cancelValidation
      const timeout = setTimeout(() => finish({ kind: "unsafe" }), 250)
      worker.onmessage = (event: MessageEvent<MatchResult>) => {
        if (generation !== validationGeneration) {
          finish({ kind: "cancelled" })
          return
        }
        finish(event.data)
      }
      worker.onerror = () => finish({ kind: "unsafe" })
      worker.postMessage({ fields })
    })
  }

  async function validateSnapshot(
    definitionSnapshot: DataFormDefinition,
    valuesSnapshot: Record<string, string>,
    generation: number
  ) {
    validationErrors.clear()

    for (const field of definitionSnapshot.fields) {
      if (
        field.field_type === "select" &&
        valuesSnapshot[field.name] !== "" &&
        !field.values.some((option) => option.value === valuesSnapshot[field.name])
      ) {
        validationErrors.set(
          field.name,
          "Wikijump requires a configured value for this field."
        )
      }
    }
    if (validationErrors.size > 0) return false

    const matchFields = definitionSnapshot.fields.flatMap((field) =>
      field.match_pattern
        ? [
            {
              name: field.name,
              pattern: field.match_pattern,
              value: valuesSnapshot[field.name] ?? ""
            }
          ]
        : []
    )
    if (matchFields.length === 0) return true

    const result = await matchFieldsWithinBrowserBudget(matchFields, generation)
    if (generation !== validationGeneration || result.kind === "cancelled") return false
    if (result.kind === "unsafe") {
      for (const field of matchFields) {
        validationErrors.set(field.name, "Wikijump could not safely evaluate this field.")
      }
      return false
    }
    if (result.kind === "invalid") {
      if (matchFields.some((field) => field.name === result.name)) {
        validationErrors.set(
          result.name,
          "Wikijump could not evaluate this field's validation pattern."
        )
      } else {
        for (const field of matchFields) {
          validationErrors.set(
            field.name,
            "Wikijump could not safely evaluate this field."
          )
        }
      }
      return false
    }

    const expectedNames = new Set(matchFields.map((field) => field.name))
    const returnedNames = new Set(result.results.map((field) => field.name))
    if (
      result.results.length !== matchFields.length ||
      returnedNames.size !== expectedNames.size ||
      [...expectedNames].some((name) => !returnedNames.has(name))
    ) {
      for (const field of matchFields) {
        validationErrors.set(field.name, "Wikijump could not safely evaluate this field.")
      }
      return false
    }
    for (const resultField of result.results) {
      if (!resultField.matches) {
        const definitionField = definitionSnapshot.fields.find(
          (field) => field.name === resultField.name
        )
        validationErrors.set(resultField.name, definitionField?.match_error ?? "")
      }
    }
    return validationErrors.size === 0
  }

  const { form, enhance } = superForm(
    untrack(() => editForm),
    {
      dataType: "json",
      multipleSubmits: "abort",
      onSubmit: async ({ jsonData, cancel }) => {
        const generation = ++validationGeneration
        cancelActiveValidation?.()
        const definitionSnapshot = structuredClone(definition)
        const valuesSnapshot = Object.fromEntries(
          definitionSnapshot.fields.map((field) => [field.name, values[field.name] ?? ""])
        )
        const formSnapshot = { ...$form }
        if (creating && initialTags) {
          cancel()
          errorPopupState.current = {
            state: true,
            message: "An error occurred while processing the request.",
            data: {}
          }
          return
        }
        if (!(await validateSnapshot(definitionSnapshot, valuesSnapshot, generation))) {
          cancel()
          return
        }
        if (generation !== validationGeneration) {
          cancel()
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
        const wikitext = serializeWikidotDataFormSource(
          definitionSnapshot,
          valuesSnapshot
        )
        $form.wikitext = wikitext
        jsonData({
          ...formSnapshot,
          wikitext,
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

  onDestroy(() => {
    validationGeneration += 1
    cancelActiveValidation?.()
  })

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
    {#if field.field_type !== "select" || field.values.length > 0}
      <div class="form-group" class:has-error={validationErrors.has(field.name)}>
        <label class="col-sm-2 control-label" for={`field-${field.name}`}>
          {field.label}
        </label>
        <div class="col-sm-5">
          <span
            class={`form-value field-${field.name}`}
            class:form-error={validationErrors.has(field.name)}
          >
            {#if field.field_type === "select"}
              {#if field.values.length >= 5}
                <select
                  id={`field-${field.name}`}
                  name={`field-${field.name}`}
                  class="form-control form-select"
                  bind:value={values[field.name]}
                >
                  {#each field.values as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              {:else}
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
              {/if}
            {:else if field.height >= 2}
              <textarea
                id={`field-${field.name}`}
                name={`field-${field.name}`}
                class="form-control form-text"
                cols={field.width}
                placeholder={field.hint}
                rows={field.height}
                bind:value={values[field.name]}></textarea>
            {:else}
              <input
                id={`field-${field.name}`}
                name={`field-${field.name}`}
                class="form-control form-text"
                onkeypress={(event) => {
                  if (event.key === "Enter") event.preventDefault()
                }}
                placeholder={field.hint}
                size={field.width}
                type="text"
                bind:value={values[field.name]}
              />
            {/if}
            <span class="form-message text-danger">
              {validationErrors.get(field.name) ?? ""}
            </span>
          </span>
        </div>
      </div>
    {/if}
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
