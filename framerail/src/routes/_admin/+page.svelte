<script lang="ts">
  import AdminPage from "../[x+2d]/admin/+page.svelte"

  import type { PageProps } from "./$types"

  let { data, form, params }: PageProps = $props()
</script>

<AdminPage {data} {form} {params} />
