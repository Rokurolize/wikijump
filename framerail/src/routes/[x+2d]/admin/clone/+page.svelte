<script lang="ts">
  import { resolve } from "$app/paths"

  import type { PageProps } from "./$types"

  let { form }: PageProps = $props()

  const cloned = $derived(form?.success === true ? form : null)
  const failure = $derived(form?.success === false ? form : null)
</script>

<section id="site-clone" class="admin-section">
  <div class="page-header"><h2>Clone this wiki</h2></div>

  {#if cloned}
    <p role="status">The wiki was cloned successfully.</p>
    <p>
      New wiki:
      {#if cloned.origin}
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the clone lives at its own site origin -->
        <a href={`${cloned.origin}/`}>{cloned.title || cloned.slug}</a>
      {:else}
        <span>{cloned.title || cloned.slug}</span>
      {/if}
      <span class="clone-slug">({cloned.slug})</span>
    </p>
    <p><a href={resolve("-/admin")}>Return to site manager</a></p>
  {:else}
    <p>
      Create a private copy of this wiki. You become the new wiki's master administrator;
      no source memberships or roles are copied.
    </p>

    {#if failure?.message}
      <div class="error-block" role="alert">{failure.message}</div>
    {/if}

    <form id="site-clone-form" class="editor" method="POST">
      <label for="clone-slug">Destination slug</label>
      <input
        id="clone-slug"
        name="slug"
        class="text"
        type="text"
        value={failure?.slug ?? ""}
        required
      />
      <label for="clone-title">Title</label>
      <input
        id="clone-title"
        name="title"
        class="text"
        type="text"
        value={failure?.title ?? ""}
      />
      <div class="action-row">
        <button class="action-button clickable" type="submit">Clone wiki</button>
      </div>
    </form>
  {/if}
</section>

<style lang="scss">
  .clone-slug {
    color: #666;
  }

  .error-block {
    margin-bottom: 1rem;
    color: #b94a48;
  }
</style>
