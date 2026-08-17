<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { superForm } from "sveltekit-superforms"
  import { untrack } from "svelte"

  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()
  let savedLocales = $state(
    untrack(() => data.user_session?.user.locales?.join(" ") ?? "")
  )
  let savedSignature = $state(
    untrack(() => data.user_session?.user.forum_signature ?? "")
  )

  const { form, enhance } = superForm(
    untrack(() => data.displaySettingsForm),
    {
      onResult: async ({ result }) => {
        if (result.type === "success") {
          savedLocales = $form.locales
          savedSignature = $form.signature
          await invalidateAll()
        } else if (result.type === "failure" && result.data) {
          errorPopupState.current = {
            state: true,
            message: result.data.message,
            data: result.data
          }
        }
      }
    }
  )
</script>

<h1>{data.internationalization?.settings}</h1>

<form id="user-settings-form" action="?/display" method="POST" use:enhance>
  <label for="user-display-locales">
    {data.internationalization?.["user-profile-info.locales"]}
  </label>
  <input
    id="user-display-locales"
    name="locales"
    bind:value={$form.locales}
    required
    type="text"
  />
  <label for="forum-signature-source"> Forum signature </label>
  <textarea
    id="forum-signature-source"
    name="signature"
    maxlength="400"
    rows="4"
    bind:value={$form.signature}></textarea>
  <p class="settings-note">
    400 characters maximum. Only 4 lines. Wiki syntax is supported.
  </p>
  <div class="action-row user-settings-actions">
    <button
      class="action-button button-cancel clickable"
      onclick={() => {
        $form.locales = savedLocales
        $form.signature = savedSignature
      }}
      type="button"
    >
      {data.internationalization?.cancel}
    </button>
    <button class="action-button button-save clickable" type="submit">
      {data.internationalization?.save}
    </button>
  </div>
</form>

<style lang="scss">
  #user-settings-form {
    display: grid;
    gap: 0.75rem;
    max-width: 40rem;
  }

  #forum-signature-source {
    min-height: 7rem;
  }

  .user-settings-actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
