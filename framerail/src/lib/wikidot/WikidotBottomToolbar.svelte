<script lang="ts">
  /* eslint-disable svelte/no-target-blank -- Wikidot's captured footer links omit rel; preserve the exact compatibility DOM. */
  import type { PromotedSiteView } from "$lib/server/deepwell/views"

  let { sites }: { sites: PromotedSiteView[] } = $props()
</script>

<div id="footer-bar">
  <div></div>
  <h2>Other interesting sites</h2>
  <div class="units">
    {#each sites as site (site.slug)}
      <div class="unit">
        <div class="inner">
          <a class="image" href={`http://${site.slug}.wikidot.com`} target="_blank">
            <img
              class="thumbnail"
              alt=""
              src={`http://thumbnails.wdfiles.com/thumbnail/site/${site.slug}.wikidot.com/80.jpg`}
            />
          </a>
          <h3>
            <a href={`http://${site.slug}.wikidot.com`} target="_blank">{site.name}</a>
          </h3>
          <div class="desc">{site.description}</div>
        </div>
      </div>
    {/each}
  </div>
</div>
