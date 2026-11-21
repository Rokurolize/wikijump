import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import { svelte } from "@sveltejs/vite-plugin-svelte"
import { expect, test } from "@playwright/test"
import sveltePreprocess from "svelte-preprocess"
import { createServer, type ViteDevServer } from "vite"

const framerailDir = process.cwd()
const harnessDir = resolve(framerailDir, "tests/restore-radio-form-state")
const stub = (name: string) => resolve(harnessDir, "stubs", name)

let server: ViteDevServer
let baseURL: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: harnessDir,
    plugins: [
      svelte({ preprocess: sveltePreprocess({ typescript: { tsconfigFile: false } }) })
    ],
    resolve: {
      alias: [
        { find: /^\$app\/state$/, replacement: stub("app-state.ts") },
        { find: /^\$app\/forms$/, replacement: stub("app-forms.ts") },
        { find: /^\$app\/paths$/, replacement: stub("app-paths.ts") },
        { find: /^\$app\/navigation$/, replacement: stub("app-navigation.ts") },
        { find: /^\$lib\/stores\.svelte$/, replacement: stub("stores.svelte.ts") },
        { find: /^\$lib\/types$/, replacement: stub("types.ts") },
        { find: /^\$lib\/component\/scripts\/toasts$/, replacement: stub("toasts.ts") },
        { find: /^sveltekit-superforms$/, replacement: stub("superforms.ts") }
      ]
    },
    cacheDir: resolve(framerailDir, ".vite-harness-restore-radio-form-state"),
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

test("selecting a deleted page in the restore form submits that page's id and restores it", async ({
  page
}) => {
  const fixturePageId = 3000003306
  const deletedPage = {
    page_id: fixturePageId,
    title: "r8 radio fixture",
    alt_title: null,
    rating: 0,
    page_deleted_at: "2026-01-01T00:00:00.000Z"
  }
  const submittedPageIds: number[] = []
  const restoreTypes: string[] = []

  await page.route(
    (url) => url.search === "?/deletedGet",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ type: "success", data: { res: [deletedPage] } })
      })
  )
  await page.route("**/?/restore*", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      pageId?: number
    }
    submittedPageIds.push(body.pageId ?? 0)
    const correct = body.pageId === fixturePageId
    restoreTypes.push(correct ? "success" : "failure")
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        correct
          ? {
              type: "success",
              status: 200,
              data: {
                slug: "r8-radio-fixture-page",
                revision_id: 1,
                revision_number: 2,
                parser_errors: []
              }
            }
          : {
              type: "failure",
              status: 500,
              data: {
                message: "Page does not exist",
                code: 2005,
                data: {}
              }
            }
      )
    })
  })

  await page.goto(baseURL)
  await expect(page.locator("#restore-button")).toHaveCount(1)
  await page.locator("#restore-button").click()
  await expect(page.locator("#page-restore input.page-restore-id")).toHaveCount(1)
  await page
    .locator(`#page-restore input.page-restore-id[value="${fixturePageId}"]`)
    .check()
  await expect(
    page.locator(`#page-restore input.page-restore-id[value="${fixturePageId}"]`)
  ).toBeChecked()
  await page.locator('#page-restore input[type="submit"]').click()

  await expect.poll(() => submittedPageIds.length).toBe(1)
  expect(
    submittedPageIds,
    "the restore form must submit the selected page's id, not the initial 0"
  ).toEqual([fixturePageId])
  expect(
    restoreTypes,
    "the restore must succeed when the correct page id is submitted"
  ).toEqual(["success"])
})
