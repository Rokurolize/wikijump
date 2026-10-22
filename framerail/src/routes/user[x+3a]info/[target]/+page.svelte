<script lang="ts">
  import { resolve } from "$app/paths"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { showUserProfileActionAuthenticationGuard } from "$lib/user-profile-action-auth-guard.js"

  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  /**
   * The live public tab strip, in Wikidot's order. The retained
   * observations pin this markup for both anonymous and account-A viewers,
   * independent of any imported membership, revision, or forum relation.
   * The Profile tab is selected by default. Switching the selected tab in
   * place and the content of the other tabs are not yet evidenced, so the
   * links carry no behavior.
   */
  const userInfoTabs = [
    { id: "ui-profile-b", label: "Profile" },
    { id: "ui-member-b", label: "Member of" },
    { id: "ui-moderator-b", label: "Moderator of" },
    { id: "ui-admin-b", label: "Admin of" },
    { id: "ui-contrib-b", label: "Recent contributions" },
    { id: "ui-posts-b", label: "Recent posts and comments" }
  ]
  const selectedUserInfoTab = "ui-profile-b"
</script>

{#if data.view === "user_missing" && "error" in data}
  <div id="page-content">
    <div class="error-block">{data.error}</div>
  </div>
{:else if "user" in data && "privateMessageControl" in data}
  <div id="page-content">
    <div class="col-md-3">
      <ul id="ui-tabs" class="nav nav-pills nav-stacked">
        {#each userInfoTabs as tab (tab.id)}
          <li class:active={tab.id === selectedUserInfoTab}>
            <!-- svelte-ignore a11y_invalid_attribute -->
            <a id={tab.id} href="javascript:;">{tab.label}</a>
          </li>
        {/each}
      </ul>
    </div>

    <div class="col-md-9" data-user-id={data.user.userId}>
      {#if !data.user_session}
        <a
          href={resolve(data.privateMessageControl.authenticationPath, {})}
          data-action="write-private-message"
          data-target-user-id={data.user.userId}
        >
          {data.privateMessageControl.label}
        </a>

        <!-- svelte-ignore a11y_invalid_attribute -->
        <a
          class="btn btn-default btn-xs"
          href="javascript:;"
          role="button"
          data-action="add-to-contacts"
          data-target-user-id={data.user.userId}
          onclick={(event) => {
            event.preventDefault()
            showUserProfileActionAuthenticationGuard(errorPopupState)
          }}
        >
          <i class="icon-book" aria-hidden="true"></i>
          {data.contactControl.label}
        </a>

        <!-- svelte-ignore a11y_invalid_attribute -->
        <a
          class="btn btn-danger btn-xs pull-right"
          href="javascript:;"
          role="button"
          data-action="flag-user-as-abusive"
          data-target-user-id={data.user.userId}
          onclick={(event) => {
            event.preventDefault()
            showUserProfileActionAuthenticationGuard(errorPopupState)
          }}
        >
          {data.abuseReportControl.label}
        </a>
      {/if}

      <h1 class="profile-title">
        {#if data.user.avatar}
          <img alt="" src={data.user.avatar} />
        {/if}
        {data.user.name}
      </h1>

      <div id="user-info-area">
        <div class="profile-box">
          <dl class="dl-horizontal">
            <dt>Wikidot user since:</dt>
            <dd><span class="odate">{data.user.createdAt}</span></dd>

            {#if data.user.accountType}
              <dt>Account type:</dt>
              <dd>
                {data.user.accountType === "regular" ? "free" : data.user.accountType}
              </dd>
            {/if}

            {#if data.user.karmaLevel}
              <dt>Karma level:</dt>
              <dd>{data.user.karmaLevel}</dd>
            {/if}
          </dl>
        </div>
      </div>
    </div>
  </div>
{/if}
