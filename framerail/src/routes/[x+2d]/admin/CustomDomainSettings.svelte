<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()

  const { form, enhance } = superForm(
    untrack(() => data.domainForm),
    {
      dataType: "json",
      resetForm: false,
      onSubmit: async ({ jsonData }) => {
        jsonData({ ...$form, siteId: data.site.site_id })
      },
      onResult: async ({ result }) => {
        if (result.type === "success" && result.data?.res) await invalidateAll()
        if (result.type === "failure" && result.data) {
          errorPopupState.current = {
            state: true,
            message: result.data.message,
            data: result.data.data
          }
        }
      }
    }
  )

  $effect(() => {
    $form.siteId = data.site.site_id
    $form.domain = ""
    $form.wwwRedirect = false
  })
</script>

<section id="wikidot-custom-domain-settings" class="admin-section">
  <div class="page-header"><h2>Custom domain</h2></div>
  <p>Current domain: {data.siteAuthority}</p>
  <form class="editor" action="?/customDomainCreate" method="POST" use:enhance>
    <label class="control-label" for="custom-domain">Domain name</label>
    <input
      id="custom-domain"
      class="text"
      type="text"
      maxlength="253"
      placeholder="example.com"
      bind:value={$form.domain}
    />
    <label class="checkbox-label" for="custom-domain-www-redirect">
      <input
        id="custom-domain-www-redirect"
        type="checkbox"
        bind:checked={$form.wwwRedirect}
      />
      Redirect the www subdomain
    </label>
    <div class="action-row">
      <button class="btn btn-primary" type="submit">Add domain</button>
    </div>
  </form>

  <h3>Configured domains</h3>
  {#if data.customDomains.length === 0}
    <p>No custom domains are configured for this site.</p>
  {:else}
    <ul class="domain-list">
      {#each data.customDomains as domain (domain.domain)}
        <li>
          <span>{domain.domain}</span>
          {#if domain.www_redirect}<span class="muted">(www redirect)</span>{/if}
          <form class="domain-remove" action="?/customDomainRemove" method="POST">
            <input name="siteId" type="hidden" value={data.site.site_id} />
            <input name="domain" type="hidden" value={domain.domain} />
            <button class="link-button" type="submit">remove</button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .domain-list {
    list-style: none;
    padding: 0;
  }

  .domain-list li {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.25rem 0;
  }

  .domain-remove {
    display: inline;
  }

  .muted {
    color: #666;
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
</style>
