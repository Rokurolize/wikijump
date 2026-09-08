// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let render
let pageComponent
let PAGE_LAYOUT_CONTEXT_KEY
let Layout

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createViteServer({
    root,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
  })

  ;({ render } = await vite.ssrLoadModule("svelte/server"))
  ;({ default: pageComponent } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/page.svelte"
  ))
  ;({ PAGE_LAYOUT_CONTEXT_KEY } = await vite.ssrLoadModule(
    "/src/lib/layout/page-layout-context.ts"
  ))
  ;({ Layout } = await vite.ssrLoadModule("/src/lib/types.ts"))
})

after(async () => {
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

const foundPageData = {
  page: {
    page_id: 42,
    slug: "breadcrumb-child",
    from_wikidot: true,
    created_at: "2026-09-08T00:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
    discussion_thread_id: null
  },
  page_revision: {
    revision_id: 9,
    revision_number: 1,
    title: "Breadcrumb child",
    tags: []
  },
  site: { site_id: 1, name: "Sandbox For Codex", locale: "en" },
  wikidot_snapshot: null,
  wikidot_breadcrumbs: [
    { slug: "breadcrumb-root", title: "Breadcrumb root" },
    { slug: "breadcrumb-parent", title: "Breadcrumb parent" }
  ],
  page_rating: { enabled: false },
  page_discussion: { enabled: false },
  options: {},
  wikitext: "Child body",
  compiled_body_html: "<p>Child body</p>",
  compiled_body_styles: [],
  theme: {},
  legacy_actions: [],
  rate_actions: null,
  membership_actions: [],
  meta_tags: [],
  attributions: [],
  data_form: null,
  internationalization: {}
}

const renderWikidotPage = (data) =>
  render(pageComponent, {
    props: { data },
    context: new Map([[PAGE_LAYOUT_CONTEXT_KEY, { current: Layout.WIKIDOT }]])
  }).body

test("standard Wikidot page SSR does not invent breadcrumbs from parent metadata", () => {
  const body = renderWikidotPage(foundPageData)

  assert.match(body, /<div id="page-title"/u)
  assert.match(body, /<div id="page-content"/u)
  assert.doesNotMatch(body, /id="breadcrumbs"/u)
  assert.doesNotMatch(body, /breadcrumb-root/u)
  assert.doesNotMatch(body, /breadcrumb-parent/u)
})
