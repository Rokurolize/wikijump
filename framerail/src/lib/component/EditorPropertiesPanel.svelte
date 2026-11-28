<script lang="ts">
  import { deserialize } from "$app/forms"
  import { onMount, type Snippet } from "svelte"

  import { Layout } from "$lib/types"
  import {
    currentEditorLabels,
    formatEditorLabel
  } from "$lib/wikidot/editor-labels-client"
  import { splitSpaceSeparated } from "$lib/wikidot/editor-properties"
  import type { EditorLabels } from "$lib/wikidot/editor-labels"

  import type { PropertiesErrors, PropertiesReport } from "$lib/wikidot/editor-properties"

  let {
    title = $bindable(""),
    altTitle = $bindable(""),
    tags = $bindable(""),
    comments = $bindable(""),
    parent = $bindable(""),
    layout = $bindable<Layout | null>(null),
    initialParent = $bindable<string[]>([]),
    parentReady = $bindable(false),
    canMove = $bindable(false),
    report = $bindable<PropertiesReport>({ state: "idle", message: "" }),
    errors,
    creating = false,
    pageId,
    slug,
    templateLabel = "",
    currentLayoutLabel = "",
    onRetryParent,
    labels = currentEditorLabels(),
    children
  }: {
    title?: string
    altTitle?: string
    tags?: string
    comments?: string
    parent?: string
    layout?: Layout | null
    initialParent?: string[]
    parentReady?: boolean
    canMove?: boolean
    report?: PropertiesReport
    errors: PropertiesErrors
    creating?: boolean
    pageId?: number
    slug: string
    templateLabel?: string
    currentLayoutLabel?: string
    onRetryParent?: () => void
    labels?: EditorLabels
    children?: Snippet
  } = $props()

  let loadError = $state("")
  const retryable = $derived(
    report.state === "partial" || (report.state === "failed" && report.step === "parent")
  )

  onMount(() => {
    if (creating || !pageId) {
      parentReady = true
      canMove = true
      return
    }

    let active = true
    void (async () => {
      try {
        const permissionResponse = await fetch("?/editPermission", {
          method: "POST",
          body: ""
        })
        const permission = deserialize<
          { res: { can_edit: boolean } },
          { message: string }
        >(await permissionResponse.text())
        if (!active) return
        canMove = permission.type === "success" && permission.data?.res.can_edit === true
      } catch {
        if (!active) return
        canMove = false
      }

      try {
        const parentResponse = await fetch("?/parentGet", {
          method: "POST",
          body: JSON.stringify({ pageId, slug })
        })
        const parents = deserialize<{ res: string[] }, { message: string }>(
          await parentResponse.text()
        )
        if (!active) return
        if (parents.type === "success" && Array.isArray(parents.data?.res)) {
          initialParent = parents.data.res
          if (splitSpaceSeparated(parent).length === 0) {
            parent = parents.data.res.join(" ")
          }
        } else {
          loadError = labels.propertiesParentLoadError
        }
      } catch {
        if (!active) return
        loadError = labels.propertiesParentLoadError
      } finally {
        if (active) parentReady = true
      }
    })()

    return () => {
      active = false
    }
  })
</script>

<section
  class="editor-properties"
  data-properties="panel"
  aria-label={labels.propertiesHeading}
