import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { createServer, type Plugin, type ViteDevServer } from "vite"

const framerailDir = process.cwd()
const harnessDir = resolve(framerailDir, "tests/filerollback-action-wiring")
const serverStub = resolve(harnessDir, "stubs/server.ts")
const pageServer = resolve(framerailDir, "src/routes/[slug]/[...extra]/+page.server.ts")

const rollbackRoute: Plugin = {
  name: "file-rollback-action-route",
  configureServer(devServer) {
    devServer.middlewares.use(async (req, res, next) => {
      if (req.method !== "POST" || !req.url?.startsWith("/?/fileRollback")) {
        next()
        return
      }
      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const pageModule = await devServer.ssrLoadModule(`/@fs${pageServer}`)
        const action = pageModule.actions?.fileRollback
        if (!action) {
          res.statusCode = 404
          res.end("Not Found")
          return
        }
        const stubModule = await devServer.ssrLoadModule(`/@fs${serverStub}`)
        stubModule.calls.length = 0
        const result = await action({
          request: new Request("http://localhost/?/fileRollback", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: Buffer.concat(chunks).toString()
          }),
          cookies: { get: () => undefined }
        })
        const rollback = stubModule.calls.find(
          (call: { method: string }) => call.method === "file_rollback"
        )
        res.statusCode = result.status ?? 200
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify({ rollback: rollback?.params ?? null }))
      } catch (error) {
        res.statusCode = 500
        res.end(String(error))
      }
    })
  }
}

let server: ViteDevServer
let baseURL: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: harnessDir,
    plugins: [rollbackRoute],
    resolve: {
      alias: [
        { find: "$lib/defaults", replacement: serverStub },
        { find: /^\$lib\/server\/deepwell$/, replacement: serverStub },
        { find: "$lib/server/deepwell/file", replacement: serverStub },
        { find: "$lib/types", replacement: resolve(framerailDir, "src/lib/types.ts") },
        { find: /^\$lib\//, replacement: `${resolve(framerailDir, "src/lib")}/` },
        { find: "sveltekit-superforms/adapters", replacement: serverStub },
        { find: "sveltekit-superforms", replacement: serverStub }
      ]
    },
    cacheDir: resolve(framerailDir, ".vite-harness-filerollback-action-wiring"),
    server: { host: "127.0.0.1", port: 0, fs: { allow: [framerailDir] } },
    logLevel: "error"
  })
  await server.listen()
  const address = server.httpServer?.address() as AddressInfo
  baseURL = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  await server?.close()
})

test("the ?/fileRollback action runs the real rollback handler", async ({ page }) => {
  await page.goto(baseURL)
  await expect.poll(() => page.locator("#result").innerText()).not.toBe("pending")
  const result = (await page.evaluate(() => globalThis.__result)) as {
    error: string | null
    rollback: Record<string, unknown> | null
  }

  expect(result.error, "the mapped action must be callable").toBeNull()
  expect(result.rollback, "the handler must reach the file_rollback RPC").toMatchObject({
    site_id: 6000001,
    page_id: 3000000046,
    file: 88,
    revision_number: 1,
    last_revision_id: 108
  })
})

test("the Revert route responds instead of returning 404", async ({ request }) => {
  const response = await request.post(`${baseURL}/?/fileRollback`, {
    data: {
      siteId: 6000001,
      pageId: 3000000046,
      fileId: 88,
      revisionNumber: 1,
      lastRevisionId: 108,
      comments: "rollback probe"
    }
  })

  expect(response.status(), "the registered action must answer the route").toBe(200)
  const body = (await response.json()) as {
    rollback: Record<string, unknown> | null
  }
  expect(body.rollback).toMatchObject({
    site_id: 6000001,
    page_id: 3000000046,
    file: 88,
    revision_number: 1,
    last_revision_id: 108
  })
})
