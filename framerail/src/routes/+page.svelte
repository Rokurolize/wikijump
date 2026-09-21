<script lang="ts">
  import Page from "./[slug]/[...extra]/PageView.svelte"
  let props = $props()
</script>

<Page {...props} />
