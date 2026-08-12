// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const routedSiteId = 17
const sessionToken = "forum-nesting-session"

let previousWorkingDirectory
let vite
let client
let originalClientRequest
let forumNestingAction

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
  ;({ forumNestingAction } = await vite.ssrLoadModule("/src/lib/server/load/admin.ts"))
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

const actionEvent = (submittedSiteId) => {
  const data = new FormData()
  data.set("siteId", String(submittedSiteId))
  data.set("expectedSettingsRevision", "4")
  data.set("maxNestLevel", "3")

  return {
    request: new Request("https://wikijump.test/--/admin?/forumNesting", {
      method: "POST",
      body: data,
      headers: {
        "X-Wikijump-Site-Id": String(routedSiteId),
        "X-Wikijump-Site-Slug": "test"
      }
    }),
    cookies: { get: () => sessionToken },
    getClientAddress: () => "192.0.2.63"
  }
}

test("forum nesting updates stay bound to the routed site", async () => {
  const calls = []
  client.request = async (method, params, context) => {
    calls.push({ method, params, context })
    if (method === "session_get") return { user_id: 41 }
    if (method === "site_update") return { settings_revision: 5 }
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const denied = await forumNestingAction(actionEvent(999))
  assert.equal(denied.status, 403)
  assert.deepEqual(calls, [])

  calls.length = 0
  const result = await forumNestingAction(actionEvent(routedSiteId))
  assert.equal(result.form.valid, true)
  assert.deepEqual(calls, [
    {
      method: "session_get",
      params: [sessionToken],
      context: undefined
    },
    {
      method: "site_update",
      params: {
        site: routedSiteId,
        expected_settings_revision: 4,
        user_id: 41,
        forum_max_nest_level: 3,
        ip_address: "192.0.2.63"
      },
      context: { sessionToken, siteId: routedSiteId }
    }
  ])
})
