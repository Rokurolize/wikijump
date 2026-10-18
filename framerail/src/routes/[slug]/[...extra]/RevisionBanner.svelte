<script lang="ts">
  import { wikidotRevisionDate } from "$lib/wikidot-history-contract"
  import type { Nullable, Optional } from "$lib/types"
  import type { PageRevisionModelFiltered } from "$lib/server/deepwell/page"
  import type { PageProps } from "./$types"

  import WikidotRevisionAuthor from "./WikidotRevisionAuthor.svelte"

  interface Props {
    data: PageProps["data"]
    revision: Optional<PageRevisionModelFiltered>
    showRevision: boolean
    revisionContext: Nullable<string>
    onClose: () => void
  }

  let { data, revision, showRevision, revisionContext, onClose }: Props = $props()

  const localized = (
    key: keyof NonNullable<PageProps["data"]["internationalization"]>,
    fallback: string
  ) => {
    const value = data.internationalization?.[key]
    return value && value !== key ? value : fallback
  }
</script>

{#if showRevision && revision}
  {@const date = wikidotRevisionDate(revision.created_at)}
  <div id="page-version-info" role="status">
    <div class="revision-banner-heading">
      {localized("wiki-page-revision-banner.title", "Historical revision")}
    </div>
    <div class="revision-banner-attributes">
      <span class="revision-banner-attribute">
        {data.internationalization?.[
          "wiki-page-revision-number"
        ]}{revision.revision_number}
      </span>
      {#if date}
        <span class="revision-banner-attribute {date.className}">
          {data.internationalization?.["wiki-page-revision-created-at"]}: {date.text}
        </span>
      {/if}
      <span class="revision-banner-attribute">
        {data.internationalization?.["wiki-page-revision-user"]}:
        <WikidotRevisionAuthor author={revision.author} userId={revision.user_id} />
      </span>
      {#if revision.title}
        <span class="revision-banner-attribute">
          {localized("wiki-page-revision-banner.page", "Page")}: {revision.title}
        </span>
      {/if}
      {#if revisionContext}
        <span class="revision-banner-attribute">
          {data.internationalization?.["wiki-page-revision-comments"]}: {revisionContext}
        </span>
      {/if}
    </div>
    <button
      class="action-button revision-banner-close clickable"
      onclick={onClose}
      type="button"
    >
      {localized("wiki-page-revision-banner.close", "Close")}
    </button>
  </div>
{/if}

<style lang="scss">
  #page-version-info {
    margin: 1em 0;
    padding: 0.75em 1em;
    border: 1px solid var(--wikijump-border-color, #ddd);
  }

  .revision-banner-heading {
    font-weight: bold;
    margin-bottom: 0.25em;
  }

  .revision-banner-attributes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25em 1em;
    margin-bottom: 0.5em;
  }
</style>
