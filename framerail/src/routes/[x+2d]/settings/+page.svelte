<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { superForm } from "sveltekit-superforms"
  import { untrack } from "svelte"
  import {
    addLocalePreference,
    moveLocalePreference,
    removeLocalePreference
  } from "$lib/user-locale-order.js"

  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()
  let savedLocales = $state(
    untrack(() => [...(data.displaySettingsForm.data.locales ?? ["en"])])
  )
  let savedSignature = $state(
    untrack(() => data.user_session?.user.forum_signature ?? "")
  )
  let localeToAdd = $state("")
  let localeOrderAnnouncement = $state("")
  let availableLocales = $derived(
    data.userInterfaceLocales.filter(({ value }) => !$form.locales.includes(value))
  )

  const localeLabel = (value: string) =>
    data.userInterfaceLocales.find(({ value: localeValue }) => localeValue === value)
      ?.label ?? `${value} (current)`

  const announceLocaleOrder = () => {
    localeOrderAnnouncement = `Language order: ${$form.locales
      .map(
        (value, index) =>
          `${index === 0 ? "Primary" : `Fallback ${index}`} ${localeLabel(value)}`
      )
      .join(", ")}`
  }

  let passwordStatus = $state("")
  const {
    form: passwordForm,
    enhance: passwordEnhance,
    errors: passwordErrors
  } = superForm(
    untrack(() => data.passwordChangeForm),
    {
      onResult: async ({ result }) => {
        passwordStatus = ""
        if (result.type === "success" && result.data?.passwordChanged) {
          const revoked = Number(result.data.otherSessionsRevoked ?? 0)
          passwordStatus = `Password changed. ${revoked} other session${
            revoked === 1 ? " was" : "s were"
          } signed out.`
        } else if (result.type === "failure" && result.data?.message) {
          errorPopupState.current = {
            state: true,
            message: result.data.message,
            data: result.data
          }
        }
      }
    }
  )

  const { form, enhance } = superForm(
    untrack(() => data.displaySettingsForm),
    {
      onResult: async ({ result }) => {
        if (result.type === "success") {
          savedLocales = [...$form.locales]
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
  <p id="user-display-locales-label">
    {data.internationalization?.["user-profile-info.locales"]}
  </p>
  <ol id="user-display-locales" aria-labelledby="user-display-locales-label">
    {#each $form.locales as localeValue, index (localeValue)}
      <li class="locale-preference">
        <input type="hidden" name="locales" value={localeValue} />
        <span>
          {index === 0 ? "Primary" : `Fallback ${index}`}: {localeLabel(localeValue)}
        </span>
        <button
          class="action-button button-order clickable"
          type="button"
          aria-label={`Move ${localeLabel(localeValue)} up`}
          disabled={index === 0}
          onclick={() => {
            $form.locales = moveLocalePreference($form.locales, localeValue, -1)
            announceLocaleOrder()
          }}>↑</button
        >
        <button
          class="action-button button-order clickable"
          type="button"
          aria-label={`Move ${localeLabel(localeValue)} down`}
          disabled={index === $form.locales.length - 1}
          onclick={() => {
            $form.locales = moveLocalePreference($form.locales, localeValue, 1)
            announceLocaleOrder()
          }}>↓</button
        >
        <button
          class="action-button button-order clickable"
          type="button"
          aria-label={`Remove ${localeLabel(localeValue)}`}
          disabled={$form.locales.length === 1}
          onclick={() => {
            $form.locales = removeLocalePreference($form.locales, localeValue)
            announceLocaleOrder()
          }}>×</button
        >
      </li>
    {/each}
  </ol>
  <div class="locale-add-row">
    <label for="user-display-locale-add">Add a display language</label>
    <select id="user-display-locale-add" bind:value={localeToAdd}>
      <option value="">Choose a language</option>
      {#each availableLocales as locale (locale.value)}
        <option value={locale.value}>{locale.label}</option>
      {/each}
    </select>
    <button
      class="action-button button-order clickable"
      type="button"
      disabled={!localeToAdd}
      onclick={() => {
        $form.locales = addLocalePreference($form.locales, localeToAdd)
        localeToAdd = ""
        announceLocaleOrder()
      }}>Add</button
    >
  </div>
  <p class="visually-hidden" role="status" aria-live="polite">
    {localeOrderAnnouncement}
  </p>
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
        $form.locales = [...savedLocales]
        localeToAdd = ""
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

<h2 id="user-password-heading">Change password</h2>
<form
  id="user-password-form"
  action="?/password"
  method="POST"
  aria-labelledby="user-password-heading"
  use:passwordEnhance
>
  <label for="user-current-password">Current password</label>
  <input
    id="user-current-password"
    name="currentPassword"
    type="password"
    autocomplete="current-password"
    required
    aria-invalid={$passwordErrors.currentPassword ? "true" : undefined}
    bind:value={$passwordForm.currentPassword}
  />
  <label for="user-new-password">New password</label>
  <input
    id="user-new-password"
    name="newPassword"
    type="password"
    autocomplete="new-password"
    required
    aria-invalid={$passwordErrors.newPassword ? "true" : undefined}
    aria-describedby="user-new-password-note"
    bind:value={$passwordForm.newPassword}
  />
  <p id="user-new-password-note" class="settings-note">
    {$passwordErrors.newPassword
      ? "Password must contain at least 15 characters."
      : "At least 15 characters. Other signed-in sessions will be signed out."}
  </p>
  <label for="user-confirm-password">Confirm new password</label>
  <input
    id="user-confirm-password"
    name="confirmPassword"
    type="password"
    autocomplete="new-password"
    required
    aria-invalid={$passwordErrors.confirmPassword ? "true" : undefined}
    aria-describedby={$passwordErrors.confirmPassword
      ? "user-confirm-password-error"
      : undefined}
    bind:value={$passwordForm.confirmPassword}
  />
  {#if $passwordErrors.confirmPassword}
    <p id="user-confirm-password-error" class="settings-note">
      The new passwords do not match.
    </p>
  {/if}
  <p role="status" aria-live="polite">{passwordStatus}</p>
  <div class="action-row user-password-actions">
    <button class="action-button button-save clickable" type="submit">
      Change password
    </button>
  </div>
</form>

<style lang="scss">
  #user-settings-form,
  #user-password-form {
    display: grid;
    gap: 0.75rem;
    max-width: 40rem;
  }

  #forum-signature-source {
    min-height: 7rem;
  }

  .user-settings-actions,
  .user-password-actions {
    display: flex;
    gap: 0.5rem;
  }

  #user-display-locales {
    display: grid;
    gap: 0.5rem;
    list-style: decimal;
    margin: 0;
    padding-inline-start: 1.75rem;
  }

  .locale-preference,
  .locale-add-row {
    align-items: center;
    display: flex;
    gap: 0.5rem;
  }

  .locale-preference span {
    flex: 1;
  }

  .visually-hidden {
    border: 0;
    clip: rect(0, 0, 0, 0);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    padding: 0;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
</style>
