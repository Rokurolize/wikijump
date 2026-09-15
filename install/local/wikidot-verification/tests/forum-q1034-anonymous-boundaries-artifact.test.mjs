import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

const artifactUrl = new URL(
  "../artifacts/forum-q1034-anonymous-boundaries-live-20260809.json",
  import.meta.url,
)

const sha256Pattern = /^[0-9a-f]{64}$/u

test("Q1034 anonymous boundary artifact seals only retained read-only observations", async () => {
  const artifact = JSON.parse(await fs.readFile(artifactUrl, "utf8"))

  assert.equal(artifact.schema, "wikijump_forum_q1034_anonymous_boundaries_live.v1")
  assert.deepEqual(artifact.surface_ids, [
    "catalog-feature:module-frontforum",
    "catalog-feature:module-forumnewthread",
    "Q1034_POPULATED_READ_MODEL_COVERAGE",
  ])
  assert.deepEqual(artifact.case_ids, [
    "frontforum-saved-feed-metadata",
    "frontforum-feed-preview",
    "frontforum-relative-links-preview",
    "forumnewthread-anonymous-category-route",
  ])
  assert.equal(artifact.provenance.actor, "anonymous")
  assert.equal(artifact.provenance.authenticated, false)
  assert.equal(artifact.provenance.mutated, false)
  assert.equal(artifact.provenance.retained_only, true)

  for (const key of [
    "forum_g9_manifest_sha256",
    "forum_g9_sums_sha256",
    "forum_g9_capture_script_sha256",
    "open43_sums_sha256",
    "open43_capture_script_sha256",
  ]) {
    assert.match(artifact.provenance[key], sha256Pattern, key)
  }

  const savedFeed = artifact.cases["frontforum-saved-feed-metadata"]
  assert.equal(savedFeed.request.method, "GET")
  assert.equal(savedFeed.response.http_status, 200)
  assert.equal(savedFeed.mutated, false)
  assert.equal(savedFeed.response.raw_body.sha256, "e8997b5011d095fe76eb26b15fe4adee4fb5654dfd2b45430fad9c10afacecde")
  assert.deepEqual(savedFeed.response.observed.head_feed_link, {
    rel: "alternate",
    type: "application/rss+xml",
    title: "G25 NEWS",
    href: "/feed/front/cg-mod-q11-004-frontforum/news.xml",
    exact_html: "<link rel=\"alternate\" type=\"application/rss+xml\" title=\"G25 NEWS\" href=\"/feed/front/cg-mod-q11-004-frontforum/news.xml\"/>",
  })
  assert.deepEqual(savedFeed.response.observed.body_feed_info, {
    class: "feedinfo",
    rss_icon_class: "rss-icon",
    rss_icon_alt: "rss icon",
    feed_link_text: "RSS feed",
    feed_link_href: "/feed/front/cg-mod-q11-004-frontforum/news.xml",
    exact_anchor_html: "<a href=\"/feed/front/cg-mod-q11-004-frontforum/news.xml\">RSS feed</a>",
  })
  assert.equal(savedFeed.response.observed.populated_item_count, 8)

  const feedPreview = artifact.cases["frontforum-feed-preview"]
  assert.equal(feedPreview.endpoint, "http://sandbox-for-codex.wikidot.com/ajax-module-connector.php")
  assert.equal(feedPreview.cases.length, 4)
  assert.deepEqual(
    feedPreview.cases.map(({ case_id }) => case_id),
    [
      "q1034-frontforum-feed-one",
      "q1034-frontforum-feed-two",
      "q1034-frontforum-feed-empty",
      "q1034-frontforum-feed-invalid",
    ],
  )
  for (const entry of feedPreview.cases) {
    assert.equal(entry.request.method, "POST")
    assert.equal(entry.response.http_status, 200)
    assert.equal(entry.response.status, "ok")
    assert.deepEqual(entry.response.js_include, [])
    assert.deepEqual(entry.response.css_include, [])
    assert.match(entry.response.raw_response.sha256, sha256Pattern)
    assert.match(entry.response.response_body_sha256, sha256Pattern)
    assert.equal(entry.response.dom_serialized_sha256, "65312cc6a71b0f49c5ad15b337622723fb6b2b67ada77007db8609efc3709c87")
    assert.equal(entry.mutated, false)
  }

  const relative = artifact.cases["frontforum-relative-links-preview"]
  assert.equal(relative.cases.length, 2)
  assert.deepEqual(
    relative.cases.map(({ request }) => request.form.source),
    [
      "[[module FrontForum category=\"8503559\" limit=\"1\" fixRelativeLinks=\"true\"]]",
      "[[module FrontForum category=\"8503559\" limit=\"1\" fixRelativeLinks=\"false\"]]",
    ],
  )
  assert.deepEqual(
    relative.cases.map(({ response }) => response.dom_serialized_sha256),
    [
      "65312cc6a71b0f49c5ad15b337622723fb6b2b67ada77007db8609efc3709c87",
      "65312cc6a71b0f49c5ad15b337622723fb6b2b67ada77007db8609efc3709c87",
    ],
  )
  assert.ok(relative.cases.every(({ response }) => response.js_include.length === 0 && response.css_include.length === 0))
  assert.ok(relative.cases.every(({ mutated }) => mutated === false))

  const newThread = artifact.cases["forumnewthread-anonymous-category-route"]
  assert.equal(newThread.request.method, "GET")
  assert.equal(newThread.response.http_status, 200)
  assert.equal(newThread.response.raw_body.sha256, "8b25e0625d87a4815ed9224e1e1f7da80be3e2b2f4f5f9d196bae2bdcdb58d1e")
  assert.deepEqual(newThread.response.observed.error_title, "Permission error")
  assert.match(newThread.response.observed.message, /Only Wikidot\.com registered users/u)
  assert.deepEqual(newThread.response.observed.login_link, {
    href: "#action:login",
    text: "Sign in as Wikidot user",
  })
  assert.equal(newThread.response.observed.forum_new_thread_form_count, 0)
  assert.equal(newThread.mutated, false)

  for (const [boundary, record] of Object.entries(artifact.blocked_boundaries)) {
    assert.equal(record.status, "blocked", boundary)
    assert.ok(record.missing_authority.length > 0, boundary)
  }
  assert.deepEqual(artifact.forbidden_inferences, [
    "The saved-page RSS link proves that the linked XML endpoint is available or has any particular feed schema.",
    "The relative-link pair proves rewriting behavior for a content-bearing relative link.",
    "Anonymous absence proves private or deleted forum visibility behavior.",
    "The anonymous ForumNewThread denial grants no forum mutation authority.",
  ])

  const artifactText = await fs.readFile(artifactUrl, "utf8")
  assert.doesNotMatch(artifactText, /wikidot_token7|authorization|cookie|set-cookie/u)
})
