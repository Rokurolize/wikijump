import { mount, type ComponentProps } from "svelte"

import FilePane from "../../src/routes/[slug]/[...extra]/FilePane.svelte"

const data = {
  site: { site_id: 6000001, slug: "system" },
  page: { page_id: 3000000032, slug: "join" },
  site_file_domain: "localhost",
  forms: {
    fileUploadForm: {},
    fileEditForm: {},
    fileMoveForm: {},
    fileRestoreForm: {}
  },
  internationalization: new Proxy(
    {},
    { get: (_target, key) => (typeof key === "string" ? key : "") }
  )
} as unknown as ComponentProps<typeof FilePane>["data"]

mount(FilePane, {
  target: document.getElementById("app")!,
  props: { data } as unknown as ComponentProps<typeof FilePane>
})
