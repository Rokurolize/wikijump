<script lang="ts">
  import { invalidateAll } from "$app/navigation"
  import { errorPopupState } from "$lib/layout/stores.svelte"
  import { untrack } from "svelte"
  import { superForm } from "sveltekit-superforms"

  import type { PageProps } from "./$types"

  let { data }: { data: PageProps["data"] } = $props()

  const { form, enhance } = superForm(
    untrack(() => data.roleForm),
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

  let selectedPermissions = $state(
    untrack(() =>
      data.rolePermissions.map((permissions) =>
        permissions
          .filter((entry) => entry.active || entry.addable)
          .map((entry) => entry.permission)
      )
    )
  )

  $effect(() => {
    $form.siteId = data.site.site_id
    $form.name = ""
    $form.description = ""
    $form.parentRoleId =
      data.roles.find((role) => !role.is_virtual)?.role_id ?? data.roles[0]?.role_id ?? 0
  })
</script>

<section id="wikidot-permissions-settings" class="admin-section">
  <div class="page-header"><h2>Permissions</h2></div>
  <h3>Create a role</h3>
  {#if data.roles.length === 0}
    <p>No roles are available to use as a parent.</p>
  {:else}
    <form class="editor" action="?/roleCreate" method="POST" use:enhance>
      <label class="control-label" for="role-name">Role name</label>
      <input
        id="role-name"
        class="text"
        type="text"
        maxlength="100"
        bind:value={$form.name}
      />
      <label class="control-label" for="role-description">Description</label>
      <textarea
        id="role-description"
        class="text"
        maxlength="500"
        bind:value={$form.description}></textarea>
      <label class="control-label" for="role-parent">Inherits from</label>
      <select id="role-parent" bind:value={$form.parentRoleId}>
        {#each data.roles.filter((role) => !role.is_virtual) as role (role.role_id)}
          <option value={role.role_id}>{role.name}</option>
        {/each}
      </select>
      <div class="action-row">
        <button class="btn btn-primary" type="submit">Create role</button>
      </div>
    </form>
  {/if}

  <h3>Site roles</h3>
  {#if data.roles.length === 0}
    <p>No roles are configured for this site.</p>
  {:else}
    <div class="role-list">
      {#each data.roles as role, index (role.role_id)}
        <div class="role" data-role-id={role.role_id}>
          <h4>
            {role.name}{#if role.is_virtual}
              <span class="muted">(built-in)</span>{/if}
          </h4>
          <p>{role.description}</p>
          {#if !role.is_virtual}
            <form class="role-details" action="?/roleUpdateInfo" method="POST">
              <input name="siteId" type="hidden" value={data.site.site_id} />
              <input name="roleId" type="hidden" value={role.role_id} />
              <input name="name" type="text" maxlength="100" value={role.name} />
              <input
                name="description"
                type="text"
                maxlength="500"
                value={role.description}
              />
              <button type="submit">Save details</button>
            </form>
          {/if}
          {#if !role.is_virtual}
            <form class="permission-list" action="?/rolePermissions" method="POST">
              <input name="siteId" type="hidden" value={data.site.site_id} />
              <input name="roleId" type="hidden" value={role.role_id} />
              <input
                name="permissions"
                type="hidden"
                value={JSON.stringify(selectedPermissions[index] ?? [])}
              />
              {#each data.rolePermissions[index] ?? [] as decorated (`${decorated.permission.resource_type}:${String(decorated.permission.resource_category)}:${decorated.permission.action}`)}
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    value={decorated.permission}
                    bind:group={selectedPermissions[index]}
                    disabled={!decorated.addable && !decorated.removable}
                  />
                  {decorated.permission.resource_type}:{decorated.permission
                    .resource_category ?? "*"}:{decorated.permission.action}
                </label>
              {/each}
              <div class="action-row">
                <button type="submit">Save permissions</button>
              </div>
            </form>
          {/if}
          {#if !role.is_virtual}
            <form class="role-delete" action="?/roleDelete" method="POST">
              <input name="siteId" type="hidden" value={data.site.site_id} />
              <input name="roleId" type="hidden" value={role.role_id} />
              <input name="reparentChildren" type="hidden" value="true" />
              <button class="link-button" type="submit">delete role</button>
            </form>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .role-list {
    display: grid;
    gap: 1.5rem;
  }

  .role {
    padding: 1rem;
    border: 1px solid #ccc;
  }

  .role-details,
  .permission-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
    margin-bottom: 0.75rem;
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
