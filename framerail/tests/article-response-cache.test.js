import { strict as assert } from "node:assert"
import test from "node:test"

import {
  buildAnonymousArticleResponseCacheKey,
  buildAnonymousArticleResponseCacheMetadata,
  canConsiderAnonymousArticleResponseCache,
  deserializeCachedArticleResponse,
  readCachedArticleResponse,
  serializeArticleResponseForCache,
  writeCachedArticleResponse
} from "../src/lib/server/article-response-cache.js"

test("anonymous article response cache gate allows only plain anonymous article GETs", () => {
  const allowed = canConsiderAnonymousArticleResponseCache({
    method: "GET",
    routeId: "/[slug]/[...extra]",
    url: new URL("https://scp-wiki.example/scp-173"),
    siteId: 6000005,
    siteSlug: "scp-wiki",
    route: { slug: "scp-173", extra: "" },
    cookieHeader: null
  })

  assert.equal(allowed.cacheable, true)

  for (const candidate of [
    { method: "POST" },
    { routeId: "/-/admin" },
    { url: new URL("https://scp-wiki.example/scp-173?x=1") },
    { route: { slug: "scp-173", extra: "comments/show" } },
    { cookieHeader: "wikijump_token=fixture-session" },
    { siteSlug: "" }
  ]) {
    assert.equal(
      canConsiderAnonymousArticleResponseCache({
        method: "GET",
        routeId: "/[slug]/[...extra]",
        url: new URL("https://scp-wiki.example/scp-173"),
        siteId: 6000005,
        siteSlug: "scp-wiki",
        route: { slug: "scp-173", extra: "" },
        cookieHeader: null,
        ...candidate
      }).cacheable,
      false
    )
  }
})

test("anonymous article response cache key requires Deepwell eligibility metadata", () => {
  const deepwellArticlePageCacheKey =
    "deepwell:article-view:page:v1:site=6000005:page=173:rev=9:updated=123:body=aa:top=bb:side=cc:slug=7363702d313733:extra=:locales=6a612d4a502c656e2d55532c656e"
  const metadata = buildAnonymousArticleResponseCacheMetadata({
    siteId: 6000005,
    siteSlug: "scp-wiki",
    requestLocales: ["ja-JP", "en-US"],
    backendLocales: ["ja-JP", "en-US", "en"],
    deepwellArticlePageCacheKey
  })

  assert.deepEqual(metadata, {
    siteId: 6000005,
    siteSlug: "scp-wiki",
    requestLocales: ["ja-JP", "en-US"],
    backendLocales: ["ja-JP", "en-US", "en"],
    deepwellArticlePageCacheKey,
    permissionFence: "anonymous-page-view-v1"
  })

  assert.match(
    buildAnonymousArticleResponseCacheKey(metadata),
    /^framerail:article-response:v1:site=6000005:slug=7363702d77696b69:requestLocales=6a612d4a502c656e2d5553:backendLocales=6a612d4a502c656e2d55532c656e:permission=anonymous-page-view-v1:deepwell=[a-f0-9]{64}$/
  )

  assert.equal(
    buildAnonymousArticleResponseCacheMetadata({
      siteId: 6000005,
      siteSlug: "scp-wiki",
      requestLocales: ["en-US"],
      backendLocales: ["en-US", "en"],
      deepwellArticlePageCacheKey: null
    }),
    null
  )
})

test("anonymous article response cache serializes final response headers", async () => {
  const response = new Response("<!doctype html><html><body>cached</body></html>", {
    status: 200,
    headers: {
      "content-type": "text/html",
      "cross-origin-opener-policy": "same-origin",
      "x-frame-options": "DENY"
    }
  })

  const serialized = await serializeArticleResponseForCache(response)

  assert.deepEqual(serialized, {
    status: 200,
    headers: [
      ["content-type", "text/html"],
      ["cross-origin-opener-policy", "same-origin"],
      ["x-frame-options", "DENY"]
    ],
    body: "<!doctype html><html><body>cached</body></html>"
  })

  const restored = deserializeCachedArticleResponse(serialized)
  assert.equal(restored.status, 200)
  assert.equal(restored.headers.get("x-frame-options"), "DENY")
  assert.equal(await restored.text(), "<!doctype html><html><body>cached</body></html>")
})

test("anonymous article response cache store helpers fail closed", async () => {
  const malformedStore = {
    async get() {
      return "{not json"
    },
    async set() {
      throw new Error("redis unavailable")
    }
  }

  assert.equal(await readCachedArticleResponse(malformedStore, "key"), null)
  assert.equal(
    await writeCachedArticleResponse(
      malformedStore,
      "key",
      { status: 200, headers: [], body: "body" },
      60
    ),
    false
  )
})
