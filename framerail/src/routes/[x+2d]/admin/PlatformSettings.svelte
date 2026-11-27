<script lang="ts">
  import { enhance } from "$app/forms"
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import type { IssuedRegistrationPasscode } from "$lib/server/deepwell/platform-settings"

  import type { ActionData, PageProps } from "./$types"

  let {
    data,
    actionData
  }: { data: PageProps["data"]; actionData?: ActionData } = $props()

  let platformSettings = $derived(data.platformSettings)
  let selectedMode = $state<"default" | "open" | "closed">("default")
  let label = $state("")
  let expiresInSeconds = $state("86400")
  let maxUses = $state("")
  let customPasscode = $state("")
  let lastIssuedPasscode = $state<IssuedRegistrationPasscode | null>(null)

  $effect(() => {
    const ov = platformSettings?.settings.allow_registration_override
    if (ov === true) {
      selectedMode = "open"
    } else if (ov === false) {
      selectedMode = "closed"
    } else {
      selectedMode = "default"
    }
  })

  $effect(() => {
    if (actionData && "issuedPasscode" in actionData && actionData.issuedPasscode) {
      lastIssuedPasscode = actionData.issuedPasscode as IssuedRegistrationPasscode
    }
  })

  function passcodeStatus(p: {
    revoked_at: string | null
    expires_at: string
    max_uses: number | null
    use_count: number
    is_active: boolean
  }): string {
    if (p.revoked_at) return "Revoked"
    if (p.max_uses !== null && p.use_count >= p.max_uses) return "Exhausted"
    if (!p.is_active) return "Expired"
    return "Active"
  }
</script>

{#if data.isPlatformStaff && platformSettings}
  <section id="platform-settings" class="admin-section">
    <h2>Platform settings &amp; registration passcodes</h2>

    <p class="description">
      Effective registration mode:
      <strong>{platformSettings.settings.registration_mode}</strong>
      (config default:
      <code>
        allow_registration = {platformSettings.settings.allow_registration_config
          ? "true"
          : "false"}
      </code>,
      active passcodes: {platformSettings.settings.active_passcode_count}).
    </p>

    <form
      class="form-horizontal editor"
      action="?/platformSettingUpdate"
      method="POST"
      use:enhance={() => {
        return async ({ result, update }) => {
          if (result.type === "success") {
            await invalidateAll()
          } else if (result.type === "failure" && result.data?.message) {
            errorPopupState.current = {
              state: true,
              message: String(result.data.message),
              data: result.data.data
            }
          }
          await update({ reset: false })
        }
      }}
    >
      <div class="form-group">
        <label for="platform-allow-registration">Registration policy override</label>
        <select
          id="platform-allow-registration"
          name="allowRegistrationMode"
          bind:value={selectedMode}
        >
          <option value="default">
            Use config default ({platformSettings.settings.allow_registration_config
              ? "open"
              : "closed / passcode"})
          </option>
          <option value="open">Open (allow public registration)</option>
          <option value="closed">
            Closed unless valid temporary passcode is provided
          </option>
        </select>
      </div>

      <div class="action-row">
        <button class="btn btn-primary" type="submit">Save platform setting</button>
      </div>
    </form>

    <h3>Temporary registration passcodes</h3>

    {#if lastIssuedPasscode}
      <div class="issued-passcode-banner" role="status">
        <strong>New passcode issued (shown once):</strong>
        <code>{lastIssuedPasscode.passcode}</code>
        <span>
          (ID #{lastIssuedPasscode.passcode_id}, expires {lastIssuedPasscode.expires_at})
        </span>
      </div>
    {/if}

    <form
      class="form-horizontal editor"
      action="?/registrationPasscodeIssue"
      method="POST"
      use:enhance={() => {
        return async ({ result, update }) => {
          if (result.type === "success") {
            if (result.data && "issuedPasscode" in result.data) {
              lastIssuedPasscode = result.data
                .issuedPasscode as IssuedRegistrationPasscode
            }
            label = ""
            customPasscode = ""
            await invalidateAll()
          } else if (result.type === "failure" && result.data?.message) {
            errorPopupState.current = {
              state: true,
              message: String(result.data.message),
              data: result.data.data
            }
          }
          await update({ reset: false })
        }
      }}
    >
      <div class="form-group">
        <label for="passcode-label">Label (optional)</label>
        <input
          id="passcode-label"
          name="label"
          type="text"
          placeholder="e.g. Wave 1 testers"
          bind:value={label}
        />
      </div>

      <div class="form-group">
        <label for="passcode-expires">Expires in</label>
        <select
          id="passcode-expires"
          name="expiresInSeconds"
          bind:value={expiresInSeconds}
        >
          <option value="3600">1 hour</option>
          <option value="86400">24 hours</option>
          <option value="604800">7 days</option>
          <option value="2592000">30 days</option>
        </select>
      </div>

      <div class="form-group">
        <label for="passcode-max-uses">Max uses (blank = unlimited, 1 = single-use)</label>
        <input
          id="passcode-max-uses"
          name="maxUses"
          type="number"
          min="1"
          placeholder="Unlimited"
          bind:value={maxUses}
        />
      </div>

      <div class="form-group">
        <label for="passcode-custom">Custom passcode (optional, auto-generated if blank)</label>
        <input
          id="passcode-custom"
          name="passcode"
          type="text"
          autocomplete="off"
          placeholder="Auto-generate secure passcode"
          bind:value={customPasscode}
        />
      </div>

      <div class="action-row">
        <button class="btn btn-primary" type="submit">Issue passcode</button>
      </div>
    </form>

    {#if platformSettings.passcodes.length > 0}
      <table class="passcode-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Label</th>
            <th>Uses</th>
            <th>Expires</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {#each platformSettings.passcodes as item (item.passcode_id)}
            <tr>
              <td>#{item.passcode_id}</td>
              <td>{item.label ?? "—"}</td>
              <td>{item.use_count}{item.max_uses !== null ? ` / ${item.max_uses}` : ""}</td>
              <td>{item.expires_at}</td>
              <td>{passcodeStatus(item)}</td>
              <td>
                {#if item.revoked_at === null}
                  <form
                    action="?/registrationPasscodeRevoke"
                    method="POST"
                    use:enhance={() => {
                      return async ({ result }) => {
                        if (result.type === "success") {
                          await invalidateAll()
                        } else if (result.type === "failure" && result.data?.message) {
                          errorPopupState.current = {
                            state: true,
                            message: String(result.data.message),
                            data: result.data.data
                          }
                        }
                      }
                    }}
                  >
                    <input type="hidden" name="passcodeId" value={item.passcode_id} />
                    <button class="btn btn-danger" type="submit">Revoke</button>
                  </form>
                {:else}
                  <span>—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="description">No temporary registration passcodes issued yet.</p>
    {/if}
  </section>
{/if}

<style lang="scss">
  .issued-passcode-banner {
    padding: 0.75rem 1rem;
    margin: 0.75rem 0;
    background: #eef7ee;
    border: 1px solid #4caf50;
    border-radius: 4px;
  }

  .passcode-table {
    width: 100%;
    margin-top: 1rem;
    border-collapse: collapse;

    th,
    td {
      padding: 0.5rem;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
  }
</style>
