<script lang="ts">
  import { resolve } from "$app/paths"

  import type { PageProps } from "./$types"

  let { data, form }: PageProps = $props()

  const created = $derived(form?.section === "created" ? form : null)
  const cancelled = $derived(form?.section === "cancelled" ? form : null)
  const createFailure = $derived(form?.section === "create-error" ? form : null)
  const cancelFailure = $derived(form?.section === "cancel-error" ? form : null)
</script>

<section id="site-invitations" class="admin-section">
  <div class="page-header"><h2>Invitations</h2></div>
  <p>
    Send an email invitation to join this wiki, or revoke one that is still outstanding.
  </p>

  {#if created}
    <p role="status">
      Invitation sent to {created.email} ({created.recipientName}). Invitation ID:
      {created.invitationId}.
    </p>
  {/if}
  {#if cancelled}
    <p role="status">Invitation {cancelled.invitationId} was revoked.</p>
  {/if}
  {#if createFailure?.errorMessage}
    <div class="error-block" role="alert">{createFailure.errorMessage}</div>
  {/if}
  {#if cancelFailure?.errorMessage}
    <div class="error-block" role="alert">{cancelFailure.errorMessage}</div>
  {/if}
  {#if data.loadError}
    <div class="error-block" role="alert">{data.loadError}</div>
  {/if}

  <form id="site-invitation-form" class="editor" method="POST" action="?/create">
    <label for="invitation-email">Recipient email</label>
    <input
      id="invitation-email"
      name="email"
      class="text"
      type="email"
      value={createFailure?.email ?? ""}
      required
    />
    <label for="invitation-name">Recipient name</label>
    <input
      id="invitation-name"
      name="recipient_name"
      class="text"
      type="text"
      value={createFailure?.recipient_name ?? ""}
      required
    />
    <label for="invitation-message">Message (optional)</label>
    <textarea id="invitation-message" name="message" class="text"
      >{createFailure?.message ?? ""}</textarea
    >
    <div class="action-row">
      <button class="action-button clickable" type="submit">Send invitation</button>
    </div>
  </form>

  <div id="outstanding-invitations">
    <h3>Outstanding invitations</h3>
    {#if data.invitations.length > 0}
      <table class="form alignleft invitation-table">
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Sender</th>
            <th>Created</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {#each data.invitations as invitation (invitation.invitation_id)}
            <tr>
              <td>
                <span>{invitation.recipient_name}</span>
                <span class="invitation-email">{invitation.email}</span>
              </td>
              <td>{invitation.sender_user_name || "Unknown"}</td>
              <td>{invitation.created_at}</td>
              <td>
                <form method="POST" action="?/cancel">
                  <input
                    name="invitation_id"
                    type="hidden"
                    value={invitation.invitation_id}
                  />
                  <button class="link-button" type="submit">Cancel</button>
                </form>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p>No outstanding invitations.</p>
    {/if}
  </div>

  <p><a href={resolve("-/admin")}>Return to site manager</a></p>
</section>

<style lang="scss">
  .error-block {
    margin-bottom: 1rem;
    color: #b94a48;
  }

  .invitation-email {
    color: #666;
  }

  .invitation-table td,
  .invitation-table th {
    padding: 0.4rem 0.8rem;
    text-align: left;
  }

  .link-button {
    padding: 0;
    font: inherit;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    background: none;
    border: 0;
  }

  #outstanding-invitations {
    margin-top: 2rem;
  }
</style>
