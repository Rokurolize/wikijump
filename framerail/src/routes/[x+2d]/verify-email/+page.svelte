<script lang="ts">
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { superForm } from "sveltekit-superforms"
  import { untrack } from "svelte"

  import type { PageProps } from "./$types"

  let { data, form: actionData }: PageProps = $props()

  let sent = $derived(actionData?.sent === true)

  const { form, enhance } = superForm(
    untrack(() => data.verifyForm),
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

<h1>{data.internationalization?.["wiki-auth-verify-email"]}</h1>
<p class="auth-notice">{data.internationalization?.["wiki-auth-verify-email.intro"]}</p>
{#if sent}
  <p role="status" class="auth-notice">
    {data.internationalization?.["wiki-auth-verify-email.email-sent"]}
  </p>
{:else}
  <form id="verify-email" class="login-form" method="POST" use:enhance>
    <label class="visually-hidden" for="verify-email-address">
      {data.internationalization?.email}
    </label>
    <input
      id="verify-email-address"
      name="email"
      class="auth-name-or-email"
      autocomplete="email"
      placeholder={data.internationalization?.email}
      type="email"
      bind:value={$form.email}
    />
    <div class="action-row auth-actions">
      <button class="action-button auth-button button-login clickable" type="submit">
        {data.internationalization?.["wiki-auth-verify-email.resend-email"] ??
          data.internationalization?.send}
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

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      white-space: nowrap;
      border: 0;
      clip: rect(0, 0, 0, 0);
    }
  }

  .auth-notice {
    text-align: center;
  }
</style>
