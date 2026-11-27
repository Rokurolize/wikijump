import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"

import { createTestViteServer } from "./vite-test-server.ts"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory: any
let vite: any
let render: any
let pageAttributionsComponent: any
let currentPageMetadataComponent: any
let pageAttributionUserInfo: any
let resolvePageAttributionDisplays: any
let client: any
let originalClientRequest: any

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createTestViteServer()

  ;({ render } = await vite.ssrLoadModule("svelte/server"))
  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
  ;({ default: pageAttributionsComponent } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/PageAttributions.svelte"
  ))
  ;({ default: currentPageMetadataComponent } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/CurrentPageMetadata.svelte"
  ))
  ;({ pageAttributionUserInfo, resolvePageAttributionDisplays } =
    await vite.ssrLoadModule("/src/lib/server/load/page/page-attributions.ts"))
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

const attribution = (overrides: Record<string, any> = {}) => ({
  relation_id: 77,
  page_id: 42,
  user_id: 123,
  created_by: -1,
  created_at: "2025-12-11T00:00:00Z",
  overwritten_by: null,
  overwritten_at: null,
  deleted_by: null,
  deleted_at: null,
  metadata: {
    attribution_type: "author",
    attribution_date: "2025-12-11"
  },
  ...overrides
})

const author = {
  "user-id": 123,
  "user-slug": "example-author",
  "user-name": "Example Author",
  "user-karma": 0,
  "user-avatar-data": "",
  "user-profile-url": "/-/user/example-author"
}

const labels = {
  "wiki-page-attributions": "Attributions",
  "wiki-page-attribution-kind.author": "Author",
  "wiki-page-attribution-kind.rewrite": "Rewriter",
  "wiki-page-attribution-kind.translator": "Translator",
  "wiki-page-attribution-kind.maintainer": "Maintainer"
}

test("PageAttributions SSR renders each user, localized kind, and date", () => {
  const attributions = [
    { ...attribution(), user: author },
    {
      ...attribution({
        relation_id: 78,
        metadata: { attribution_type: "translator", attribution_date: "2026-01-02" }
      }),
      user: author
    }
  ]
  const body = render(pageAttributionsComponent, {
    props: { attributions, internationalization: labels, locales: ["en"] }
  }).body

  assert.match(body, /Attributions/u)
  assert.equal(
    body.match(/<a href="\/-\/user\/example-author">Example Author<\/a>/g)?.length,
    2
  )
  assert.match(body, /Author/u)
  assert.match(body, /Translator/u)
  assert.match(body, /datetime="2025-12-11"/u)
  assert.match(body, /datetime="2026-01-02"/u)
  assert.match(body, /2025/u)
  assert.match(body, /2026/u)
  assert.doesNotMatch(body, />123</u)
})

test("PageAttributions SSR renders every attribution kind label", () => {
  const kinds = ["author", "rewrite", "translator", "maintainer"]
  const body = render(pageAttributionsComponent, {
    props: {
      attributions: kinds.map((kind, index) => ({
        ...attribution({
          relation_id: 90 + index,
          metadata: { attribution_type: kind, attribution_date: "2026-01-02" }
        }),
        user: author
      })),
      internationalization: labels,
      locales: ["en"]
    }
  }).body

  for (const label of ["Author", "Rewriter", "Translator", "Maintainer"]) {
    assert.match(body, new RegExp(`>${label}<`, "u"))
  }
})

test("PageAttributions SSR renders nothing extra for an empty attribution list", () => {
  const body = render(pageAttributionsComponent, {
    props: { attributions: [], internationalization: labels, locales: ["en"] }
  }).body

  assert.doesNotMatch(body, /page-attributions/u)
  assert.doesNotMatch(body, /Attributions/u)
})

test("CurrentPageMetadata places attribution display in the metadata area", () => {
  const body = render(currentPageMetadataComponent, {
    props: {
      data: {
        site: { locale: "en" },
        locales: ["en"],
        internationalization: {
          tags: "Tags",
          "wiki-page-revision": "revision: 1",
          "wiki-page-last-edit": "last edited: today",
          ...labels
        },
        page_revision: { tags: [] },
        attribution_displays: [{ ...attribution(), user: author }]
      },
      revision: undefined,
      showRevision: false
    }
  }).body

  assert.match(
    body,
    /<div class="page-meta-info-container"[\s\S]*info-attributions[\s\S]*Example Author/u
  )
})

test("page attribution user info follows public identity rules", () => {
  assert.deepEqual(
    pageAttributionUserInfo({
      user_id: 123,
      user_type: "regular",
      name: "Example Author",
      slug: "example-author",
      deleted_at: null
    }),
    author
  )
  assert.equal(
    pageAttributionUserInfo({
      user_id: 123,
      user_type: "regular",
      name: "Example Author",
      slug: "example-author",
      deleted_at: "2026-01-01T00:00:00Z"
    }),
    null
  )
  assert.deepEqual(
    pageAttributionUserInfo({
      user_id: 456,
      user_type: "wikidot",
      name: "Imported Author",
      slug: "imported-author",
      is_deleted: false,
      karma: 3
    }),
    {
      "user-id": 456,
      "user-slug": "imported-author",
      "user-name": "Imported Author",
      "user-karma": 3,
      "user-avatar-data": "http://www.wikidot.com/avatar.php?userid=456&amp;size=small",
      "user-profile-url": "http://www.wikidot.com/user:info/imported-author"
    }
  )
})

test("resolver deduplicates user lookups and attaches public identities", async () => {
  const calls: any[] = []
  client.request = async (method: string, params: any) => {
    calls.push({ method, params })
    if (method !== "user_get") throw new Error(`Unexpected Deepwell method ${method}`)
    return {
      user_id: params.user,
      user_type: "regular",
      name: "Example Author",
      slug: "example-author",
      deleted_at: null
    }
  }

  try {
    const displays = await resolvePageAttributionDisplays([
      attribution(),
      attribution({ relation_id: 78 })
    ])

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { method: "user_get", params: { user: 123 } })
    assert.equal(displays.length, 2)
    assert.deepEqual(displays[0].user, author)
    assert.deepEqual(displays[1].user, author)
  } finally {
    client.request = originalClientRequest
  }
})

test("resolver returns an empty display list without user lookups", async () => {
  client.request = async () => {
    throw new Error("unexpected lookup")
  }

  try {
    assert.deepEqual(await resolvePageAttributionDisplays([]), [])
  } finally {
    client.request = originalClientRequest
  }
})
