<script lang="ts">
  import { PagePane } from "$lib/types"

  import type { PageProps } from "./$types"

  let { pagePaneState = $bindable(), data }: PageProps & { pagePaneState: PagePane } =
    $props()

  let currentTags = $derived(data.page_revision?.tags?.join(" ") ?? "")
</script>

<h1 class="page-tags-header">{data.internationalization?.tags}</h1>

<form id="page-tags" class="page-tags-form" action="?/edit" method="POST">
  <input name="siteId" type="hidden" value={data.site.site_id} />
  <input name="pageId" type="hidden" value={data.page?.page_id} />
  <input name="lastRevisionId" type="hidden" value={data.page_revision?.revision_id} />
  <input name="title" type="hidden" value={data.page_revision?.title ?? ""} />
  <input name="altTitle" type="hidden" value={data.page_revision?.alt_title ?? ""} />
  <input name="wikitext" type="hidden" value={data.wikitext} />
  <input name="comments" type="hidden" value="" />
  <input id="page-tags-input" name="tags" type="text" value={currentTags} />
  <div class="buttons">
    <input
      class="btn btn-danger"
      onclick={() => (pagePaneState = PagePane.None)}
      type="button"
      value={data.internationalization?.cancel}
    />
    <input
      class="btn btn-primary"
      type="submit"
      value={data.internationalization?.save}
    />
  </div>
</form>

<style lang="scss">
  .page-tags-form {
    padding-bottom: 2em;
  }

  #page-tags-input {
    box-sizing: border-box;
    width: 100%;
  }
</style>
