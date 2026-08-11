<script lang="ts">
  import { deserialize } from "$app/forms"
  import { errorPopupState } from "$lib/layout/stores.svelte"

  import WatchersList from "./WatchersList.svelte"

  import type { UserInfo } from "$lib/types"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()
  let watchers = $state<UserInfo[]>([])

  async function getWatchers() {
    const response = await fetch("?/watchers", {
      method: "POST",
      body: JSON.stringify({ pageId: data.page?.page_id })
    }).then((result) => result.text())
    const result = deserialize<
      { res: UserInfo[] },
      { message: string; code: string; data: Record<string, unknown> }
    >(response)

    if (result.type === "failure" && result.data?.message) {
      errorPopupState.current = {
        state: true,
        message: result.data.message,
        data: result.data.data
      }
    } else if (result.type === "success" && result.data?.res) {
      watchers = result.data.res
    }
  }

  $effect(() => {
    void getWatchers()
  })
</script>

<h1 class="page-watchers-header">Watchers</h1>
<WatchersList {watchers} />
