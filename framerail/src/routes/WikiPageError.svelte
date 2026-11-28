<script lang="ts">
  import { page } from "$app/state"
  import { deserialize } from "$app/forms"
  import { resolve } from "$app/paths"
  import { goto, invalidateAll } from "$app/navigation"
  import { Layout } from "$lib/types"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { getPageLayoutContext } from "$lib/layout/page-layout-context"
  import { pageMutationDestinationSlug } from "$lib/page-mutation-destination"
  import { createPageDeniedMessage } from "$lib/wikidot/wikidot-locale"
  import { defaultPageTitleFromSlug } from "$lib/wikidot/wikidot-page-title"
  import {
    classifyPropertyActionError,
    firstPropertyError,
    hasPropertyErrors,
    IDLE_PROPERTIES_REPORT,
    parentReportMessage,
    splitSpaceSeparated,
    validateProperties
  } from "$lib/wikidot/editor-properties"
  import { superForm } from "sveltekit-superforms"
  import { onDestroy, onMount, untrack } from "svelte"
  import type { PageErrorData } from "$lib/page-error-data"

  import EditorPropertiesPanel from "$lib/component/EditorPropertiesPanel.svelte"
  import WikitextEditor from "$lib/component/WikitextEditor.svelte"
  import WikitextPreviewPane from "$lib/component/WikitextPreviewPane.svelte"

  import DataFormEditor from "./[slug]/[...extra]/DataFormEditor.svelte"
  import EditDraftDialog from "./[slug]/[...extra]/EditDraftDialog.svelte"
  import {
    discardPageDraft,
    getPageDraft,
    synchronizePageDraft
  } from "./[slug]/[...extra]/edit-lease-client"

  import type { PropertiesReport } from "$lib/wikidot/editor-properties"
  import type { PageDeletedGet } from "$lib/server/deepwell/page"
  import type {
    PageDraftContent,
    PageDraftPayload
  } from "./[slug]/[...extra]/edit-lease-client"
  let { errorData }: { errorData: PageErrorData } = $props()

  const pageLayoutContext = getPageLayoutContext()

  let showRestoreAction = $state<boolean>(false)
  let deletedPages = $state<PageDeletedGet[]>([])

  let draftDialog = $state<PageDraftContent | null>(null)
  let draftCheckState = $state<"idle" | "checking" | "ready" | "error">("idle")
  let draftSyncError = $state<string | null>(null)
  let draftBaselineFingerprint: string | null = null
  let initialDraftFingerprint: string | null = null
  let draftSyncInFlight = false
  let draftDebounce: ReturnType<typeof setTimeout> | undefined
  let stopDraftInterval: (() => void) | undefined
  const draftsEnabled = untrack(() => !errorData.data_form)

  const draftPayload = (): PageDraftPayload => ({
    title: $editForm.title ?? "",
    wikitext: $editForm.wikitext ?? "",
    comments: $editForm.comments ?? ""
  })
  const draftFingerprint = (payload: PageDraftPayload = draftPayload()) =>
    JSON.stringify(payload)
  const canSynchronizeDraft = () =>
    draftsEnabled && draftCheckState === "ready" && draftDialog === null

  async function ensureDraftChecked() {
    if (!draftsEnabled || draftCheckState !== "idle") return
    draftCheckState = "checking"
    try {
      const draft = (await getPageDraft(undefined)) as PageDraftContent | null
      if (draft) draftDialog = draft
      else draftBaselineFingerprint = initialDraftFingerprint
      draftCheckState = "ready"
    } catch (error) {
      draftSyncError =
        error instanceof Error ? error.message : "The page draft could not be checked."
      draftCheckState = "error"
    }
  }

  async function synchronizeDraft(force = false): Promise<boolean> {
    if (!canSynchronizeDraft() || draftSyncInFlight) return false
    const payload = draftPayload()
    const fingerprint = draftFingerprint(payload)
    if (!force && fingerprint === draftBaselineFingerprint) return true
    draftSyncInFlight = true
    try {
      await synchronizePageDraft(payload)
      draftBaselineFingerprint = fingerprint
      draftSyncError = null
      return true
    } catch (error) {
      draftSyncError =
        error instanceof Error
          ? error.message
          : "The page draft could not be synchronized."
      return false
    } finally {
      draftSyncInFlight = false
    }
  }

  const restoreDraft = () => {
    const draft = draftDialog
    if (!draft) return
    $editForm.title = draft.title
    $editForm.wikitext = draft.wikitext
    $editForm.comments = draft.comments
    draftDialog = null
    draftBaselineFingerprint = draftFingerprint({
      title: draft.title,
      wikitext: draft.wikitext,
      comments: draft.comments
    })
    draftSyncError = null
  }

  const discardDraft = async () => {
    try {
      await discardPageDraft(undefined)
      draftDialog = null
      draftBaselineFingerprint = initialDraftFingerprint
      draftSyncError = null
    } catch (error) {
      draftSyncError =
        error instanceof Error ? error.message : "The page draft could not be discarded."
    }
  }

  function cancelCreate() {
    goto(resolve(`${page.params.slug}`), {
      reset: false
    })
  }

  const createDenied = (): boolean => errorData.can_create !== true

  function showCreateDenied() {
    errorPopupState.current = {
      state: true,
      message: createPageDeniedMessage(),
      data: null
    }
  }

  function startCreate(event: MouseEvent) {
    event.preventDefault()
    if (createDenied()) {
      showCreateDenied()
      return
    }
    goto(resolve(`${missingPageSlug}/edit/true`), {
      reset: false
    })
  }

  $effect(() => {
    if (errorData.view === "missing" && errorData.options?.edit && createDenied()) {
      showCreateDenied()
    }
  })

  let propertiesReport = $state<PropertiesReport>({ ...IDLE_PROPERTIES_REPORT })
  const initialParents = untrack(() =>
    splitSpaceSeparated(errorData.options?.parent ?? "")
  )

  const { form: editForm, enhance: editEnhance } = superForm(
    untrack(() => errorData.forms.pageEditForm),
    {
      dataType: "json",
      onSubmit: async ({ jsonData, cancel }) => {
        const errors = propertiesErrors
        if (hasPropertyErrors(errors)) {
          propertiesReport = {
            state: "invalid",
            message: firstPropertyError(errors) ?? "Check the page properties."
          }
          cancel()
          return
        }
        propertiesReport = {
          state: "saving",
          step: "content",
          message: "Creating the page with its properties…"
        }
        const submitForm = {
          ...$editForm,
          siteId: errorData.site.site_id,
          slug: page.params.slug ?? page.error?.site.default_page
        }
        jsonData(submitForm)
      },
      onResult: async ({ result, cancel }) => {
        if (result.type === "success" && result.data) {
          cancel()
          const destinationSlug = pageMutationDestinationSlug({
            creating: true,
            requestedSlug: missingPageSlug,
            responseSlug: result.data.res?.slug
          })
          if (!destinationSlug) {
            errorPopupState.current = {
              state: true,
              message: "Page creation did not return its assigned slug.",
              data: {}
            }
            return
          }
          goto(resolve(`${destinationSlug}`), {
            reset: false
          })
        }
        if (result.type === "failure" && result.data) {
          propertiesReport = {
            state: "failed",
            step: "content",
            message: parentReportMessage(
              false,
              classifyPropertyActionError(result.data, "content")
            )
          }
          errorPopupState.current = {
            state: true,
            message: result.data.message,
            data: result.data.data
          }
        }
      }
    }
  )

  let activeTemplatePageId = $state<number | null>(
    untrack(() => errorData.selected_template_page_id ?? null)
  )
  let selectedTemplatePageId = $state<number | null>(
    untrack(() => errorData.selected_template_page_id ?? null)
  )
  let activeTemplateSource = $state<string>(untrack(() => $editForm.wikitext))
  const missingPageSlug = $derived(
    page.params.slug ?? page.error?.site.default_page ?? ""
  )
  // Mirror live Wikidot's new-page editor: the title field is pre-filled from
  // the URL-carried title when one was supplied (e.g. by a NewPage module),
  // otherwise from the page name using the same derivation #3757 uses in
  // EditorPane.svelte. This is the surface the "Create page" link flow reaches
  // for a missing page, so the pre-fill must be applied to its form field too.
  const missingPageTitle = $derived(
    errorData.options?.title ?? defaultPageTitleFromSlug(missingPageSlug)
  )
  // The plain editor field binds to $editForm.title; pre-fill it once at
  // creation. An explicitly emptied title still stores "" on save (matching
  // live), because this only sets the initial value.
  $editForm.title = untrack(() => missingPageTitle)
  $editForm.tags = untrack(() => errorData.options?.tags ?? "")
  $editForm.parent = untrack(() => errorData.options?.parent ?? "")

  const propertiesErrors = $derived(
    validateProperties({
      tags: $editForm.tags,
      parent: $editForm.parent ?? "",
      selfSlug: missingPageSlug,
      parentReady: true
    })
  )
  const templateLabel = $derived(
    errorData.page_templates?.find(
      (template) => template.page_id === selectedTemplatePageId
    )?.title ?? ""
  )
  initialDraftFingerprint = untrack(() => draftFingerprint())

  $effect(() => {
    if (!canSynchronizeDraft()) return
    const fingerprint = draftFingerprint()
    if (fingerprint === draftBaselineFingerprint) return
    clearTimeout(draftDebounce)
    draftDebounce = setTimeout(() => {
      void synchronizeDraft()
    }, 2000)
  })

  onMount(() => {
    const interval = setInterval(() => {
      void synchronizeDraft()
    }, 15000)
    stopDraftInterval = () => clearInterval(interval)
    void ensureDraftChecked()
  })

  onDestroy(() => {
    stopDraftInterval?.()
    clearTimeout(draftDebounce)
  })
  const canRestore = $derived(errorData.restore_available === true)
  const defaultMissingMessage = $derived(
    errorData.compiled_body_html.replace(/^\s*<p>/, '<p id="404-message">')
  )

  function handlePageTemplateChange() {
    if (
      $editForm.wikitext !== activeTemplateSource &&
      // Wikidot uses the browser's native confirmation before replacing edited source.
      // eslint-disable-next-line no-alert
      !globalThis.confirm(
        "It seems you have already changed the page.\nChanging the initial template now will reset the edited page.\nDo you want to change the initial content?"
      )
    ) {
      selectedTemplatePageId = activeTemplatePageId
      return
    }

    const template = errorData.page_templates?.find(
      (candidate) => candidate.page_id === selectedTemplatePageId
    )
    activeTemplatePageId = selectedTemplatePageId
    activeTemplateSource = template?.wikitext ?? ""
    $editForm.wikitext = activeTemplateSource
  }

  async function getDeleted() {
    const res = await fetch(`?/deletedGet`, {
      method: "POST",
      body: ""
    }).then((res) => res.text())
    const result = deserialize<
      { res: PageDeletedGet[] },
      { message: string; code: string; data: Record<string, unknown> }
    >(res)
    if (result.type === "failure" && result.data?.message) {
      errorPopupState.current = {
        state: true,
        message: result.data?.message,
        data: result.data?.data
      }
    } else if (result.type === "success" && result.data?.res) {
      deletedPages = result.data.res
      showRestoreAction = deletedPages.length > 0
    }
  }

  const { form: restoreForm, enhance: restoreEnhance } = superForm(
    untrack(() => errorData.forms.pageRestoreForm),
    {
      dataType: "json",
      onSubmit: async ({ jsonData }) => {
        const submitForm = {
          ...$restoreForm,
          siteId: page.data.site.site_id
        }
        jsonData(submitForm)
      },
      onResult: async ({ result }) => {
        if (result.type === "success" && result.data) {
          showRestoreAction = false
          invalidateAll()
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
</script>

{#if errorData.view === "missing"}
  {#if errorData.options?.edit && !createDenied()}
    {#if errorData.data_form}
      <div id="action-area">
        {#key `create:${missingPageSlug}`}
          <DataFormEditor
            creating={true}
            definition={errorData.data_form.definition}
            editForm={errorData.forms.pageEditForm}
            initialParent={errorData.options.parent ?? ""}
            initialSource=""
            initialTags={errorData.options.tags ?? ""}
            initialTitle={missingPageTitle}
            initialValues={errorData.data_form.values}
            pagepaths={errorData.data_form.pagepaths}
            siteId={errorData.site.site_id}
            slug={missingPageSlug}
          />
        {/key}
      </div>
    {:else}
      {#if pageLayoutContext.current === Layout.WIKIDOT}
        <h1 class="page-create-header">
          {errorData.internationalization?.["wiki-page-create"]}
        </h1>
      {:else}
        <h2 class="page-create-header">
          {errorData.internationalization?.["wiki-page-create"]}
        </h2>
      {/if}

      {#if draftSyncError}
        <p class="edit-draft-sync-error" role="alert">
          The page draft is not synchronized: {draftSyncError}
        </p>
      {/if}
      <form id="editor" class="editor" action="?/edit" method="POST" use:editEnhance>
        {#if errorData.page_templates?.length}
          <div class="page-template-selector">
            <label for="page-templates">Initial template:</label>
            <select
              id="page-templates"
              onchange={handlePageTemplateChange}
              bind:value={selectedTemplatePageId}
            >
              <option value={null}>no template</option>
              {#each errorData.page_templates as template (template.page_id)}
                <option value={template.page_id}>{template.title}</option>
              {/each}
            </select>
          </div>
        {/if}
        <EditorPropertiesPanel
          bind:title={$editForm.title}
          bind:altTitle={$editForm.altTitle}
          bind:tags={$editForm.tags}
          bind:comments={$editForm.comments}
          bind:parent={$editForm.parent}
          bind:layout={$editForm.layout}
          bind:report={propertiesReport}
          errors={propertiesErrors}
          creating={true}
          initialParent={initialParents}
          {templateLabel}
          slug={missingPageSlug}
        >
          <WikitextEditor
            name="wikitext"
            label={errorData.internationalization?.["wiki-page-source"] ?? "Page source"}
            bind:value={$editForm.wikitext}
          />
        </EditorPropertiesPanel>
        {#if pageLayoutContext.current === Layout.WIKIDOT}
          <div class="buttons">
            <input
              class="btn btn-danger"
              onclick={cancelCreate}
              type="button"
              value={errorData.internationalization?.cancel}
            />
            <input
              class="btn btn-primary"
              type="submit"
              value={errorData.internationalization?.save}
            />
          </div>
        {:else}
          <div class="action-row editor-actions">
            <button
              class="action-button editor-button button-cancel clickable"
              onclick={cancelCreate}
              type="button"
            >
              {errorData.internationalization?.cancel}
            </button>
            <button
              class="action-button editor-button button-save clickable"
              type="submit"
            >
              {errorData.internationalization?.save}
            </button>
          </div>
        {/if}
      </form>
      <WikitextPreviewPane
        siteId={errorData.site.site_id}
        title={$editForm.title}
        wikitext={$editForm.wikitext}
        label={errorData.internationalization?.preview ?? "Preview"}
      />
    {/if}
  {:else}
    <!--
      A site's own missing-page template (`_404`) replaces Wikidot's default
      state entirely. Otherwise Wikidot shows its title, the 404 message and
      one "Create page" link, in that order.
    -->
    {#if errorData.missing_template}
      <div id="page-content">
        {@html errorData.compiled_body_html}
      </div>
    {:else}
      <div id="page-title">The page does not (yet) exist.</div>
      <div id="page-content">
        {@html defaultMissingMessage}
        <ul id="create-it-now-link">
          <li>
            <a href={resolve(`${missingPageSlug}/edit/true`)} onclick={startCreate}
              >Create page</a
            >
          </li>
        </ul>
      </div>
    {/if}

    {#if canRestore}
      {#if pageLayoutContext.current === Layout.WIKIDOT}
        <div id="page-options-container">
          <div id="page-options-bottom" class="page-options-bottom">
            <!-- svelte-ignore a11y_invalid_attribute -->
            <a
              id="restore-button"
              class="btn btn-default"
              href="javascript:;"
              onclick={getDeleted}
              type="button"
            >
              {errorData.internationalization?.restore}
            </a>
          </div>
        </div>
      {:else}
        <div class="action-row editor-actions">
          <button
            class="action-button editor-button button-restore clickable"
            onclick={getDeleted}
            type="button"
          >
            {errorData.internationalization?.restore}
          </button>
        </div>
      {/if}
    {/if}

    {#if showRestoreAction}
      {#if pageLayoutContext.current === Layout.WIKIDOT}
        <div id="action-area">
          <h1 class="page-restore-header">
            {errorData.internationalization?.["wiki-page-restore"]}
          </h1>

          <form
            id="page-restore"
            class="page-restore"
            action="?/restore"
            method="POST"
            use:restoreEnhance
          >
            <fieldset>
              <legend>
                {errorData.internationalization?.["wiki-page-restore.select"]}
              </legend>
              {#each deletedPages as deletedPage (deletedPage.page_id)}
                <input
                  id={`restore-page-id-${deletedPage.page_id}`}
                  name="pageId"
                  class="page-restore-id"
                  checked={$restoreForm.pageId === deletedPage.page_id}
                  type="radio"
                  value={deletedPage.page_id}
                />
                <label for={`restore-page-id-${deletedPage.page_id}`}>
                  <span class="page-restore-title">{deletedPage.title}</span>
                  {#if deletedPage.alt_title}
                    &nbsp;-&nbsp;
                    <span class="page-restore-alt-title">
                      {deletedPage.alt_title}
                    </span>
                  {/if} (
                  <span class="page-restore-rating">
                    {(deletedPage.rating > 0 ? "+" : "") + deletedPage.rating}
                  </span>
                  ) - {errorData.internationalization?.["wiki-page-deleted"]?.replace(
                    "{$datetime}",
                    new Date(deletedPage.page_deleted_at).toLocaleString()
                  )}
                </label>
                <br />
              {/each}
            </fieldset>

            <textarea
              name="comments"
              class="page-restore-comments"
              placeholder={errorData.internationalization?.[
                "wiki-page-revision-comments"
              ]}
              bind:value={$restoreForm.comments}></textarea>

            <div class="buttons">
              <input
                class="btn btn-primary"
                onclick={() => (showRestoreAction = false)}
                type="button"
                value={errorData.internationalization?.cancel}
              />
              <input
                class="btn btn-primary"
                type="submit"
                value={errorData.internationalization?.restore}
              />
            </div>
          </form>
        </div>
      {:else}
        <h2 class="page-restore-header">
          {errorData.internationalization?.["wiki-page-restore"]}
        </h2>

        <form
          id="page-restore"
          class="page-restore"
          action="?/restore"
          method="POST"
          use:restoreEnhance
        >
          <fieldset>
            <legend>
              {errorData.internationalization?.["wiki-page-restore.select"]}
            </legend>
            {#each deletedPages as deletedPage (deletedPage.page_id)}
              <input
                id={`restore-page-id-${deletedPage.page_id}`}
                name="pageId"
                class="page-restore-id"
                checked={$restoreForm.pageId === deletedPage.page_id}
                type="radio"
                value={deletedPage.page_id}
                bind:group={$restoreForm.pageId}
              />
              <label for={`restore-page-id-${deletedPage.page_id}`}>
                <span class="page-restore-title">{deletedPage.title}</span
                >{#if deletedPage.alt_title}&nbsp;-&nbsp;<span
                    class="page-restore-alt-title">{deletedPage.alt_title}</span
                  >{/if} (<span class="page-restore-rating"
                  >{(deletedPage.rating > 0 ? "+" : "") + deletedPage.rating}</span
                >) - {errorData.internationalization?.["wiki-page-deleted"]?.replace(
                  "{$datetime}",
                  new Date(deletedPage.page_deleted_at).toLocaleString()
                )}
              </label>
              <br />
            {/each}
          </fieldset>

          <textarea
            name="comments"
            class="page-restore-comments"
            placeholder={errorData.internationalization?.["wiki-page-revision-comments"]}
            bind:value={$restoreForm.comments}></textarea>

          <div class="action-row page-restore-actions">
            <button
              class="action-button page-restore-button button-cancel clickable"
              onclick={() => (showRestoreAction = false)}
              type="button"
            >
              {errorData.internationalization?.cancel}
            </button>
            <button
              class="action-button page-restore-button button-restore clickable"
              type="submit"
            >
              {errorData.internationalization?.restore}
            </button>
          </div>
        </form>
      {/if}
    {/if}
  {/if}
{:else if errorData.view === "permissions"}
  <!-- The private/banned blueprint page carries the explanation. -->
  {@html errorData.compiled_body_html}
{:else}
  {errorData.internationalization?.["error-api.GENERIC"] ??
    "Something went wrong while handling your request."}
{/if}

{#if draftDialog}
  <EditDraftDialog
    title={draftDialog.title}
    onDiscard={discardDraft}
    onRestore={restoreDraft}
  />
{/if}

<style global lang="scss">
  .editor,
  .page-restore {
    display: flex;
    flex-direction: column;
    gap: 15px;
    align-items: stretch;
    justify-content: stretch;
    width: 100%;
  }

  .editor-wikitext {
    height: 60vh;
  }

  .editor-actions,
  .page-restore-actions {
    display: flex;
    flex-direction: row;
    gap: 10px;
    align-items: stretch;
    justify-content: flex-end;
    width: 100%;
  }
</style>
