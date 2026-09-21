<script lang="ts">
  import Page from "./PageView.svelte"

  import type { PageProps } from "./$types"

  let props: PageProps = $props()
</script>

<Page {...props} />
