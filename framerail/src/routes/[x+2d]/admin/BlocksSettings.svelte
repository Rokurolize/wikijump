<script lang="ts">
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()

  type LookupUser = { user_id: number; name: string }
  type SiteBan = {
    metadata: { banned_until: string | null; reason: string }
    created_at: string
  }

  let lookupUser = $state<LookupUser | null>(null)
  let lookupBan = $state<SiteBan | null>(null)

  const { form, enhance } = superForm(
    untrack(() => data.blockLookupForm),
    {
      dataType: "json",
      resetForm: false,
      onSubmit: async ({ jsonData }) => {
        jsonData({ ...$form, siteId: data.site.site_id })
      },
      onResult: async ({ result }) => {
        if (result.type === "success" && result.data) {
          const payload = result.data as {
            user?: LookupUser | null
            ban?: SiteBan | null
          }
          lookupUser = payload.user ?? null
          lookupBan = payload.ban ?? null
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

  $effect(() => {
    $form.siteId = data.site.site_id
    $form.userId = lookupUser?.user_id ?? $form.userId
  })
</script>

<section id="wikidot-blocks-settings" class="admin-section">
  <div class="page-header"><h2>Blocks</h2></div>
  <form class="editor" action="?/blockLookup" method="POST" use:enhance>
    <label class="control-label" for="block-user-id">User ID</label>
    <input
      id="block-user-id"
      class="text"
      type="number"
      min="1"
      step="1"
      bind:value={$form.userId}
    />
    <div class="action-row">
      <button class="btn btn-primary" type="submit">Check user</button>
    </div>
  </form>

  {#if lookupUser}
    <div class="lookup-result">
      <h3>{lookupUser.name} ({lookupUser.user_id})</h3>
      {#if lookupBan}
        <p>
          Blocked since {lookupBan.created_at}. Reason: {lookupBan.metadata.reason}
          {#if lookupBan.metadata.banned_until}
            Expires: {lookupBan.metadata.banned_until}
          {/if}
        </p>
        <form class="editor" action="?/blockRemove" method="POST">
          <input name="siteId" type="hidden" value={data.site.site_id} />
          <input name="userId" type="hidden" value={lookupUser.user_id} />
          <label class="control-label" for="unblock-reason">Unblock reason</label>
          <input
            id="unblock-reason"
            class="text"
            name="reason"
            type="text"
            maxlength="200"
            required
          />
          <div class="action-row">
            <button class="btn btn-primary" type="submit">Unblock user</button>
          </div>
        </form>
      {:else}
        <p>This user is not blocked from the site.</p>
        <form class="editor" action="?/blockSet" method="POST">
          <input name="siteId" type="hidden" value={data.site.site_id} />
          <input name="userId" type="hidden" value={lookupUser.user_id} />
          <label class="control-label" for="block-reason">Reason</label>
          <input
            id="block-reason"
            class="text"
            name="reason"
            type="text"
            maxlength="200"
            required
          />
          <label class="control-label" for="block-until">Expires on (optional)</label>
          <input id="block-until" class="text" name="bannedUntil" type="date" />
          <div class="action-row">
            <button class="btn btn-primary" type="submit">Block user</button>
          </div>
        </form>
      {/if}
    </div>
  {/if}
</section>

<style>
  .lookup-result {
    margin-top: 1.5rem;
  }
</style>
