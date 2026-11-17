import assert from "node:assert/strict"
import test from "node:test"

import {
  handleAjaxModuleConnectorRequest,
  type AjaxModuleConnectorOptions
} from "../src/lib/server/ajax-module-connector.ts"

const request = (form: Record<string, string>) =>
  new Request("http://scp-wiki.local/ajax-module-connector.php", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form)
  })

type PreviewInput = {
  siteId: number
  title: string
  wikitext: string
  syntaxOnly: boolean
}

const options = (
  inputs: PreviewInput[],
  output = { body: "<p>previewed</p>", styles: [] as string[] }
): AjaxModuleConnectorOptions => ({
  siteId: 6000006,
  renderListPages: async () => assert.fail("must not render ListPages"),
  renderPagePreviewModule: async (input) => {
    inputs.push(input)
    return output
  }
})

test("dispatches the live PagePreviewModule page form and returns the live envelope", async () => {
  const inputs: PreviewInput[] = []
  const response = await handleAjaxModuleConnectorRequest(
    request({
      moduleName: "edit/PagePreviewModule",
      mode: "page",
      source: "unsaved [[iftags +tag]] body",
      title: "A title",
      wikidot_token7: "token",
      callbackIndex: "2"
    }),
    options(inputs, { body: "<p>unsaved</p>", styles: ["p { color: red }"] })
  )
  const result = await response.json()
  assert.equal(result.status, "ok")
  assert.equal(result.title, "A title")
  assert.equal(result.body, "<p>unsaved</p>")
  assert.deepEqual(result.cssInclude, ["p { color: red }"])
  assert.deepEqual(result.jsInclude, [])
  assert.equal(result.callbackIndex, "2")
  assert.equal(typeof result.CURRENT_TIMESTAMP, "number")
  assert.deepEqual(inputs, [
    {
      siteId: 6000006,
      title: "A title",
      wikitext: "unsaved [[iftags +tag]] body",
      syntaxOnly: false
    }
  ])
})

test("PagePreviewModule maps syntax mode to syntax-only rendering", async () => {
  const inputs: PreviewInput[] = []
  const response = await handleAjaxModuleConnectorRequest(
    request({
      moduleName: "edit/PagePreviewModule",
      mode: "syntax",
      source: "'''bold'''",
      title: "Syntax"
    }),
    options(inputs)
  )
  assert.equal((await response.json()).status, "ok")
  assert.equal(inputs[0].syntaxOnly, true)
})

test("PagePreviewModule rejects unsupported shapes and missing handlers", async () => {
  const inputs: PreviewInput[] = []
  const withHandler = options(inputs)
  const unknown = await handleAjaxModuleConnectorRequest(
    request({
      moduleName: "edit/PagePreviewModule",
      mode: "page",
      source: "x",
      extra: "y"
    }),
    withHandler
  )
  assert.equal((await unknown.json()).status, "not_ok")
  assert.equal(inputs.length, 0)

  const noHandler = {
    ...withHandler,
    renderPagePreviewModule: undefined
  } as AjaxModuleConnectorOptions
  const missing = await handleAjaxModuleConnectorRequest(
    request({ moduleName: "edit/PagePreviewModule", mode: "page", source: "x" }),
    noHandler
  )
  const missingBody = await missing.json()
  assert.equal(missingBody.status, "not_ok")
  assert.match(missingBody.message, /Unsupported AJAX module: edit\/PagePreviewModule/)
})
