// @ts-nocheck
import assert from "node:assert/strict"
import { createServer as createHttpServer } from "node:http"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const siteHeaders = {
  "Accept-Language": "en",
  "X-Wikijump-Site-Id": "6000006",
  "X-Wikijump-Site-Slug": "scp-wiki"
}

const viewer = {
  site: {
    site_id: 6000006,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    deleted_at: null,
    from_wikidot: true,
    slug: "scp-wiki",
    name: "Forum fixture",
    tagline: "",
    description: "",
    locale: "en",
    default_page: "start",
    top_bar_page: null,
    side_bar_page: null,
    preferred_domain: null,
    layout: "wikidot",
    license: "cc-by-sa-3.0"
  },
  site_settings: {},
  site_file_domain: "scp-wiki.wjfiles.localhost",
  license_name: "CC BY-SA 3.0",
  license_url: "https://creativecommons.org/licenses/by-sa/3.0/",
  license_kind: "standard",
  license_html: null,
  user_session: null
}

const forumBodies = {
  "forum/ForumStartModule": {
    status: "ok",
    body: '<section data-forum-fixture="populated"><!--forum-source-note-->forum</section>',
    js_include: []
  },
  "forum/ForumViewCategoryModule": {
    status: "ok",
    body: "",
    js_include: []
  },
  "forum/ForumViewThreadModule": {
    status: "no_thread",
    body: "",
    js_include: []
  }
}

const pageContentBody = (html) => {
  const opening = /<div\b[^>]*\bid="page-content"[^>]*>/gu.exec(html)
  assert.ok(opening)

  const tags = /<\/?div\b[^>]*>/gu
  tags.lastIndex = opening.index + opening[0].length
  let depth = 1
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0].startsWith("</") ? -1 : 1
    if (depth === 0) {
      return html.slice(opening.index + opening[0].length, tag.index)
    }
  }
  assert.fail("page-content div is not closed")
}

let previousWorkingDirectory
let vite
let server
let baseUrl
let client
let originalClientRequest

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createViteServer({
    root,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
  })

  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
  client.request = async (method, parameters) => {
    if (method === "preload_view") return structuredClone(viewer)
    if (method === "translate") return {}
    if (method === "wikidot_forum_module") {
      const response = forumBodies[parameters.module_name]
      if (response) return structuredClone(response)
    }
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  server = createHttpServer((request, response) => vite.middlewares(request, response))
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.equal(typeof address, "object")
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (server) await new Promise((resolve) => server.close(resolve))
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("forum GET routes enclose populated empty and error bodies in one page-content root", async () => {
  for (const [path, expectedMarker, expectedBody] of [
    ["/forum/start", "1qplnk3", forumBodies["forum/ForumStartModule"].body],
    ["/forum/c-8503559/open-topic", "45h", ""],
    [
      "/forum/t-18029831/deleted-thread",
      "1lnhxh9",
      '<div class="error-block">The thread you\'re trying to show seems to have been deleted</div>'
    ]
  ]) {
    const response = await fetch(`${baseUrl}${path}`, { headers: siteHeaders })
    const html = await response.text()
    const moduleBody = pageContentBody(html)

    assert.equal(response.status, 200)
    assert.equal(html.match(/id="page-content"/gu)?.length ?? 0, 1)
    assert.equal(moduleBody, `<!--${expectedMarker}-->${expectedBody}<!---->`)
  }
})
