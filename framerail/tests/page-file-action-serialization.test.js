// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let actions
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
  ;({ actions } = await vite.ssrLoadModule(
    "/src/routes/[slug]/[...extra]/+page.server.ts"
  ))
  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

const anonymousUploadEvent = () => {
  const data = new FormData()
  data.set("siteId", "17")
  data.set("pageId", "23")
  data.set("lastRevisionId", "29")
  data.set("name", "anonymous.png")
  data.set("comments", "anonymous upload rejection")
  data.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "anonymous.png"))

  return {
    request: new Request("https://wikijump.test/example?/fileUpload", {
      method: "POST",
      body: data,
      headers: {
        "X-Wikijump-Site-Id": "17",
        "X-Wikijump-Site-Slug": "test"
      }
    }),
    params: { slug: "example" },
    cookies: { get: () => undefined },
    getClientAddress: () => "192.0.2.62",
    locals: {
      requestContext: {
        siteId: 17,
        page: "example"
      }
    }
  }
}

const authenticatedUploadEvent = () => {
  const data = new FormData()
  data.set("siteId", "17")
  data.set("pageId", "23")
  data.set("lastRevisionId", "29")
  data.set("name", "before-commit.txt")
  data.set("comments", "blob failure")
  data.set("file", new File(["before commit"], "before-commit.txt"))

  return {
    request: new Request("https://wikijump.test/example?/fileUpload", {
      method: "POST",
      body: data,
      headers: {
        "X-Wikijump-Site-Id": "17",
        "X-Wikijump-Site-Slug": "test"
      }
    }),
    params: { slug: "example" },
    cookies: { get: () => "issue-1062-session" },
    getClientAddress: () => "192.0.2.62",
    locals: {
      requestContext: {
        sessionToken: "issue-1062-session",
        siteId: 17,
        page: "example"
      }
    }
  }
}

test("anonymous file upload failures remain serializable action results", async () => {
  const result = await actions.fileUpload(anonymousUploadEvent())

  assert.equal(result.status, 401)
  assert.equal(result.data.message, "Authentication required.")
  assert.equal(Object.hasOwn(result.data.form.data, "file"), false)
})

test("blob upload failures before commit remain serializable action results", async () => {
  const calls = []
  client.request = async (method, params, context) => {
    calls.push({ method, params, context })
    if (method === "session_get") return { user_id: 29 }
    if (method === "page_edit_permission") return { can_edit: true }
    if (method === "blob_upload") throw new Error("blob_upload failed before commit")
    throw new Error(`Unexpected Deepwell method ${method}`)
  }

  const result = await actions.fileUpload(authenticatedUploadEvent())

  assert.equal(result.status, 500)
  assert.equal(result.data.message, "blob_upload failed before commit")
  assert.equal(Object.hasOwn(result.data.form.data, "file"), false)
  assert.doesNotThrow(() => JSON.stringify(result.data))
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["session_get", "page_edit_permission", "blob_upload"]
  )
})

test("public file upload cancels a pending blob when the PUT fails", async (t) => {
  const originalFetch = globalThis.fetch
  const events = []
  t.after(() => {
    client.request = originalClientRequest
    globalThis.fetch = originalFetch
  })

  client.request = async (method, params, context) => {
    events.push({ kind: "rpc", method, params, context })
    if (method === "session_get") return { user_id: 29 }
    if (method === "page_edit_permission") return { can_edit: true }
    if (method === "blob_upload") {
      return {
        pending_blob_id: "pending-public-put-failure",
        presign_url: "https://uploads.example.test/pending-public-put-failure"
      }
    }
    if (method === "blob_cancel") return null
    throw new Error(`Unexpected Deepwell method ${method}`)
  }
  globalThis.fetch = async (url, init) => {
    events.push({ kind: "put", url, init })
    return new Response(null, { status: 503 })
  }

  const result = await actions.fileUpload(authenticatedUploadEvent())

  assert.equal(result.status, 500)
  assert.equal(result.data.message, "Blob upload failed with HTTP status 503")
  assert.equal(Object.hasOwn(result.data.form.data, "file"), false)
  assert.doesNotThrow(() => JSON.stringify(result.data))
  assert.deepEqual(
    events.map((event) => (event.kind === "put" ? "PUT" : event.method)),
    ["session_get", "page_edit_permission", "blob_upload", "PUT", "blob_cancel"]
  )
  assert.equal(events[3].url, "https://uploads.example.test/pending-public-put-failure")
  assert.equal(events[3].init.method, "PUT")
  assert.deepEqual(events.at(-1).params, {
    user_id: 29,
    pending_blob_id: "pending-public-put-failure"
  })
})
