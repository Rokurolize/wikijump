import assert from "node:assert/strict"
import test from "node:test"

import { siteHeadFallbacks, unsupersededHeadFallbacks } from "../src/lib/head-metadata.ts"

const site = (fields = {}) => ({
  name: "Example Wiki",
  description: "An example wiki for head metadata.",
  ...fields
})

const row = (name, content, all_pages = true) => ({ name, content, all_pages })

test("site fallbacks pair the description with the site name", () => {
  assert.deepEqual(siteHeadFallbacks(site()), [
    { name: "description", content: "An example wiki for head metadata." },
    { name: "og:site_name", content: "Example Wiki" }
  ])
})

test("site fallbacks are omitted without a configured description", () => {
  assert.deepEqual(siteHeadFallbacks(null), [])
  assert.deepEqual(siteHeadFallbacks(site({ description: "" })), [])
  assert.deepEqual(siteHeadFallbacks(site({ description: "   " })), [])
})

test("stored rows supersede only the same-named fallbacks", () => {
  const fallbacks = siteHeadFallbacks(site())
  assert.deepEqual(
    unsupersededHeadFallbacks(fallbacks, [row("description", "Page override", false)]),
    [{ name: "og:site_name", content: "Example Wiki" }]
  )
  assert.deepEqual(
    unsupersededHeadFallbacks(fallbacks, [row("og:site_name", "Override")]),
    [{ name: "description", content: "An example wiki for head metadata." }]
  )
  assert.deepEqual(
    unsupersededHeadFallbacks(fallbacks, [
      row("og:type", "article"),
      row("twitter:card", "summary")
    ]),
    fallbacks
  )
  assert.deepEqual(unsupersededHeadFallbacks([], [row("og:type", "article")]), [])
})

test("fallbacks plus effective rows carry each entry exactly once", () => {
  // The sealed live shape pairs site fallbacks with stored social rows;
  // the stored description replaces its fallback while the site-name
  // fallback fills the gap no row covers.
  const fallbacks = unsupersededHeadFallbacks(siteHeadFallbacks(site()), [
    row("description", "Stored site description"),
    row("og:type", "article"),
    row("og:image", "https://example.wdfiles.com/local--files/main/logo.png"),
    row("twitter:card", "summary")
  ])
  const effective = [
    row("description", "Stored site description"),
    row("og:type", "article"),
    row("og:image", "https://example.wdfiles.com/local--files/main/logo.png"),
    row("twitter:card", "summary")
  ]
  const names = [...fallbacks, ...effective].map((tag) => tag.name)
  assert.deepEqual(names, [
    "og:site_name",
    "description",
    "og:type",
    "og:image",
    "twitter:card"
  ])
  assert.equal(new Set(names).size, names.length)
})
