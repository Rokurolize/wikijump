import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { createServer, type ViteDevServer } from "vite"

const framerailDir = process.cwd()
const harnessDir = resolve(framerailDir, "tests/filerollback-action-wiring")

let server: ViteDevServer
let baseURL: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: harnessDir,
    resolve: {
      alias: [
        {
          find: "$lib/server/load/page",
          replacement: resolve(harnessDir, "stubs/load-page.ts")
        }
      ]
    },
    cacheDir: resolve(framerailDir, ".vite-harness"),
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

test("the Files pane Revert control has a matching ?/fileRollback server action", async ({
  page
}) => {
  await page.goto(baseURL)
  await expect.poll(() => page.locator("#result").innerText()).not.toBe("pending")
  const result = (await page.evaluate(() => globalThis.__result)) as {
    names: string[]
    hasFileRollback: boolean
    fileRollbackTag: string | null
  }

  expect(result.hasFileRollback, `registered actions: ${result.names.join(", ")}`).toBe(true)
  expect(result.fileRollbackTag).toBe("fileRollback")
})
