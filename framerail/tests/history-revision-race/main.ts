import { mount, type ComponentProps } from "svelte"

import HistoryPane from "../../src/routes/[slug]/[...extra]/HistoryPane.svelte"

const preview = document.createElement("div")
preview.id = "published-revision"
document.body.append(preview)

const data = {
  site: { site_id: 1 },
  page: { page_id: 2 },
  page_revision: { revision_id: 3 },
  internationalization: {}
} as unknown as ComponentProps<typeof HistoryPane>["data"]

mount(HistoryPane, {
  target: document.getElementById("app")!,
  props: {
    setShowRevision: () => {},
    setRevision: (rev) => {
      preview.textContent = rev
        ? `${rev.revision_number}:${rev.compiled_body_html ?? ""}`
        : ""
    },
    data
  }
})
