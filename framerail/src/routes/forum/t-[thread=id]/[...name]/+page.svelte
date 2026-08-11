<script lang="ts">
  import ForumModuleBody from "$lib/ForumModuleBody.svelte"

  import type { PageData } from "./$types"

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()
</script>

<ForumModuleBody body={data.body} />
