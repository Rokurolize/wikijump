import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import { svelte } from "@sveltejs/vite-plugin-svelte"
import { expect, test, type Route } from "@playwright/test"
import sveltePreprocess from "svelte-preprocess"
import { createServer, type ViteDevServer } from "vite"

const framerailDir = process.cwd()
const harnessDir = resolve(framerailDir, "tests/files-pane-restore-race")
const stub = (name: string) => resolve(harnessDir, "stubs", name)

let server: ViteDevServer
let baseURL: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: harnessDir,
    plugins: [svelte({ preprocess: sveltePreprocess() })],
    resolve: {
      alias: [
        { find: "$app/forms", replacement: stub("app-forms.ts") },
        { find: "$app/navigation", replacement: stub("app-navigation.ts") },
        { find: "$lib/stores.svelte", replacement: stub("stores.svelte.ts") },
        { find: "$lib/types", replacement: stub("types.ts") },
        {
          find: "$lib/component/scripts/toasts",
          replacement: stub("toasts.ts")
        },
        { find: "sveltekit-superforms", replacement: stub("superforms.ts") }
      ]
    },
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

test("a late initial file list cannot replace the deleted view opened by Restore", async ({
  page
}) => {
  const file = (fileId: number, name: string, deleted: boolean) => ({
    file_id: fileId,
    file_created_at: "2026-01-01T00:00:00.000Z",
    file_updated_at: null,
    file_deleted_at: deleted ? "2026-01-02T00:00:00.000Z" : null,
    page_id: 3000000032,
    revision_id: fileId + 1000,
    revision_type: deleted ? "delete" : "create",
    revision_created_at: "2026-01-01T00:00:00.000Z",
    revision_user_id: 7,
    revision_number: 0,
    name,
    data: null,
    mime: "image/svg+xml",
    size: 12,
    s3_hash: "fixture-hash",
    revision_comments: ""
  })

  const response = (res: unknown[]) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ type: "success", data: { res } })
  })

  const active = file(5, "active-fixture.svg", false)
  const deleted = file(7, "deleted-fixture.svg", true)
  let heldActive: Route | undefined
  const requests: boolean[] = []

  await page.route(
    (url) => url.search === "?/fileList",
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        deleted?: boolean
      }
      requests.push(body.deleted === true)
      if (body.deleted === false && !heldActive) {
        heldActive = route
        return
      }
      await route.fulfill(response(body.deleted ? [deleted] : [active]))
    }
  )

  await page.goto(baseURL)
  await expect.poll(() => Boolean(heldActive)).toBe(true)

  const restoreToggle = page.locator(".file-panel .buttons input").nth(1)
  await restoreToggle.click()
  await expect(page.locator(".file-row")).toHaveCount(1)
  await expect(page.locator(".file-row")).toContainText("deleted-fixture.svg")

  const staleResponse = page.waitForResponse(
    (resp) =>
      new URL(resp.url()).search === "?/fileList" &&
      (resp.request().postData() ?? "").includes('"deleted":false')
  )
  await heldActive!.fulfill(response([active]))
  await staleResponse
  await page.waitForTimeout(300)

  expect(requests).toEqual([false, true])
  await expect(page.locator(".file-row")).toHaveCount(1)
  await expect(page.locator(".file-row")).toContainText("deleted-fixture.svg")
  await expect(page.locator(".file-row")).not.toContainText("active-fixture.svg")
})
