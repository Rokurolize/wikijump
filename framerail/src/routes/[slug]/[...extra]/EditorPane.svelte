<script lang="ts">
  import { goto } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { getPageLayoutContext } from "$lib/layout/page-layout-context"
  import { Layout } from "$lib/types"
  import { resolve } from "$app/paths"
  import { classifyEditLeaseSaveError } from "$lib/wikidot/wikidot-edit-lease.js"
  import { defaultPageTitleFromSlug } from "$lib/wikidot/wikidot-page-title"
  import { superForm } from "sveltekit-superforms"
  import { onDestroy, onMount, untrack } from "svelte"

  import EditorPropertiesPanel from "$lib/component/EditorPropertiesPanel.svelte"
  import WikitextEditor from "$lib/component/WikitextEditor.svelte"
  import WikitextPreviewPane from "$lib/component/WikitextPreviewPane.svelte"
  import {
    classifyPropertyActionError,
    diffParents,
    firstPropertyError,
    hasPropertyErrors,
    IDLE_PROPERTIES_REPORT,
    parentReportMessage,
    splitSpaceSeparated,
    validateProperties
  } from "$lib/wikidot/editor-properties"

  import DataFormEditor from "./DataFormEditor.svelte"
  import EditLeaseDialog from "./EditLeaseDialog.svelte"
  import { createPageEditLeaseSession, startEditLeaseTimers } from "./edit-lease-client"

  import type { ParentChange, PropertiesReport } from "$lib/wikidot/editor-properties"
  import type { EditLeaseConflict } from "$lib/wikidot/wikidot-edit-lease.js"
  import type { PageProps } from "./$types"

  let { data, params }: PageProps = $props()
  const pageLayoutContext = getPageLayoutContext()

  const leaseRequired = untrack(
    () => typeof data.page?.page_id === "number" && data.page.page_id > 0
  )
  const leaseSession = createPageEditLeaseSession()
  let leaseSnapshot = $state<{
    status: string
    conflicts: EditLeaseConflict[]
    seconds: number
    superseded: boolean
  }>({
    status: "idle",
    conflicts: [],
    seconds: 0,
    superseded: false
  })
  let leaseDialog = $state<"page_changed" | "other_locks" | null>(null)
  let stopLeaseTimers: (() => void) | undefined

  let initialParents = $state<string[]>([])
  let parentReady = $state(false)
  let canMoveParent = $state(false)
  let propertiesReport = $state<PropertiesReport>({ ...IDLE_PROPERTIES_REPORT })
  let pendingParentChange: ParentChange | null = null
  let parentResultResolve: ((applied: boolean) => void) | null = null

  const currentLayoutLabel = untrack(() => {
    const layout = data.page?.layout
    if (!layout)
      return data.internationalization?.["wiki-page-layout.default"] ?? "Default"
    return data.internationalization?.[`wiki-page-layout.${layout}`] ?? String(layout)
  })

  const syncLease = () => {
    leaseSnapshot = {
      status: leaseSession.status,
      conflicts: leaseSession.conflictRows(),
      seconds: leaseSession.secondsRemaining(),
      superseded: leaseSession.status === "superseded"
    }
  }

  function cancelEdit() {
    void leaseSession.close()
    const options: string[] = Object.entries({
      norender: data.options.no_render,
      noredirect: data.options.no_redirect
    })
      .filter(([, enabled]) => enabled)
      .map(([key]) => `/${key}`)

    goto(resolve(`${params.slug}${options.join("")}`), {
      reset: false
    })
  }

  const forceLease = async () => {
    await leaseSession.forceOpen()
    syncLease()
  }

  const reacquireLease = async () => {
    leaseDialog = null
    await leaseSession.reopen()
    syncLease()
  }

  const reloadEditor = async () => {
    leaseDialog = null
    await leaseSession.close()
    window.location.reload()
  }

  const copyEditorText = () => {
    void navigator.clipboard?.writeText($form.wikitext)
  }

  onMount(() => {
    if (!leaseRequired) return
    stopLeaseTimers = startEditLeaseTimers(leaseSession, syncLease)
    void (async () => {
      try {
        const opening = leaseSession.open("page", undefined)
        syncLease()
        await opening
      } catch (error) {
        errorPopupState.current = {
          state: true,
          message:
            error instanceof Error ? error.message : "The edit lock request failed.",
          data: null
        }
        cancelEdit()
        return
      }
      syncLease()
    })()
  })

  onDestroy(() => {
    stopLeaseTimers?.()
    void leaseSession.close()
  })

  const { form, enhance } = superForm(
    untrack(() => data.forms.pageEditForm),
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

        const fields = leaseRequired ? leaseSession.saveFields() : undefined
        const nextParents = splitSpaceSeparated($form.parent ?? "")
        const change = diffParents(initialParents, nextParents)
        pendingParentChange = change.add.length || change.remove.length ? change : null
        propertiesReport = {
          state: "saving",
          step: pendingParentChange ? "parent" : "content",
          message: pendingParentChange
            ? "Saving page content, then applying the page-tree move…"
            : "Saving page properties…"
        }
        const submitForm = {
          ...$form,
          siteId: data.site.site_id,
          pageId: data.page?.page_id,
          lastRevisionId: fields
            ? fields.lastRevisionId
            : data.page_revision?.revision_id,
          ...(fields
            ? {
                lockId: fields.lockId,
                "lockSecret": fields.lockSecret,
                leaseMode: fields.mode,
                sectionIndex: fields.sectionIndex ?? null
              }
            : {})
        }
        jsonData(submitForm)
      },
      onResult: async ({ result, cancel }) => {
        if (result.type === "success" && result.data) {
          cancel()
          if (leaseRequired) {
            leaseSession.noteSaveSucceeded(result.data.res)
            syncLease()
          }
          if (pendingParentChange) {
            propertiesReport = {
              state: "saving",
              step: "parent",
              message: "Page content saved. Applying the page-tree move…"
            }
            const applied = await runParentMutation()
            if (!applied) return
          }
          goto(resolve(`${params.slug}`), {
            reset: false
          })
        }
        if (result.type === "failure" && result.data) {
          const kind = leaseRequired
            ? classifyEditLeaseSaveError((result.data as { code?: number }).code)
            : null
          if (kind) {
            leaseSession.noteSaveRejected(kind)
            leaseDialog = kind
            syncLease()
            return
          }
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

  const { submit: submitParentForm, enhance: parentEnhance } = superForm(
    untrack(() => data.forms.pageParentForm),
    {
      dataType: "json",
      onSubmit: async ({ jsonData }) => {
        const change = pendingParentChange
        jsonData({
          siteId: data.site.site_id,
          pageId: data.page?.page_id,
          addParents: change?.add.length ? change.add : undefined,
          removeParents: change?.remove.length ? change.remove : undefined
        })
      },
      onResult: async ({ result, cancel }) => {
        cancel()
        const applied = result.type === "success"
        if (!applied && result.type === "failure" && result.data) {
          propertiesReport = {
            state: "partial",
            step: "parent",
            message: parentReportMessage(
              true,
              classifyPropertyActionError(result.data, "parent")
            )
          }
        } else if (!applied) {
          propertiesReport = {
            state: "partial",
            step: "parent",
            message: parentReportMessage(
              true,
              "The page-tree move request failed. Check the parent page and try again."
            )
          }
        } else {
          propertiesReport = {
            state: "saved",
            message: "Page properties and the page-tree move were saved."
          }
        }
        parentResultResolve?.(applied)
        parentResultResolve = null
        pendingParentChange = null
      }
    }
  )

  function runParentMutation(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      parentResultResolve = resolve
      submitParentForm()
    })
  }

  function retryParentChange() {
    const change = diffParents(initialParents, splitSpaceSeparated($form.parent ?? ""))
    if (!change.add.length && !change.remove.length) return
    pendingParentChange = change
    propertiesReport = {
      state: "saving",
      step: "parent",
      message: "Applying the page-tree move…"
    }
    void runParentMutation().then((applied) => {
      if (applied) {
        goto(resolve(`${params.slug}`), {
          reset: false
        })
      }
    })
  }

  // For a new page there is no stored title yet: mirror live Wikidot's
  // editor, which pre-fills the title field -- with the title carried in
  // the URL when one was supplied (e.g. by a NewPage module), and with
  // the title derived from the page name otherwise. An existing page
  // always starts from its stored title, even when that title is empty.
  $form.title = untrack(
    () =>
      data.page_revision?.title ??
      data.options.title ??
      defaultPageTitleFromSlug(params.slug)
  )
  $form.altTitle = untrack(() => data.page_revision?.alt_title ?? "")
  $form.wikitext = untrack(() => data.wikitext)
  $form.tags = untrack(() => data.page_revision?.tags?.join(" ") ?? "")
  $form.comments = untrack(() => data.page_revision?.comments ?? "")
  $form.parent = ""

  const propertiesErrors = $derived(
    validateProperties({
      tags: $form.tags,
      parent: $form.parent ?? "",
      selfSlug: params.slug,
      parentReady
    })
  )
