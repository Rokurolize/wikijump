import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createTestViteServer } from "./vite-test-server.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const routedSiteId = 23
const sessionToken = "access-policy-session"

let previousWorkingDirectory: any
let vite: any
let client: any
let originalClientRequest: any
let accessPolicyAction: any

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createTestViteServer()

  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
  ;({ accessPolicyAction } = await vite.ssrLoadModule("/src/lib/server/load/admin.ts"))
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

const actionEvent = (
  submittedSiteId: any,
  fields: any,
  token: string | null = sessionToken
) => {
  const data = new FormData()
  data.set("siteId", String(submittedSiteId))
  for (const [name, value] of Object.entries(fields)) data.set(name, String(value))

  return {
    request: new Request("https://wikijump.test/--/admin?/accessPolicy", {
      method: "POST",
      body: data,
      headers: {
        "X-Wikijump-Site-Id": String(routedSiteId),
        "X-Wikijump-Site-Slug": "test"
      }
    }),
    cookies: { get: () => token },
    getClientAddress: () => "192.0.2.63"
  }
}

test("access policy updates stay bound to the routed site", async () => {
  const calls: any[] = []
  client.request = async (method: any, params: any, context: any) => {
    calls.push({ method, params, context })
    if (method === "session_get") return { user_id: 41 }
    if (method === "site_update") return { settings_revision: 5 }
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const fields = { expectedSettingsRevision: 4, accessPolicy: "closed" }
  const denied = await accessPolicyAction(actionEvent(999, fields))
  assert.equal(denied.status, 403)
  assert.deepEqual(calls, [])

  calls.length = 0
  const result = await accessPolicyAction(actionEvent(routedSiteId, fields))
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
        access_policy: "closed",
        ip_address: "192.0.2.63"
      },
      context: { sessionToken, siteId: routedSiteId }
    }
  ])
})

test("access policy updates reject unauthenticated and unsupported values", async () => {
  const calls: any[] = []
  client.request = async (method: any, params: any, context: any) => {
    calls.push({ method, params, context })
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const fields = { expectedSettingsRevision: 4, accessPolicy: "private" }
  const anonymous = await accessPolicyAction(actionEvent(routedSiteId, fields, null))
  assert.equal(anonymous.status, 401)
  assert.deepEqual(calls, [])

  const invalid = await accessPolicyAction(
    actionEvent(routedSiteId, { expectedSettingsRevision: 4, accessPolicy: "restricted" })
  )
  assert.equal(invalid.status, 400)
  assert.equal(invalid.data.form.valid, false)
  assert.deepEqual(calls, [])
})
