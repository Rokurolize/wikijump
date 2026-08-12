// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const siteHeaders = {
  "X-Wikijump-Site-Id": "17",
  "X-Wikijump-Site-Slug": "test"
}
const parentData = {
  locales: ["en-US", "en"],
  license_name: "CC BY-SA 4.0",
  license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
  user_session: null
}

let previousWorkingDirectory
let vite
let client
let originalClientRequest
let routes

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
  routes = {
    login: await vite.ssrLoadModule("/src/routes/[x+2d]/login/+page.server.ts"),
    logout: await vite.ssrLoadModule("/src/routes/[x+2d]/logout/+page.server.ts"),
    register: await vite.ssrLoadModule("/src/routes/[x+2d]/register/+page.server.ts"),
    settings: await vite.ssrLoadModule("/src/routes/[x+2d]/settings/+page.server.ts"),
    user: await vite.ssrLoadModule("/src/routes/[x+2d]/user/+page.server.ts"),
    userSlug: await vite.ssrLoadModule("/src/routes/[x+2d]/user/[slug]/+page.server.ts")
  }
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

const pageRequest = (path) =>
  new Request(`https://wikijump.test${path}`, { headers: siteHeaders })

test("account route loads expose their public SvelteKit page data", async () => {
  const userViewNames = []
  client.request = async (method, params) => {
    if (method === "translate") return {}
    if (method === "user_view") {
      userViewNames.push(params.user)
      return {
        type: "user_found",
        data: {
          user: {
            user_id: 41,
            user_type: "regular",
            created_at: "2026-08-10T00:00:00Z",
            updated_at: null,
            deleted_at: null,
            name: "Account Fixture",
            slug: "account-fixture",
            avatar_s3_hash: null,
            website: null,
            user_page: null
          }
        }
      }
    }
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const login = await routes.login.load({
    request: pageRequest("/-/login"),
    parent: async () => parentData
  })
  const logout = await routes.logout.load({
    request: pageRequest("/-/logout"),
    parent: async () => parentData
  })
  const register = await routes.register.load({
    request: pageRequest("/-/register"),
    parent: async () => parentData
  })
  const settings = await routes.settings.load({
    parent: async () => ({
      ...parentData,
      user_session: { user: { user_id: 41, locales: ["en-US", "ja-JP"] } }
    })
  })
  const user = await routes.user.load({
    request: pageRequest("/-/user"),
    cookies: { get: () => undefined },
    parent: async () => parentData
  })
  const userSlug = await routes.userSlug.load({
    params: { slug: "account-fixture" },
    request: pageRequest("/-/user/account-fixture"),
    cookies: { get: () => undefined },
    parent: async () => parentData
  })

  assert.equal(login.isLoggedIn, false)
  assert.equal(login.loginForm.valid, false)
  assert.equal(logout.isLoggedIn, false)
  assert.equal(register.isLoggedIn, false)
  assert.equal(register.registerForm.valid, false)
  assert.equal(settings.displaySettingsForm.data.locales, "en-US ja-JP")
  assert.equal(user.view, "user_found")
  assert.equal(user.user.slug, "account-fixture")
  assert.equal(userSlug.view, "user_found")
  assert.deepEqual(userViewNames, [undefined, "account-fixture"])
})

test("logout and user-edit route actions bind mutations to the server session", async () => {
  const calls = []
  client.request = async (method, params, context) => {
    calls.push({ method, params, context })
    if (method === "logout") return null
    if (method === "session_get") {
      return {
        session_token: "account-session",
        user_id: 41,
        created_at: "2026-08-10T00:00:00Z",
        expires_at: "2026-08-11T00:00:00Z",
        ip_address: "192.0.2.41",
        user_agent: "account route test",
        restricted: false
      }
    }
    if (method === "user_edit") return { user_id: 41 }
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const deletedCookies = []
  assert.deepEqual(
    await routes.logout.actions.logout({
      request: pageRequest("/-/logout?/logout"),
      cookies: {
        get: () => "account-session",
        delete: (name, options) => deletedCookies.push({ name, options })
      }
    }),
    { success: true }
  )

  const editData = new FormData()
  editData.set("name", "Updated Account")
  const edited = await routes.user.actions.userEdit({
    request: new Request("https://wikijump.test/-/user?/userEdit", {
      method: "POST",
      headers: siteHeaders,
      body: editData
    }),
    cookies: { get: () => "account-session" },
    getClientAddress: () => "192.0.2.41",
    locals: {
      requestContext: { siteId: 17, page: "-/user", sessionToken: "account-session" }
    }
  })

  assert.equal(edited.form.valid, true)
  assert.deepEqual(deletedCookies, [
    {
      name: "wikijump_token",
      options: { path: "/", httpOnly: true, secure: true, sameSite: "lax" }
    }
  ])
  assert.deepEqual(calls, [
    { method: "logout", params: ["account-session"], context: undefined },
    { method: "session_get", params: ["account-session"], context: undefined },
    {
      method: "user_edit",
      params: {
        user: 41,
        ip_address: "192.0.2.41",
        bypass_filter: false,
        name: "Updated Account"
      },
      context: { siteId: 17, page: "-/user", sessionToken: "account-session" }
    }
  ])
})

test("logout clears a stale browser session when Deepwell reports it invalid", async () => {
  client.request = async (method) => {
    assert.equal(method, "logout")
    throw Object.assign(new Error("Session token is invalid"), { code: 3001 })
  }

  const deletedCookies = []
  const result = await routes.logout.actions.logout({
    request: pageRequest("/-/logout?/logout"),
    cookies: {
      get: () => "stale-account-session",
      delete: (name, options) => deletedCookies.push({ name, options })
    }
  })

  assert.deepEqual(result, { success: true })
  assert.deepEqual(deletedCookies, [
    {
      name: "wikijump_token",
      options: { path: "/", httpOnly: true, secure: true, sameSite: "lax" }
    }
  ])
})

test("logout retains the browser session when invalidation otherwise fails", async () => {
  const errors = [
    new Error("Deepwell transport unavailable"),
    Object.assign(new Error("Database query failed"), { code: 1200 }),
    Object.assign(new Error("Unexpected logout failure"), { code: 3999 })
  ]
  const statuses = []
  const deletedCookies = []

  for (const error of errors) {
    client.request = async (method) => {
      assert.equal(method, "logout")
      throw error
    }

    const result = await routes.logout.actions.logout({
      request: pageRequest("/-/logout?/logout"),
      cookies: {
        get: () => "active-account-session",
        delete: (name, options) => deletedCookies.push({ name, options })
      }
    })
    statuses.push(result.status)
  }

  assert.deepEqual(statuses, [500, 500, 500])
  assert.deepEqual(deletedCookies, [])
})

test("logout without a browser session remains a bad request", async () => {
  client.request = async (method) => {
    assert.equal(method, "translate")
    return { "error-api.NOT_LOGGED_IN": "Not logged in" }
  }

  const result = await routes.logout.actions.logout({
    request: pageRequest("/-/logout?/logout"),
    cookies: {
      get: () => undefined,
      delete: () => assert.fail("missing session must not delete a cookie")
    }
  })

  assert.equal(result.status, 400)
  assert.deepEqual(result.data, { message: "Not logged in" })
})
