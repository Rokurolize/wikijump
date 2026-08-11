// @ts-nocheck
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

let previousWorkingDirectory
let vite
let actions

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
})

after(async () => {
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

test("anonymous file upload failures remain serializable action results", async () => {
  const result = await actions.fileUpload(anonymousUploadEvent())

  assert.equal(result.status, 401)
  assert.equal(result.data.message, "Authentication required.")
  assert.equal(Object.hasOwn(result.data.form.data, "file"), false)
})
