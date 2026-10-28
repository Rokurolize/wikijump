<script lang="ts">
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { superForm } from "sveltekit-superforms"
  import { untrack } from "svelte"

  import type { PageProps } from "./$types"

  let { data, form: actionData }: PageProps = $props()

  let sent = $derived(actionData?.sent === true)

  const { enhance } = superForm(
    untrack(() => data.deleteForm),
    {
      onResult: async ({ result }) => {
        if (result.type === "failure" && result.data) {
          errorPopupState.current = {
            state: true,
            message: result.data?.message,
            data: result.data?.data
          }
        }
      }
    }
  )
</script>

{#if sent}
  <p role="status" class="auth-notice">
    <!-- LOCAL DEFAULT pending Wikidot evidence: exact delete-flow copy is not evidenced. -->
    A confirmation email has been sent to your account address. Click the link inside it to
    continue deleting your account.
  </p>
{:else}
  <!-- LOCAL DEFAULT pending Wikidot evidence: exact delete-flow copy is not evidenced. -->
  <h1>Delete Account</h1>
  <p class="auth-notice">
    Deleting your account is permanent. Your wikis will stay hosted. We will email a
    confirmation link to your account address. Follow it, then confirm with your password.
  </p>
  <form id="delete-account" class="login-form" method="POST" use:enhance>
    <div class="action-row auth-actions">
      <button class="action-button auth-button button-login clickable" type="submit">
        {data.internationalization?.send}
      </button>
    </div>
  </form>
{/if}

<style lang="scss">
  .login-form {
    display: flex;
    flex-direction: column;
    gap: 1em;
    align-items: center;
    justify-content: center;

    .action-row {
      justify-content: center;
    }
  }

  .auth-notice {
    text-align: center;
  }
</style>
