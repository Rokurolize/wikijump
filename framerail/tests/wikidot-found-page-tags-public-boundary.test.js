// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let render
let pageTagsComponent

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
  ;({ default: pageTagsComponent } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/WikidotFoundPageTags.svelte"
  ))
})

after(async () => {
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("normal found-page SSR renders ordered tag links directly in page-tags", () => {
  const body = render(pageTagsComponent, {
    props: {
      currentTags: ["_lp-holder-hidden", "lp-same-a-20260727", "lp-same-b-20260727"],
      revisionTags: undefined,
      showRevision: false,
      hidden: false
    }
  }).body

  assert.equal(
    body.replace(/<!--.*?-->/gu, ""),
    '<div class="page-tags"><a href="/system:page-tags/tag/_lp-holder-hidden#pages">_lp-holder-hidden</a><a href="/system:page-tags/tag/lp-same-a-20260727#pages">lp-same-a-20260727</a><a href="/system:page-tags/tag/lp-same-b-20260727#pages">lp-same-b-20260727</a></div>'
  )
})

test("revision found-page SSR renders the selected revision tags directly in page-tags", () => {
  const body = render(pageTagsComponent, {
    props: {
      currentTags: ["current-tag"],
      revisionTags: ["lp-range-20260727", "older-revision-tag"],
      showRevision: true,
      hidden: false
    }
  }).body

  assert.equal(
    body.replace(/<!--.*?-->/gu, ""),
    '<div class="page-tags"><a href="/system:page-tags/tag/lp-range-20260727#pages">lp-range-20260727</a><a href="/system:page-tags/tag/older-revision-tag#pages">older-revision-tag</a></div>'
  )
})

test("found-page SSR omits page-tags when the selected branch is tagless", () => {
  for (const props of [
    {
      currentTags: [],
      revisionTags: ["revision-tag"],
      showRevision: false,
      hidden: false
    },
    {
      currentTags: ["current-tag"],
      revisionTags: [],
      showRevision: true,
      hidden: false
    }
  ]) {
    const body = render(pageTagsComponent, { props }).body
    assert.equal(body.replace(/<!--.*?-->/gu, ""), "")
  }
})
