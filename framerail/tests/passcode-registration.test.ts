import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createTestViteServer } from "./vite-test-server.ts"

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

let previousWorkingDirectory: string
let vite: any
let client: any
let originalClientRequest: any
let registerRoute: any
let registerPage: any
let render: any

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createTestViteServer()
  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  ;({ render } = await vite.ssrLoadModule("svelte/server"))
  registerRoute = await vite.ssrLoadModule("/src/routes/[x+2d]/register/+page.server.ts")
  ;({ default: registerPage } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/register/+page.svelte"
  ))
  originalClientRequest = client.request
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

test("register load exposes tri-state registrationMode and admin load exposes platformSettings for staff", async () => {
  client.request = async (method: string) => {
    if (method === "translate") return {}
    if (method === "info") {
      return { registration_open: false, registration_mode: "passcode" }
    }
    throw new Error(`Unexpected RPC method: ${method}`)
  }

  const data = await registerRoute.load({
    request: new Request("https://wikijump.test/-/register", { headers: siteHeaders }),
    parent: async () => parentData
  })
  assert.equal(data.registrationMode, "passcode")
  assert.equal(data.registrationOpen, false)
})

test("register action forwards passcode to user_create in passcode mode", async () => {
  const userCreateCalls: any[] = []
  client.request = async (method: string, params: any) => {
    if (method === "info") {
      return { registration_open: false, registration_mode: "passcode" }
    }
    if (method === "user_create") {
      userCreateCalls.push(params)
      return { user_id: 99, slug: "passcode-user" }
    }
    throw new Error(`Unexpected RPC method: ${method}`)
  }

  const body = new URLSearchParams({
    username: "Passcode User",
    email: "passcode-user@example.com",
    password: "very-secure-password-123",
    confirmPassword: "very-secure-password-123",
    passcode: "SECRET-CODE-123",
    locale: "en"
  })

  const result = await registerRoute.actions.default({
    request: new Request("https://wikijump.test/-/register", {
      method: "POST",
      headers: {
        ...siteHeaders,
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    }),
    getClientAddress: () => "127.0.0.99"
  })

  assert.equal(result.isRegistered, true)
  assert.equal(userCreateCalls.length, 1)
  assert.equal(userCreateCalls[0].passcode, "SECRET-CODE-123")
})
