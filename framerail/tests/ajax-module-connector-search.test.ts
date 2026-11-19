import assert from "node:assert/strict"
import test from "node:test"

import { handleAjaxModuleConnectorRequest } from "../src/lib/server/ajax-module-connector.ts"

const MODULE_NAME = "search/SearchModule"

const request = (fields: Record<string, string>) =>
  new Request("http://sandbox.local/ajax-module-connector.php", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields)
  })

const baseOptions = {
  siteId: 17,
  renderListPages: async () => assert.fail("must not render ListPages")
}

test("Search module connector forwards the query and returns Deepwell results", async () => {
  let received:
    { siteId: number; query: string; parameters: Record<string, string> } | undefined
  const response = await handleAjaxModuleConnectorRequest(
    request({
      moduleName: MODULE_NAME,
      query: "grey elephants",
      mini: "true"
    }),
    {
      ...baseOptions,
      renderSearchModule: async (input) => {
        received = input
        return { body: '<div class="search-results">found</div>' }
      }
    }
  )
  const body = await response.json()

  assert.equal(body.status, "ok")
  assert.equal(body.body, '<div class="search-results">found</div>')
  assert.deepEqual(received, {
    siteId: 17,
    query: "grey elephants",
    parameters: { mini: "true" }
  })
})

test("Search module connector fails closed when rendering is unavailable", async () => {
  const response = await handleAjaxModuleConnectorRequest(
    request({ moduleName: MODULE_NAME, query: "elephant" }),
    baseOptions
  )
  assert.deepEqual(await response.json(), {
    status: "not_ok",
    message: "Search module rendering is unavailable"
  })
})
