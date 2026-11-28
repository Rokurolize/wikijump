<script lang="ts">
  import { goto } from "$app/navigation"
  import { deserialize } from "$app/forms"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { getPageLayoutContext } from "$lib/layout/page-layout-context"
  import { Layout } from "$lib/types"
  import { resolve } from "$app/paths"
  import { classifyEditLeaseSaveError } from "$lib/wikidot/wikidot-edit-lease.js"
  import { defaultPageTitleFromSlug } from "$lib/wikidot/wikidot-page-title"
  import { superForm } from "sveltekit-superforms"
  import { onDestroy, onMount, untrack } from "svelte"

  import WikitextEditor from "$lib/component/WikitextEditor.svelte"

  import DataFormEditor from "./DataFormEditor.svelte"
  import EditLeaseDialog from "./EditLeaseDialog.svelte"
  import { createPageEditLeaseSession, startEditLeaseTimers } from "./edit-lease-client"

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
  let previewPending = $state(false)
  let stopLeaseTimers: (() => void) | undefined

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
      onSubmit: async ({ jsonData }) => {
        const fields = leaseRequired ? leaseSession.saveFields() : undefined
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
          errorPopupState.current = {
            state: true,
            message: result.data.message,
            data: result.data.data
          }
        }
      }
    }
  )

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

  const previewEdit = async () => {
    if (previewPending) return
    previewPending = true
    try {
      const text = await fetch("?/preview", {
        method: "POST",
        body: JSON.stringify({
          siteId: data.site.site_id,
          title: $form.title,
          wikitext: $form.wikitext
        })
      }).then((res) => res.text())
      const result = deserialize<
        { res: { body: string; styles: string[] } },
        { message: string }
      >(text)
      if (result.type !== "success" || typeof result.data?.res.body !== "string") {
        throw new Error("Preview request failed.")
      }
      const container = document.querySelector<HTMLElement>("#page-content")
      if (!container) return
      container.innerHTML = result.data.res.body
      if (result.data.res.styles?.length) {
        const style = document.createElement("style")
        style.textContent = result.data.res.styles.join("\n")
        container.append(style)
      }
    } catch (error) {
      errorPopupState.current = {
        state: true,
        message: error instanceof Error ? error.message : "Preview failed.",
        data: null
      }
    } finally {
      previewPending = false
    }
  }
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
      <input
        name="title"
        class="editor-title"
        placeholder={data.internationalization?.title}
        type="text"
        bind:value={$form.title}
      />
      <input
        name="altTitle"
        class="editor-alt-title"
        placeholder={data.internationalization?.["alt-title"]}
        type="text"
        bind:value={$form.altTitle}
      />
      <WikitextEditor
        name="wikitext"
        label={data.internationalization?.["wiki-page-source"] ?? "Page source"}
        bind:value={$form.wikitext}
      />
      <input
        name="tags"
        class="editor-tags"
        placeholder={data.internationalization?.tags}
        type="text"
        bind:value={$form.tags}
      />
      <textarea
        name="comments"
        class="editor-comments"
        placeholder={data.internationalization?.["wiki-page-revision-comments"]}
        bind:value={$form.comments}></textarea>
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
            id="edit-preview-button"
            name="preview"
            class="btn btn-default"
            onclick={previewEdit}
            type="button"
            value={data.internationalization?.preview}
            disabled={previewPending}
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
          <button
            id="edit-preview-button"
            class="action-button editor-button button-preview clickable"
            onclick={previewEdit}
            type="button"
            disabled={previewPending}
          >
            {data.internationalization?.preview}
          </button>
          <button class="action-button editor-button button-save clickable" type="submit">
            {data.internationalization?.save}
          </button>
        </div>
      {/if}
    </form>
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
