import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createTestViteServer } from "./vite-test-server.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const siteId = 23
const newSiteId = 71
const adminToken = "site-clone-admin-session"
const memberToken = "site-clone-member-session"
const destinationSlug = "cloned-wiki"
const destinationTitle = "Cloned Wiki"
const clientIp = "192.0.2.10"
const newSiteAuthority = "cloned-wiki.example.test"
const newSiteOrigin = "https://cloned-wiki.example.test"

let previousWorkingDirectory: any
let vite: any
let client: any
let originalClientRequest: any
let actions: Record<string, any>
let clonePage: any
let cloneSettings: any
let render: any

const deepwellCalls: any[] = []

const siteHeaders = {
  "X-Wikijump-Site-Id": String(siteId),
  "X-Wikijump-Site-Slug": "source"
}

const event = (token?: string, slug = destinationSlug) => {
  const data = new FormData()
  data.set("slug", slug)
  data.set("title", destinationTitle)

  return {
    request: new Request("https://wikijump.test/-/admin/clone", {
      method: "POST",
      body: data,
      headers: siteHeaders
    }),
    cookies: { get: () => token },
    locals: { requestContext: { sessionToken: token, siteId } },
    getClientAddress: () => clientIp
  }
}

const rpcError = (code: number, message: string) => ({ code, message })

const outcome = {
  site_id: newSiteId,
  site_user_id: 91,
  slug: destinationSlug,
  page_count: 12,
  revision_count: 34,
  file_count: 5
}

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createTestViteServer()

  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
  ;({ actions } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/clone/+page.server.ts"
  ))
  ;({ default: clonePage } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/clone/+page.svelte"
  ))
  ;({ default: cloneSettings } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/CloneSettings.svelte"
  ))
  ;({ render } = await vite.ssrLoadModule("svelte/server"))
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("a permitted administrator's submission calls site_clone with the expected arguments and lands on a success state naming the destination", async () => {
  deepwellCalls.length = 0
  client.request = async (method: any, params: any, context: any) => {
    deepwellCalls.push({ method, params, context })
    if (method === "site_clone") return outcome
    if (method === "site_domain") return newSiteAuthority
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const result = await actions.default(event(adminToken))

  assert.equal(result.success, true)
  assert.equal(result.slug, destinationSlug)
  assert.equal(result.title, destinationTitle)
  assert.equal(result.siteId, newSiteId)
  assert.equal(result.origin, newSiteOrigin)

  const cloneCall = deepwellCalls.find((call) => call.method === "site_clone")
  assert.deepEqual(cloneCall.params, {
    source: siteId,
    slug: destinationSlug,
    ip_address: clientIp
  })
  assert.equal(cloneCall.context.sessionToken, adminToken)
  assert.equal(cloneCall.context.siteId, siteId)

  const body = render(clonePage, { props: { form: result } }).body
  assert.match(body, /The wiki was cloned successfully/u)
  assert.match(body, /Cloned Wiki/u)
  assert.match(body, /cloned-wiki/u)
  assert.match(body, new RegExp(`href="${newSiteOrigin}/"`, "u"))
})

test("an anonymous or non-admin submission is refused by the endpoint's response", async () => {
  for (const [token, code, message] of [
    [undefined, 3007, "Authentication required"],
    [memberToken, 3106, "Permission denied"]
  ] as const) {
    deepwellCalls.length = 0
    client.request = async (method: any, params: any, context: any) => {
      deepwellCalls.push({ method, params, context })
      assert.equal(method, "site_clone")
      throw rpcError(code, "endpoint refusal")
    }

    const result = await actions.default(event(token))

    assert.equal(result.status, code === 3007 ? 401 : 403)
    assert.equal(result.data.message, message)
    const cloneCall = deepwellCalls.find((call) => call.method === "site_clone")
    assert.deepEqual(cloneCall.params, {
      source: siteId,
      slug: destinationSlug,
      ip_address: clientIp
    })
    assert.equal(cloneCall.context.sessionToken, token)
  }
})

test("a slug-conflict error renders as a form error", async () => {
  deepwellCalls.length = 0
  const message = "cannot clone site, a site with slug 'cloned-wiki' already exists"
  client.request = async (method: any) => {
    deepwellCalls.push({ method })
    assert.equal(method, "site_clone")
    throw rpcError(2102, message)
  }

  const result = await actions.default(event(adminToken, destinationSlug))

  assert.equal(result.status, 400)
  assert.equal(result.data.message, message)
  assert.equal(result.data.slug, destinationSlug)
  assert.equal(result.data.title, destinationTitle)

  const body = render(clonePage, { props: { form: result.data } }).body
  assert.match(body, /error-block/u)
  assert.match(body, /already exists/u)
  assert.match(body, /name="slug"/u)
  assert.match(body, /name="title"/u)
  assert.match(body, /value="cloned-wiki"/u)
})

test("the admin clone section links to the working clone route", () => {
  const body = render(cloneSettings, { props: {} }).body

  assert.match(body, /id="site-clone"/u)
  assert.match(body, /href="\/-\/admin\/clone"/u)
  assert.match(body, /Clone this wiki/u)
})