</script>

{#if leaseRequired && leaseSnapshot.status === "acquiring"}
  <p role="status">Acquiring the page edit lock&hellip;</p>
{:else if leaseRequired && leaseSnapshot.status === "conflict"}
  <p role="alert">This page is being edited by another user.</p>
{:else}
  {#if leaseSnapshot.superseded}
    <p class="edit-lease-superseded" role="alert">
      Your edit lock was taken by another user. Saving will be rejected until you take the
      lock back.
      <button class="btn" onclick={reacquireLease} type="button">
        Take the lock back
      </button>
    </p>
  {/if}

  {#if data.data_form}
    {#key `edit:${params.slug}:${data.page_revision?.revision_id ?? 0}`}
      <DataFormEditor
        creating={false}
        definition={data.data_form.definition}
        editForm={data.forms.pageEditForm}
        initialAltTitle={data.page_revision?.alt_title ?? ""}
        initialComments={data.page_revision?.comments ?? ""}
        initialSource={data.wikitext}
        initialTags={data.page_revision?.tags?.join(" ") ?? ""}
        initialTitle={data.page_revision?.title ?? ""}
        initialValues={data.data_form.values}
        lastRevisionId={data.page_revision?.revision_id}
        leaseSaveFields={() => (leaseRequired ? leaseSession.saveFields() : undefined)}
        onLeaseSaveFailure={(failure) => {
          const kind = classifyEditLeaseSaveError(failure.code)
          if (!kind) return false
          leaseSession.noteSaveRejected(kind)
          leaseDialog = kind
          syncLease()
          return true
        }}
        onLeaseSaveSuccess={(res) => {
          leaseSession.noteSaveSucceeded(res as { revision_id?: number })
          syncLease()
        }}
        pageId={data.page?.page_id}
        pagepaths={data.data_form.pagepaths}
        siteId={data.site.site_id}
        slug={params.slug}
      />
    {/key}
  {:else}
    {#if pageLayoutContext.current === Layout.WIKIDOT}
      <h1 class="page-edit-header">
        {data.internationalization?.["wiki-page-edit"]}
      </h1>
    {:else}
      <h2 class="page-edit-header">
        {data.internationalization?.["wiki-page-edit"]}
      </h2>
    {/if}

    <form id="editor" class="editor" action="?/edit" method="POST" use:enhance>
      <EditorPropertiesPanel
        bind:title={$form.title}
        bind:altTitle={$form.altTitle}
        bind:tags={$form.tags}
        bind:comments={$form.comments}
        bind:parent={$form.parent}
        bind:initialParent={initialParents}
        bind:parentReady
        bind:canMove={canMoveParent}
        bind:report={propertiesReport}
        errors={propertiesErrors}
        {currentLayoutLabel}
        onRetryParent={retryParentChange}
        slug={params.slug}
      >
        <WikitextEditor
          name="wikitext"
          label={data.internationalization?.["wiki-page-source"] ?? "Page source"}
          bind:value={$form.wikitext}
        />
      </EditorPropertiesPanel>
      {#if pageLayoutContext.current === Layout.WIKIDOT}
        <div class="buttons alignleft">
          <input
            name="cancel"
            class="btn btn-danger"
            onclick={cancelEdit}
            type="button"
            value={data.internationalization?.cancel}
          />
          <input
            name="save"
            class="btn btn-primary"
            type="submit"
            value={data.internationalization?.save}
          />
        </div>
      {:else}
        <div class="action-row editor-actions">
          <button
            class="action-button editor-button button-cancel clickable"
            onclick={cancelEdit}
            type="button"
          >
            {data.internationalization?.cancel}
          </button>
          <button class="action-button editor-button button-save clickable" type="submit">
            {data.internationalization?.save}
          </button>
        </div>
      {/if}
    </form>
    <form
      id="ed6-parent-mutation"
      action="?/parentSet"
      method="POST"
      use:parentEnhance
      hidden
      aria-hidden="true"
    ></form>
    <WikitextPreviewPane
      siteId={data.site.site_id}
      title={$form.title}
      wikitext={$form.wikitext}
      label={data.internationalization?.preview ?? "Preview"}
    />
  {/if}
{/if}

{#if leaseRequired && leaseSnapshot.status === "conflict"}
  <EditLeaseDialog
    conflicts={leaseSnapshot.conflicts}
    kind="conflict"
    onCancel={cancelEdit}
    onForce={forceLease}
  />
{/if}

{#if leaseDialog}
  <EditLeaseDialog
    kind={leaseDialog}
    onClose={() => (leaseDialog = null)}
    onCopyText={data.data_form ? undefined : copyEditorText}
    onLeave={cancelEdit}
    onReacquire={reacquireLease}
    onReload={reloadEditor}
    onViewPage={cancelEdit}
  />
{/if}

<style lang="scss">
  .editor-actions {
    padding: 0 0 2em;
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: 15px;
    align-items: stretch;
    justify-content: stretch;
    width: 100%;
  }
</style>
