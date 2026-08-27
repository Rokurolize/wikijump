<script lang="ts">
  let {
    title,
    siteName,
    fontPreloadHrefs,
    compiledBodyStylesHead,
    metaTags
  }: {
    title: string | null | undefined
    siteName: string
    fontPreloadHrefs: string[]
    compiledBodyStylesHead: string
    metaTags: { name: string; content: string; all_pages: boolean }[]
  } = $props()
</script>

<svelte:head>
  <title>{title} | {siteName}</title>
  {#each metaTags as metaTag (`${metaTag.all_pages}:${metaTag.name}`)}
    <meta name={metaTag.name} content={metaTag.content} />
  {/each}
  {#each fontPreloadHrefs as fontHref (fontHref)}
    <link
      as="font"
      crossorigin="anonymous"
      href={fontHref}
      rel="preload"
      type="font/woff2"
    />
  {/each}
  {@html compiledBodyStylesHead}
</svelte:head>
