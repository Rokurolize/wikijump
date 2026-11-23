import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createTestViteServer } from "./vite-test-server.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const routedSiteId = 17
const currentRevision = 7
const staleRevision = 2
const sessionToken = "category-revision-session"

let previousWorkingDirectory: any
let vite: any
let client: any
let originalClientRequest: any
let actions: Record<string, any>

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createTestViteServer()

  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
  actions = await vite.ssrLoadModule("/src/lib/server/load/admin.ts")
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

const actionEvent = (action: string, fields: Record<string, unknown>) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, String(value))

  return {
    request: new Request(`https://wikijump.test/--/admin?/${action}`, {
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

const staleError = () => ({
  message: `category settings changed since revision ${staleRevision}; current revision is ${currentRevision}`,
  code: 4000,
  data: {
    expected_settings_revision: staleRevision,
    current_settings_revision: currentRevision
  }
})

const cases: { action: string; fields: Record<string, unknown> }[] = [
  {
    action: "navigation",
    fields: {
      categoryId: 23,
      inherit: false,
      topBarPage: "nav:top",
      sideBarPage: "nav:side"
    }
  },
  {
    action: "license",
    fields: {
      categoryId: 23,
      inherit: false,
      license: "cc-by-sa-3.0",
      licenseOther: ""
    }
  },
  {
    action: "template",
    fields: { categoryId: 23, templatePageId: 91 }
  },
  {
    action: "rating",
    fields: {
      categoryId: 23,
      inherit: false,
      enabled: true,
      permission: "members",
      visibility: "anonymous",
      ratingType: "plus_minus"
    }
  },
  {
    action: "discussion",
    fields: { categoryId: 23, state: "enable" }
  }
]

test("stale category settings revisions reach the five category actions and reject their writes", async () => {
  for (const { action, fields } of cases) {
    const calls: any[] = []
    let rejectStale = true
    client.request = async (method: any, params: any, context: any) => {
      calls.push({ method, params, context })
      if (method === "session_get") return { user_id: 41 }
      if (method === "category_update") {
        if (rejectStale) throw staleError()
        return { category_id: 23, settings_revision: currentRevision + 1 }
      }
      throw new Error(`Unexpected Deepwell method ${method}`)
    }

    try {
      const stale = await actions[`${action}Action`](
        actionEvent(action, {
          siteId: routedSiteId,
          ...fields,
          expectedSettingsRevision: staleRevision
        })
      )
      assert.equal(stale.status, 500, action)
      assert.equal(stale.data.message, staleError().message, action)
      assert.equal(stale.data.code, 4000, action)
      assert.deepEqual(stale.data.data, staleError().data, action)
      assert.deepEqual(
        calls.map((call) => call.method),
        ["session_get", "category_update"],
        action
      )
      assert.equal(calls[1].params.expected_settings_revision, staleRevision, action)
      assert.equal(calls[1].params.site, routedSiteId, action)

      calls.length = 0
      rejectStale = false
      const current = await actions[`${action}Action`](
        actionEvent(action, {
          siteId: routedSiteId,
          ...fields,
          expectedSettingsRevision: currentRevision
        })
      )
      assert.equal(current.form.valid, true, action)
      assert.equal(calls[1].params.expected_settings_revision, currentRevision, action)
    } finally {
      rejectStale = true
    }
  }
})
