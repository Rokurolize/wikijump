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
let pageTagsComponent
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
  compiled_body_html: "<p>Holder body</p>",
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

const withoutSvelteComments = (body) => body.replace(/<!--.*?-->/gu, "")

test("normal found-page route SSR renders ordered tag links directly in page-tags", () => {
  const body = withoutSvelteComments(renderFoundPage(foundPageData))

  assert.match(
    body,
    /<div class="page-tags"><a href="\/system:page-tags\/tag\/_lp-holder-hidden#pages">_lp-holder-hidden<\/a><a href="\/system:page-tags\/tag\/lp-same-a-20260727#pages">lp-same-a-20260727<\/a><a href="\/system:page-tags\/tag\/lp-same-b-20260727#pages">lp-same-b-20260727<\/a><\/div>/u
  )
})

test("display-only found-page tag leaf SSR renders supplied revision tags directly", () => {
  const body = withoutSvelteComments(
    render(pageTagsComponent, {
      props: { tags: ["lp-range-20260727", "older-revision-tag"], hidden: false }
    }).body
  )

  assert.equal(
    body,
    '<div class="page-tags"><a href="/system:page-tags/tag/lp-range-20260727#pages">lp-range-20260727</a><a href="/system:page-tags/tag/older-revision-tag#pages">older-revision-tag</a></div>'
  )
})

test("tagless found-page route SSR omits page-tags", () => {
  const body = renderFoundPage({
    ...foundPageData,
    page_revision: { ...foundPageData.page_revision, tags: [] }
  })

  assert.doesNotMatch(body, /class="page-tags(?:\s|")/u)
})

test("editing found-page route SSR preserves the hidden page-tags state", () => {
  const body = withoutSvelteComments(
    renderFoundPage({
      ...foundPageData,
      options: { edit: true },
      data_form: { fields: [] }
    })
  )

  assert.match(
    body,
    /<div class="page-tags hidden"><a href="\/system:page-tags\/tag\/_lp-holder-hidden#pages">/u
  )
})
