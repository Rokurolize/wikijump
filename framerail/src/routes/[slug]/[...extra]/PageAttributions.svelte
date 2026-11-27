<script lang="ts">
  import {
    formatPageAttributionDate,
    pageAttributionKindLabel,
    type PageAttributionDisplay
  } from "$lib/page-attributions"

  import type { TranslatedKeys } from "$lib/types"

  import RevisionAuthor from "./RevisionAuthor.svelte"

  interface Props {
    attributions: PageAttributionDisplay[]
    internationalization: TranslatedKeys | undefined
    locales: string[]
  }

  let { attributions, internationalization, locales }: Props = $props()
</script>

{#if attributions.length > 0}
  <div class="page-meta-info info-attributions">
    <div class="page-attributions-label">
      {internationalization?.["wiki-page-attributions"] ?? "Attributions"}
    </div>
    <ul class="page-attributions">
      {#each attributions as attribution (attribution.relation_id)}
        {@const date = attribution.metadata.attribution_date}
        <li class="page-attribution">
          <span class="page-attribution-user">
            <RevisionAuthor author={attribution.user} />
          </span>
          <span class="page-attribution-kind">
            {pageAttributionKindLabel(
              attribution.metadata.attribution_type,
              internationalization
            )}
          </span>
          <time class="page-attribution-date" datetime={date}>
            {formatPageAttributionDate(date, locales)}
          </time>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style lang="scss">
  .info-attributions {
    margin-top: 0.5em;
  }

  .page-attributions-label {
    font-weight: bold;
  }

  .page-attributions {
    display: flex;
    flex-direction: column;
    gap: 0.25em;
    padding: 0;
    margin: 0.25em 0 0;
    list-style: none;
  }

  .page-attribution {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25em 0.75em;
    justify-content: flex-end;
  }
</style>
