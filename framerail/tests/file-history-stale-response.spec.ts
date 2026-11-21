import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import { svelte } from "@sveltejs/vite-plugin-svelte"
import { expect, test, type Route } from "@playwright/test"
import sveltePreprocess from "svelte-preprocess"
import { createServer, type ViteDevServer } from "vite"

const framerailDir = process.cwd()
const harnessDir = resolve(framerailDir, "tests/file-history-stale-response")
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
    cacheDir: resolve(framerailDir, ".vite-harness-file-history-stale-response"),
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

test("a stale file history response cannot replace revisions of the selected file", async ({
  page
}) => {
  const file = (fileId: number, name: string) => ({
    file_id: fileId,
    file_created_at: "2026-01-01T00:00:00.000Z",
    file_updated_at: null,
    file_deleted_at: null,
    page_id: 3000000032,
    revision_id: fileId + 1000,
    revision_type: "create",
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

  const revision = (fileId: number, name: string, comments: string) => ({
    revision_id: fileId + 2000,
    revision_type: "create",
    created_at: "2026-01-01T00:00:00.000Z",
    revision_number: 0,
    file_id: fileId,
    page_id: 3000000032,
    site_id: 6000001,
    user_id: 7,
    name,
    s3_hash: null,
    mime: "image/svg+xml",
    size: 12,
    comments
  })

  const response = (res: unknown[]) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ type: "success", data: { res } })
  })

  const fileA = file(5, "file-a.svg")
  const fileB = file(4, "file-b.svg")
  const revisionA = revision(5, "file-a.svg", "file A revision")
  const revisionB = revision(4, "file-b.svg", "file B revision")
  let heldHistoryForA: Route | undefined
  const requestedFileIds: number[] = []

  await page.route(
    (url) => url.search === "?/fileList",
    (route) => route.fulfill(response([fileA, fileB]))
  )
  await page.route(
    (url) => url.search === "?/fileHistory",
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        fileId?: number
      }
      requestedFileIds.push(body.fileId ?? 0)
      if (body.fileId === fileA.file_id) {
        heldHistoryForA = route
        return
      }
      await route.fulfill(response([revisionB]))
    }
  )

  await page.goto(baseURL)
  await expect(page.locator(".file-row")).toHaveCount(2)

  await page.locator('.file-row[data-id="5"] a', { hasText: "history" }).click()
  await expect.poll(() => Boolean(heldHistoryForA)).toBe(true)

  await page.locator('.file-row[data-id="4"] a', { hasText: "history" }).click()
  await expect(page.locator(".revision-row")).toHaveCount(1)
  await expect(page.locator(".revision-row")).toContainText("file B revision")

  const staleResponse = page.waitForResponse(
    (resp) =>
      new URL(resp.url()).search === "?/fileHistory" &&
      (resp.request().postData() ?? "").includes('"fileId":5')
  )
  await heldHistoryForA!.fulfill(response([revisionA]))
  await staleResponse
  await page.waitForTimeout(300)

  expect(requestedFileIds).toEqual([5, 4])
  await expect(page.locator(".revision-row")).toHaveCount(1)
  await expect(page.locator(".revision-row")).toContainText("file B revision")
  await expect(page.locator(".revision-row")).not.toContainText("file A revision")
})
