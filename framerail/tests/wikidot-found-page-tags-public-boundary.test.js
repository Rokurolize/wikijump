// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createTestViteServer } from "./vite-test-server.js"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let render
let pageComponent
let pageTagsComponent
let PAGE_LAYOUT_CONTEXT_KEY
let Layout

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createTestViteServer()

  ;({ render } = await vite.ssrLoadModule("svelte/server"))
  ;({ default: pageComponent } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/PageView.svelte"
  ))
  ;({ default: pageTagsComponent } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/WikidotFoundPageTags.svelte"
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
    slug: "tag-holder",
    from_wikidot: true,
    created_at: "2026-07-27T08:00:00Z",
    updated_at: "2026-07-27T08:00:00Z",
    discussion_thread_id: null
  },
  page_revision: {
    revision_id: 9,
    revision_number: 1,
    title: "ListPages tag holder",
    tags: ["_lp-holder-hidden", "lp-same-a-20260727", "lp-same-b-20260727"]
  },
  site: { site_id: 1, name: "Sandbox For Codex", locale: "en" },
  wikidot_snapshot: null,
  wikidot_breadcrumbs: [],
  page_rating: { enabled: false },
  page_discussion: { enabled: false },
  options: {},
  wikitext: "Holder body",
  compiled_body_html: "<p>Holder <!--page-source-note-->body</p>",
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

const renderFoundPage = (data) =>
  render(pageComponent, {
    props: { data },
    context: new Map([[PAGE_LAYOUT_CONTEXT_KEY, { current: Layout.WIKIDOT }]])
  }).body

const assertTagTree = (body, tags, hidden = false) => {
  const tree = body.match(/<div class="page-tags(?: hidden)?"><span>[\s\S]*?<\/span><\/div>/u)
  assert.ok(tree, "tag links must retain their native div/span wrappers")
  // Only this generated leaf contains compiler comments. Authored article
  // comments remain observable and are asserted separately below.
  const markup = tree[0].replace(/<!--[\s\S]*?-->/gu, "")
  assert.equal(
    markup,
    `<div class="page-tags${hidden ? " hidden" : ""}"><span>${tags
      .map((tag) => `<a href="/system:page-tags/tag/${tag}#pages">${tag}</a>`)
      .join("")}</span></div>`
  )
}

test("default Wikidot found-page route SSR preserves the native span around ordered tag links", () => {
  const body = renderFoundPage(foundPageData)

  assert.match(body, /<!--page-source-note-->/u)
  assertTagTree(body, foundPageData.page_revision.tags)
})

test("default Wikidot tag leaf SSR preserves the span around supplied revision tags", () => {
  const body = render(pageTagsComponent, {
    props: { tags: ["lp-range-20260727", "older-revision-tag"], hidden: false }
  }).body

  assertTagTree(body, ["lp-range-20260727", "older-revision-tag"])
})

test("tagless found-page route SSR omits page-tags", () => {
  const body = renderFoundPage({
    ...foundPageData,
    page_revision: { ...foundPageData.page_revision, tags: [] }
  })

  assert.doesNotMatch(body, /class="page-tags(?:\s|")/u)
})

test("editing found-page route SSR preserves the hidden page-tags state", () => {
  const body = renderFoundPage({
    ...foundPageData,
    options: { edit: true },
    data_form: { fields: [] }
  })

  assertTagTree(body, foundPageData.page_revision.tags, true)
})
