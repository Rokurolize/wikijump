<script lang="ts">
  import type { PageData } from "./$types"

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()
</script>

<h1>{data.internationalization?.["forum-route.invalid"] ?? "Invalid forum route"}</h1>
