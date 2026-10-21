<script lang="ts">
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { superForm } from "sveltekit-superforms"
  import { untrack } from "svelte"

  import type { PageProps } from "./$types"

  let { data, form: actionData }: PageProps = $props()

  let verified = $derived(actionData?.verified === true)

  const { form, enhance } = superForm(
    untrack(() => data.verifyTokenForm),
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

{#if verified}
  <p role="status" class="auth-notice">
    {data.internationalization?.["wiki-auth-verify-email-link.success"]}
  </p>
{:else}
  <p class="auth-notice">
    {data.internationalization?.["wiki-auth-verify-email-link.waiting"]}
  </p>
  <p class="auth-notice">
    {data.internationalization?.["wiki-auth-verify-email-link.please-interact"]}
    {data.internationalization?.["wiki-auth-verify-email-link.instructions"]}
  </p>
  <form id="verify-email-link" class="login-form" method="POST" use:enhance>
    <input name="token" type="hidden" bind:value={$form.token} />
    <div class="action-row auth-actions">
      <button class="action-button auth-button button-login clickable" type="submit">
        {data.internationalization?.["wiki-auth-verify-email-link"]}
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
