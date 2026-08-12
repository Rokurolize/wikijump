<script lang="ts">
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()
</script>

{#if data.view === "user_missing" && "error" in data}
  <div class="error-block">{data.error}</div>
{:else if "user" in data && "privateMessageControl" in data}
  <div class="col-md-9" data-user-id={data.user.userId}>
    <span data-redacted-control="private-message">
      {data.privateMessageControl.label}
    </span>

    <h1 class="profile-title">
      {#if data.user.avatar}
        <img src={data.user.avatar} alt="" />
      {/if}
      {data.user.name}
    </h1>

    <div id="user-info-area">
      <div class="profile-box">
        <dl class="dl-horizontal">
          <dt>Wikidot user since:</dt>
          <dd><span class="odate">{data.user.createdAt}</span></dd>

          <dt>Account type:</dt>
          <dd>{data.user.accountType === "regular" ? "free" : data.user.accountType}</dd>
        </dl>
      </div>
    </div>
  </div>
{/if}
