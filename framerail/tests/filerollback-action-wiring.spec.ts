import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { createServer, type ViteDevServer } from "vite"

const framerailDir = process.cwd()
const harnessDir = resolve(framerailDir, "tests/filerollback-action-wiring")
const serverStub = resolve(harnessDir, "stubs/server.ts")

let server: ViteDevServer
let baseURL: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: harnessDir,
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

test("the production fileRollback action reaches the real rollback RPC", async ({ page }) => {
  await page.goto(baseURL)
  await expect.poll(() => page.locator("#result").innerText()).not.toBe("pending")
  const result = (await page.evaluate(() => globalThis.__result)) as {
    error: string | null
    rollback: Record<string, unknown> | null
  }

  expect(result.error, "the production action map must provide fileRollback").toBeNull()
  expect(result.rollback, "the mapped handler must reach the file_rollback RPC").toMatchObject({
    site_id: 6000001,
    page_id: 3000000046,
    file: 88,
    revision_number: 1,
    last_revision_id: 108
  })
})
