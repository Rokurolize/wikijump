import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { expect, test } from "./hermetic-playwright"

// Stored SVG avatar carrying an inline script, mirroring the issue #2653
// snippet. The title flip is the execution signal: it can only happen when
// the browser parses the SVG as a document and runs the script.
const SVG_BODY =
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
  `<script>document.title="XSS"</script></svg>`

// Exact response shape handle_user_avatar emits for a stored active-MIME
// avatar: status, stored content type, ETag, nosniff, and a bare
// Content-Disposition attachment (avatars have no filename).
const fixedHeaders = () => ({
  "Content-Type": "image/svg+xml; charset=us-ascii",
  ETag: '"abcd"',
  "X-Content-Type-Options": "nosniff",
  "Content-Disposition": "attachment",
  "Content-Length": String(Buffer.byteLength(SVG_BODY))
})

// Pre-fix control shape: served inline with no disposition and no nosniff.
const legacyHeaders = () => ({
  "Content-Type": "image/svg+xml; charset=us-ascii",
  ETag: '"abcd"',
  "Content-Length": String(Buffer.byteLength(SVG_BODY))
})

let server: Server
let baseUrl: string

test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/avatar.svg") {
      response.writeHead(200, fixedHeaders())
      response.end(SVG_BODY)
    } else if (request.url === "/avatar-legacy.svg") {
      response.writeHead(200, legacyHeaders())
      response.end(SVG_BODY)
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

test("pre-fix inline SVG avatar executes its script (control)", async ({ page }) => {
  await page.goto(`${baseUrl}/avatar-legacy.svg`)
  expect(await page.title()).toBe("XSS")
})

test("fixed SVG avatar downloads instead of executing", async ({ page }) => {
  // Navigation itself rejects with "Download is starting": that rejection
  // IS the fix working. The response (headers) and download event are
  // captured alongside.
  const [response, download] = await Promise.all([
    page.waitForResponse(`${baseUrl}/avatar.svg`),
    page.waitForEvent("download"),
    page.goto(`${baseUrl}/avatar.svg`).catch(() => null)
  ])
  expect(response.status()).toBe(200)
  const headers = await response.allHeaders()
  expect(headers["content-type"]).toBe("image/svg+xml; charset=us-ascii")
  expect(headers["content-disposition"]).toBe("attachment")
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(download.suggestedFilename()).toContain("avatar")
  expect(await page.title()).toBe("")
})
