<script lang="ts">
  import { resolve } from "$app/paths"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  const { form, enhance, errors } = superForm(
    untrack(() => data.registerForm),
    {
      onResult: ({ result }) => {
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

<form id="register" class="register-form" method="POST" use:enhance>
  <label for="username">
    {data.internationalization?.["username"]}
  </label>
  <div class="input-container">
    <input
      id="username"
      name="username"
      class="username"
      placeholder={data.internationalization?.["username.placeholder"]}
      required
      type="text"
      bind:value={$form.username}
    />
    <p class="description">{data.internationalization?.["username.info"]}</p>
  </div>

  <label for="email">
    {data.internationalization?.["email"]}
  </label>
  <div class="input-container">
    <input
      id="email"
      name="email"
      class="email"
      placeholder={data.internationalization?.["email.placeholder"]}
      required
      type="text"
      bind:value={$form.email}
    />
    <p class="description">{data.internationalization?.["email.info"]}</p>
    {#if $errors.email}
      <!-- Although `error-api.INVALID_EMAIL` is almost the same as this one, it should
            get another name in `error-form` to avoid confusion -->
      <p class="error">UNTRANSLATED: Email format is invalid.</p>
    {/if}
  </div>

  <label for="password">
    {data.internationalization?.["password"]}
  </label>
  <div class="input-container">
    <input
      name="password"
      class="auth-password"
      placeholder={data.internationalization?.["password.placeholder"]}
      required
      type="password"
      bind:value={$form.password}
    />
    {#if $errors.password}
      <p class="error">
        {data.internationalization?.["error-form.password-too-short"]}
      </p>
    {/if}
  </div>

  <label for="confirm-password">
    {data.internationalization?.["confirm-password"]}
  </label>
  <div class="input-container">
    <input
      name="confirmPassword"
      class="confirm-password"
      placeholder={data.internationalization?.["password.placeholder"]}
      required
      type="password"
      bind:value={$form.confirmPassword}
    />
    {#if $errors.confirmPassword}
      <p class="error">
        {data.internationalization?.["error-form.password-mismatch"]}
      </p>
    {/if}
  </div>

  <label for="locale">UNTRANSLATED:Locale</label>
  <div class="input-container">
    <!-- TODO: Implement a multi select component -->
    <!-- I know it's ugly, but we can implement a better looking component later on -->
    <select id="locale" name="locale" multiple required bind:value={$form.locale}>
      {#each data.userInterfaceLocales as locale (locale.value)}
        <option value={locale.value}>{locale.label}</option>
      {/each}
    </select>
  </div>

  <div class="action-row auth-actions">
    <a class="action-button auth-button button-cancel clickable" href={resolve("/", {})}>
      {data.internationalization?.cancel}
    </a>
    <button class="action-button auth-button button-create clickable" type="submit">
      {data.internationalization?.["create-account"]}
    </button>
  </div>
</form>

<style lang="scss">
  .register-form {
    display: grid;
    grid-template-columns: auto auto;

    gap: 1rem;
    justify-content: center;

    .input-container {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      p {
        margin: 0;
        font-size: 0.8rem;
        &.description {
          color: #666;
        }
        &.error {
          color: red;
        }
      }
    }

    .action-row {
      grid-column: span 2;
      justify-self: center;
    }
  }
</style>