>
  <h2 class="editor-properties-heading">{labels.propertiesHeading}</h2>

  <div class="editor-properties-fields">
    <div class="editor-properties-field">
      <label for="ed6-title">{labels.propertiesTitle}</label>
      <input
        id="ed6-title"
        class="editor-title"
        name="title"
        placeholder={labels.propertiesTitle}
        type="text"
        bind:value={title}
      />
    </div>

    <div class="editor-properties-field">
      <label for="ed6-alt-title">{labels.propertiesAltTitle}</label>
      <input
        id="ed6-alt-title"
        class="editor-alt-title"
        name="altTitle"
        placeholder={labels.propertiesAltTitle}
        type="text"
        bind:value={altTitle}
      />
    </div>

    <div class="editor-properties-field">
      <span class="editor-properties-label">{labels.propertiesLayout}</span>
      {#if creating}
        <select id="ed6-layout" name="layout" class="editor-layout" bind:value={layout}>
          <option value={null}>{labels.propertiesDefaultLayout}</option>
          {#each Object.values(Layout) as layoutOption (layoutOption)}
            <option value={layoutOption}>{layoutOption}</option>
          {/each}
        </select>
      {:else}
        <span class="editor-properties-readonly" data-properties="layout">
          {currentLayoutLabel || labels.propertiesDefaultLayout}
        </span>
        <span class="editor-properties-hint">
          {labels.propertiesLayoutHint}
        </span>
      {/if}
    </div>

    {#if creating}
      <div class="editor-properties-field">
        <span class="editor-properties-label">{labels.propertiesTemplate}</span>
        <span class="editor-properties-readonly" data-properties="template">
          {templateLabel || labels.propertiesNoTemplate}
        </span>
      </div>
    {/if}
  </div>

  {@render children?.()}

  <div class="editor-properties-fields">
    <div class="editor-properties-field">
      <label for="ed6-tags">{labels.propertiesTags}</label>
      <input
        id="ed6-tags"
        class="editor-tags"
        name="tags"
        placeholder={labels.propertiesTags}
        type="text"
        aria-invalid={errors.tags !== null}
        aria-describedby={errors.tags ? "ed6-tags-error" : undefined}
        bind:value={tags}
      />
      {#if errors.tags}
        <p class="editor-properties-error" id="ed6-tags-error" role="alert">
          {errors.tags}
        </p>
      {/if}
    </div>

    <div class="editor-properties-field">
      <label for="ed6-comments">{labels.propertiesComments}</label>
      <textarea
        id="ed6-comments"
        class="editor-comments"
        name="comments"
        placeholder={labels.propertiesComments}
        bind:value={comments}></textarea>
    </div>
  </div>

  <div class="editor-properties-parent" data-properties="parent-move">
    <h3>{labels.propertiesParentHeading}</h3>
    <p>
      {labels.propertiesParentDescription}
    </p>
    {#if !creating && canMove === false}
      <p
        class="editor-properties-error"
        role="alert"
        aria-live="assertive"
        data-properties="permission-denied"
      >
        {labels.propertiesParentDenied}
      </p>
    {/if}
    {#if loadError}
      <p class="editor-properties-error" role="alert" aria-live="assertive">
        {loadError}
      </p>
    {/if}
    <div class="editor-properties-field">
      <label for="ed6-parent">{labels.propertiesParent}</label>
      <input
        id="ed6-parent"
        class="editor-parent"
        name="parent"
        placeholder="category:page"
        type="text"
        aria-invalid={errors.parent !== null}
        aria-describedby={errors.parent ? "ed6-parent-error" : "ed6-parent-hint"}
        disabled={!creating && !canMove}
        bind:value={parent}
      />
      <p class="editor-properties-hint" id="ed6-parent-hint">
        {#if creating}
          {labels.propertiesParentHintCreate}
        {:else}
          {formatEditorLabel(labels, "propertiesParentHintExisting", {
            parents: initialParent.join(" ") || labels.propertiesNoParents
          })}
        {/if}
      </p>
      {#if errors.parent}
        <p class="editor-properties-error" id="ed6-parent-error" role="alert">
          {errors.parent}
        </p>
      {/if}
    </div>
  </div>

  {#if report.state !== "idle"}
    <p
      class="editor-properties-report"
      class:editor-properties-error={report.state === "invalid" ||
        report.state === "partial" ||
        report.state === "failed"}
      id="ed6-properties-report"
      data-properties-state={report.state}
      role={report.state === "invalid" ||
      report.state === "partial" ||
      report.state === "failed"
        ? "alert"
        : "status"}
      aria-live={report.state === "invalid" ||
      report.state === "partial" ||
      report.state === "failed"
        ? "assertive"
        : "polite"}
      aria-atomic="true"
    >
      {report.message}
    </p>
    {#if retryable && onRetryParent}
      <button
        class="btn btn-primary editor-properties-retry"
        data-properties="retry-move"
        type="button"
        onclick={onRetryParent}
      >
        {labels.propertiesRetryMove}
      </button>
    {/if}
  {/if}
</section>

<style lang="scss">
  .editor-properties {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.75em;
    max-width: 100%;
  }

  .editor-properties-heading {
    margin: 0;
  }

  .editor-properties-fields,
  .editor-properties-parent {
    display: flex;
    flex-direction: column;
    gap: 0.75em;
    max-width: 100%;
  }

  .editor-properties-parent {
    padding-top: 1em;
    border-top: 1px solid #ccc;
  }

  .editor-properties-field {
    display: flex;
    flex-direction: column;
    gap: 0.25em;
    max-width: 100%;
  }

  .editor-properties-field input,
  .editor-properties-field select,
  .editor-properties-field textarea {
    box-sizing: border-box;
    max-width: 100%;
  }

  .editor-properties-field textarea {
    min-height: 4em;
  }

  .editor-properties-label {
    font-weight: bold;
  }

  .editor-properties-readonly {
    overflow-wrap: anywhere;
  }

  .editor-properties-hint {
    color: #555;
    overflow-wrap: anywhere;
  }

  .editor-properties-error {
    color: #b00020;
    overflow-wrap: anywhere;
  }

  .editor-properties-retry {
    align-self: flex-start;
  }

  @media (width <= 480px), (pointer: coarse) {
    .editor-properties-field input,
    .editor-properties-field select,
    .editor-properties-field textarea,
    .editor-properties-retry {
      min-height: 2.75rem;
    }
  }
</style>
