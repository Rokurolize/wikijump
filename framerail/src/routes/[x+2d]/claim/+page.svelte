<script lang="ts">
  import { goto } from "$app/navigation"
  import { resolve } from "$app/paths"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { authCancelDestination } from "$lib/auth-cancel.js"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data, form: actionData }: PageProps = $props()

  let enhancedClaimSucceeded = $state(false)
  let isClaimed = $derived(actionData?.isClaimed === true || enhancedClaimSucceeded)
  let challengeToken = $derived(
    (actionData as { challengeToken?: string } | null)?.challengeToken ?? ""
  )
  let challengeNonce = $derived(
    (actionData as { challengeNonce?: string | null } | null)?.challengeNonce ?? null
  )
  let verifiedToken = $derived(
    (actionData as { verifiedToken?: string } | null)?.verifiedToken ?? ""
  )
  let challengeError = $derived(
    (actionData as { challengeError?: string } | null)?.challengeError ?? null
  )

  $effect(() => {
    if (verifiedToken) {
      $form.claimToken = verifiedToken
    }
  })

  const cancelClaim = async () => {
    await goto(resolve(authCancelDestination()), { replaceState: true })
  }

  const { form, enhance, errors } = superForm(
    untrack(() => data.claimForm),
    {
      onResult: async ({ result, cancel }) => {
        if (result.type === "success" && result.data?.isClaimed) {
          enhancedClaimSucceeded = true
          cancel()
          return
        }

        if (result.type === "failure" && result.data?.message) {
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

{#if isClaimed}
  <p role="status" class="claim-success">
    Your imported Wikidot account has been activated. Check your email to verify your
    address, then
    <a href={resolve("-/login")}>{data.internationalization?.login ?? "log in"}</a>.
  </p>
{:else}
  <section class="claim-challenge">
    <h2>Step 1: Prove Wikidot ownership (or use a staff-issued token below)</h2>
    <form method="POST" action="?/startChallenge" class="challenge-form">
      <label for="wikidot-user-id">Wikidot user ID</label>
      <div class="input-container">
        <input
          id="wikidot-user-id"
          name="wikidotUserId"
          type="number"
          min="1"
          required
          placeholder="e.g. 123456"
        />
        <button type="submit">Start profile challenge</button>
      </div>
    </form>

    {#if challengeError}
      <p class="error">{challengeError}</p>
    {/if}

    {#if challengeNonce && challengeToken}
      <div class="challenge-instructions">
        <p>
          Add this verification code to your Wikidot profile biography or website, then
          click
          <strong>Verify profile</strong>:
        </p>
        <pre><code>{challengeNonce}</code></pre>
        <form method="POST" action="?/verifyChallenge">
          <input type="hidden" name="challengeToken" value={challengeToken} />
          <button type="submit">Verify profile</button>
        </form>
      </div>
    {/if}
  </section>

  <form id="claim-account" class="claim-form" method="POST" use:enhance>
    <label for="claim-token">Claim token</label>
    <div class="input-container">
      <input
        id="claim-token"
        name="claimToken"
        class="claim-token"
        autocomplete="off"
        placeholder="Paste your claim token"
        required
        type="text"
        bind:value={$form.claimToken}
      />
      {#if $errors.claimToken}
        <p class="error">A valid claim token is required.</p>
      {/if}
    </div>

    <label for="email">
      {data.internationalization?.["email"]}
    </label>
    <div class="input-container">
      <input
        id="email"
        name="email"
        class="email"
        autocomplete="email"
        placeholder={data.internationalization?.["email.placeholder"]}
        required
        type="text"
        bind:value={$form.email}
      />
      <p class="description">{data.internationalization?.["email.info"]}</p>
      {#if $errors.email}
        <p class="error">{data.internationalization?.["error-form.email-invalid"]}</p>
      {/if}
    </div>

    <label for="password">
      {data.internationalization?.["password"]}
    </label>
    <div class="input-container">
      <input
        id="password"
        name="password"
        class="auth-password"
        autocomplete="new-password"
        aria-invalid={$errors.password ? "true" : undefined}
        aria-describedby={$errors.password ? "claim-password-error" : undefined}
        placeholder={data.internationalization?.["password.placeholder"]}
        required
        type="password"
        bind:value={$form.password}
      />
      {#if $errors.password}
        <p id="claim-password-error" class="error">
          {data.internationalization?.["error-form.password-too-short"]}
        </p>
      {/if}
    </div>

    <label for="confirm-password">
      {data.internationalization?.["confirm-password"]}
    </label>
    <div class="input-container">
      <input
        id="confirm-password"
        name="confirmPassword"
        class="confirm-password"
        autocomplete="new-password"
        aria-invalid={$errors.confirmPassword ? "true" : undefined}
        aria-describedby={$errors.confirmPassword
          ? "claim-confirm-password-error"
          : undefined}
        placeholder={data.internationalization?.["password.placeholder"]}
        required
        type="password"
        bind:value={$form.confirmPassword}
      />
      {#if $errors.confirmPassword}
        <p id="claim-confirm-password-error" class="error">
          {data.internationalization?.["error-form.password-mismatch"]}
        </p>
      {/if}
    </div>

    <label for="locale">
      {data.internationalization?.["dashboard-account.language"]}
    </label>
    <div class="input-container">
      <select id="locale" name="locale" multiple required bind:value={$form.locale}>
        {#each data.userInterfaceLocales as locale (locale.value)}
          <option value={locale.value}>{locale.label}</option>
        {/each}
      </select>
    </div>

    <div class="honeypot" aria-hidden="true">
      <label for="leave-blank">Leave blank</label>
      <input
        id="leave-blank"
        name="leaveBlank"
        tabindex="-1"
        autocomplete="off"
        type="text"
        bind:value={$form.leaveBlank}
      />
    </div>

    <div class="buttons">
      <button type="submit">Activate account</button>
      <button type="button" onclick={cancelClaim}>
        {data.internationalization?.["cancel"] ?? "Cancel"}
      </button>
    </div>
  </form>
{/if}

<style lang="postcss">
  .claim-challenge {
    max-width: 42rem;
    margin: 2rem auto 1rem;
  }

  .challenge-form,
  .claim-form {
    display: grid;
    grid-template-columns: minmax(10rem, auto) 1fr;
    gap: 1rem;
    max-width: 42rem;
    margin: 2rem auto;
  }

  .honeypot {
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  .buttons {
    grid-column: 2;
    display: flex;
    gap: 0.75rem;
  }

  .error {
    color: var(--error-color, #b91c1c);
  }
</style>
