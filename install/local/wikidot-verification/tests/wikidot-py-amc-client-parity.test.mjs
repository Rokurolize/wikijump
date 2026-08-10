import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { handleAjaxModuleConnectorRequest } from "../../../../framerail/src/lib/server/ajax-module-connector.js"

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
)
const contractPath = path.join(
  repositoryRoot,
  "docs/development/wikidot-py-amc-client-parity.json"
)
const contract = JSON.parse(await fs.readFile(contractPath, "utf8"))

const targetResponse = async (origin, requestExample) => {
  const response = await handleAjaxModuleConnectorRequest(
    new Request(`${origin}/ajax-module-connector.php`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(requestExample)
    }),
    {
      siteId: 6000006,
      renderListPages: async ({ moduleBody }) => ({ body: moduleBody }),
      renderForumModule: async ({ moduleName }) => ({
        status: "ok",
        body: `<div>${moduleName}</div>`
      }),
      renderMembersList: async () => ({
        status: "ok",
        body: '<div id="ml-12345">members</div>'
      }),
      renderPageReadModule: async ({ moduleName }) => ({
        status: "ok",
        body: `<div>${moduleName}</div>`
      }),
      renderEditMetaModule: async () => ({
        status: "ok",
        body: "<div>edit meta</div>"
      })
    }
  )
  const body = await response.json()
  delete body.CURRENT_TIMESTAMP
  return { status: response.status, body }
}

test("client parity contract has one terminal record for every extracted module shape", () => {
  assert.equal(contract.schema, "wikijump.wikidot_py_amc_client_parity.v1")
  assert.match(contract.source.commit, /^[0-9a-f]{40}$/u)
  assert.deepEqual(contract.target_invariant.request_target_fields, [])
  assert.deepEqual(contract.target_invariant.configuration_only, [
    "local_base_url",
    "cookies",
    "wikidot_token7"
  ])

  const identifiers = contract.modules.map(
    ({ module_name, parameters }) => `${module_name}:${parameters.join(",")}`
  )
  assert.equal(new Set(identifiers).size, identifiers.length)
  for (const module of contract.modules) {
    assert.match(module.source_reference, /^src\/wikidot\/module\//u)
    assert.ok(!module.parameters.includes("*"), `${module.module_name} must enumerate parameters`)
    assert.ok(["supported", "unsupported_unevidenced"].includes(module.status))
    if (module.status === "supported") {
      assert.equal(module.request_example.moduleName, module.module_name)
    } else {
      assert.ok(module.gap.length > 0)
      assert.equal(module.request_example, undefined)
    }
  }
})

test("supported wikidot.py request bodies behave identically when only the target changes", async () => {
  const targets = ["https://scp-wiki.wikidot.test", "https://scp-wiki.wikijump.localhost"]
  for (const module of contract.modules.filter(({ status }) => status === "supported")) {
    const responses = await Promise.all(
      targets.map((target) => targetResponse(target, module.request_example))
    )
    assert.deepEqual(responses[1], responses[0], module.module_name)
    assert.equal(responses[0].status, 200, module.module_name)
    assert.equal(responses[0].body.status, "ok", module.module_name)
  }
})

test("ListPages rejects parameters outside the explicit compatibility allowlist", async () => {
  let rendered = false
  const response = await handleAjaxModuleConnectorRequest(
    new Request("https://scp-wiki.wikijump.localhost/ajax-module-connector.php", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        moduleName: "list/ListPagesModule",
        module_body: "%%fullname%%",
        arbitrary_future_selector: "widened"
      })
    }),
    {
      siteId: 6000006,
      renderListPages: async () => {
        rendered = true
        return { body: "unexpected" }
      }
    }
  )

  assert.equal(rendered, false)
  assert.deepEqual(await response.json(), {
    status: "not_ok",
    message: "Unsupported AJAX module shape: list/ListPagesModule"
  })
})
