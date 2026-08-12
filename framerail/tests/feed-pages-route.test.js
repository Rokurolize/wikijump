// @ts-nocheck
import assert from "node:assert/strict"
import { createServer as createHttpServer } from "node:http"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const siteHeaders = {
  cookie: "wikijump_token=route-test",
  "X-Wikijump-Site-Id": "17",
  "X-Wikijump-Site-Slug": "test"
}

let previousWorkingDirectory
let vite
let server
let baseUrl
let client
let originalClientRequest

const missingArticleView = {
  site: {
    site_id: 17,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    deleted_at: null,
    from_wikidot: true,
    slug: "test",
    name: "Route test site",
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
  site_file_domain: "test.wjfiles.localhost",
  license_name: "CC BY-SA 3.0",
  license_url: "https://creativecommons.org/licenses/by-sa/3.0/",
  license_kind: "standard",
  license_html: null,
  user_session: null,
  article_page_cache_key: null,
  public_content_cache_fence: null,
  anonymous_permission_cache_fence: null,
  page: {
    type: "missing",
    data: {
      options: {
        edit: false,
        title: null,
        parent: null,
        tags: null,
        no_redirect: false,
        no_render: false,
        debug: false,
        renderer: false,
        comments: false,
        history: false,
        offset: null,
        data: ""
      },
      redirect_page: null,
      wikitext: "",
      compiled_body_html: "",
      compiled_body_styles: [],
      compiled_top_bar_html: null,
      compiled_side_bar_html: null,
      theme: { type: "default" },
      new_page_wikitext: null,
      page_templates: [],
      selected_template_page_id: null,
      data_form: null
    }
  }
}

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
  client.request = async (method) => {
    if (method === "article_view") return structuredClone(missingArticleView)
    if (method === "translate") return {}
    if (method === "wikidot_list_pages_feed") return { items: [] }
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

test("exact feed/pages is a missing page while selector paths remain XML feeds", async () => {
  const missingResponse = await fetch(`${baseUrl}/feed/pages`, {
    headers: siteHeaders
  })
  const missingBody = await missingResponse.text()

  assert.equal(missingResponse.status, 404)
  assert.match(missingResponse.headers.get("content-type"), /^text\/html\b/u)
  assert.match(missingBody, /id="404-message"/u)
  assert.match(missingBody, /<em[^>]*>feed<\/em>/u)

  const feedResponse = await fetch(`${baseUrl}/feed/pages/category/news`, {
    headers: siteHeaders
  })
  const feedBody = await feedResponse.text()

  assert.equal(feedResponse.status, 200)
  assert.equal(feedResponse.headers.get("content-type"), "text/xml;charset=utf-8")
  assert.match(feedBody, /^<\?xml version="1\.0" encoding="UTF-8" \?>/u)
})
