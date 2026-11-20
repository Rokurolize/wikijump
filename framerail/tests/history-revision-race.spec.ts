import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import { svelte } from "@sveltejs/vite-plugin-svelte"
import { expect, test, type Route } from "@playwright/test"
import ts from "typescript"
import { createServer, type ViteDevServer } from "vite"

const framerailDir = process.cwd()
const harnessDir = resolve(framerailDir, "tests/history-revision-race")
const stub = (name: string) => resolve(harnessDir, "stubs", name)

let server: ViteDevServer
let baseURL: string

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: harnessDir,
    plugins: [
      svelte({
        preprocess: {
          script: ({ content, attributes }) =>
            attributes.lang === "ts"
              ? {
                  code: ts.transpileModule(content, {
                    compilerOptions: {
                      target: ts.ScriptTarget.ESNext,
                      module: ts.ModuleKind.ESNext,
                      verbatimModuleSyntax: true
                    }
                  }).outputText
                }
              : undefined
        }
      })
    ],
    resolve: {
      alias: [
        { find: "$app/forms", replacement: stub("app-forms.ts") },
        { find: "$app/navigation", replacement: stub("app-navigation.ts") },
        { find: "$lib/stores.svelte", replacement: stub("stores.svelte.ts") },
        { find: "$lib/types", replacement: stub("types.ts") }
      ]
    },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [framerailDir] } },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { tsconfigRaw: "{}" },
    logLevel: "error"
  })
  await server.listen()
  const address = server.httpServer?.address() as AddressInfo
  baseURL = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  await server?.close()
})

test("a late response from an older revision click does not replace the newer click", async ({
  page
}) => {
  const revision = (revisionNumber: number, compiledBodyHtml: string) => ({
    revision_id: revisionNumber,
    revision_number: revisionNumber,
    revision_type: "regular",
    user_id: 7,
    created_at: "2026-01-02T00:00:00.000Z",
    comments: `revision ${revisionNumber}`,
    compiled_body_html: compiledBodyHtml,
    wikitext: ""
  })

  const historyResponse = {
    contentType: "application/json",
    body: JSON.stringify({
      type: "success",
      data: { res: [revision(2, ""), revision(1, "")] }
    })
  }

  let heldRevisionOne: Route | undefined

  await page.route(
    (url) => url.search === "?/history",
    (route) => route.fulfill(historyResponse)
  )
  await page.route(
    (url) => url.search === "?/revision",
    async (route) => {
      const request = JSON.parse(route.request().postData() ?? "{}")
      if (request.revisionNumber === 1) {
        heldRevisionOne = route
        return
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "success",
          data: { res: revision(2, "race A") }
        })
      })
    }
  )

  await page.goto(baseURL)
  const published = page.locator("#published-revision")
  await expect(page.locator("#revision-row-1")).toBeVisible()

  await page.locator("#revision-row-1 .view-revision").click()
  await page.locator("#revision-row-2 .view-revision").click()
  await expect(published).toHaveText("2:race A")

  expect(heldRevisionOne).toBeDefined()
  await heldRevisionOne!.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      type: "success",
      data: { res: revision(1, "edited by admin alice") }
    })
  })
  await page.waitForTimeout(300)
  await expect(published).toHaveText("2:race A")
})

async function assertViewSourceRace(
  page: import("@playwright/test").Page,
  layout: "wikidot" | "default"
) {
  const revision = (revisionNumber: number, wikitext: string) => ({
    revision_id: revisionNumber,
    revision_number: revisionNumber,
    revision_type: "regular",
    user_id: 7,
    created_at: "2026-01-02T00:00:00.000Z",
    comments: `revision ${revisionNumber}`,
    compiled_body_html: "",
    wikitext
  })

  let heldOlder: Route | undefined

  await page.route(
    (url) => url.search === "?/history",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "success",
          data: { res: [revision(2, ""), revision(1, "")] }
        })
      })
  )
  await page.route(
    (url) => url.search === "?/revision",
    async (route) => {
      const request = JSON.parse(route.request().postData() ?? "{}")
      if (request.revisionNumber === 1) {
        heldOlder = route
        return
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "success",
          data: { res: revision(2, "source B") }
        })
      })
    }
  )

  await page.goto(`${baseURL}/?layout=${layout}`)
  const row = (revisionNumber: number) =>
    layout === "wikidot"
      ? page.locator(`#revision-row-${revisionNumber}`)
      : page.locator(".revision-row").nth(2 - revisionNumber)
  const source =
    layout === "wikidot"
      ? page.locator("#history-subarea .page-source")
      : page.locator("textarea.revision-source")

  await expect(row(1)).toBeVisible()
  await row(1).locator(".view-revision-source").click()
  await row(2).locator(".view-revision-source").click()
  await expect(source).toHaveValue("source B")

  expect(heldOlder).toBeDefined()
  await heldOlder!.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      type: "success",
      data: { res: revision(1, "source A") }
    })
  })
  await page.waitForTimeout(300)
  await expect(source).toHaveValue("source B")
}

test("a late view-source response cannot replace the newer source view", async ({
  page
}) => {
  await assertViewSourceRace(page, "wikidot")
})

test("a late view-source response cannot replace the newer source view in the standard layout", async ({
  page
}) => {
  await assertViewSourceRace(page, "default")
})
