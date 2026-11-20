import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { createServer, type ViteDevServer } from "vite"

const framerailDir = process.cwd()
const harnessDir = resolve(framerailDir, "tests/fileedit-ip-address")
const stub = (name: string) => resolve(harnessDir, "stubs", name)

let server: ViteDevServer
let baseURL: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: harnessDir,
    resolve: {
      alias: [
        { find: "$lib/defaults", replacement: stub("defaults.ts") },
        { find: /^\$lib\/server\/deepwell$/, replacement: stub("deepwell.ts") },
        { find: "$lib/server/deepwell/file", replacement: stub("file.ts") },
        { find: "$lib/types", replacement: resolve(framerailDir, "src/lib/types.ts") },
        { find: /^\$lib\//, replacement: `${resolve(framerailDir, "src/lib")}/` },
        {
          find: "sveltekit-superforms/adapters",
          replacement: stub("superforms-adapters.ts")
        },
        { find: "sveltekit-superforms", replacement: stub("superforms.ts") }
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

test("file_edit RPC gets the client ip_address required by Deepwell", async ({
  page
}) => {
  await page.goto(baseURL)
  await expect.poll(() => page.locator("#result").innerText()).not.toBe("pending")
  const result = (await page.evaluate(() => globalThis.__result)) as {
    methods: string[]
    params: Record<string, unknown> | null
  }

  expect(result.methods).toContain("file_edit")
  expect(
    result.params,
    "the fileEdit action must forward the address from getClientAddress()"
  ).toMatchObject({
    ip_address: "203.0.113.7"
  })
})
