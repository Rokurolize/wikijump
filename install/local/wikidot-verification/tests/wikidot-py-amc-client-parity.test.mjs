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
const sourceLock = JSON.parse(await fs.readFile(
  path.join(repositoryRoot, "docs/development/wikidot-py-supported-source.json"),
  "utf8"
))
const requirements = await fs.readFile(
  path.join(repositoryRoot, "install/local/wikidot-verification/requirements.txt"),
  "utf8"
)

const targetResponse = async (origin, requestExample) => {
  const requestFields = { ...requestExample }
  const headers = { "content-type": "application/x-www-form-urlencoded" }
  if (requestExample.moduleName === "list/ListPagesModule") {
    const token = requestExample.wikidot_token7 ?? "fixture-token"
    requestFields.wikidot_token7 = token
    headers.cookie = `wikidot_token7=${token}`
  } else if (requestExample.wikidot_token7 !== undefined) {
    headers.cookie = `wikidot_token7=${requestExample.wikidot_token7}`
  }
  const response = await handleAjaxModuleConnectorRequest(
    new Request(`${origin}/ajax-module-connector.php`, {
      method: "POST",
      headers,
      body: new URLSearchParams(requestFields)
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
  assert.deepEqual(
    {
      repository: contract.source.repository,
      commit: contract.source.commit,
      root_tree: contract.source.root_tree,
      objects: contract.source.objects
    },
    {
      repository: sourceLock.repository,
      commit: sourceLock.commit,
      root_tree: sourceLock.root_tree,
      objects: sourceLock.objects
    }
  )
  assert.deepEqual(contract.historical_sources, [
    {
      commit: "2434bf77744488cb2095327c9e0e4450add78df3",
      status: "historical_evidence_only",
      references: [
        {
          path: "install/local/wikidot-verification/requirements-2434bf77744488cb2095327c9e0e4450add78df3.txt",
          binding: "requirements_snapshot"
        },
        {
          path: "install/local/wikidot-verification/artifacts/wikidot-py-sitechanges-shape-live-20260810.json",
          binding: "pinned_client"
        },
        {
          path: "install/local/wikidot-verification/scripts/capture_wikidot_py_sitechanges_shape.py",
          binding: "historical_replay_producer"
        },
        {
          path: "install/local/wikidot-verification/scripts/capture_wikidot_py_membership_applications.py",
          binding: "historical_replay_producer"
        },
        {
          path: "install/local/wikidot-verification/fixtures/wikidot-py-membership-applications/cases.json",
          binding: "pinned_client_commit"
        },
        {
          path: "install/local/wikidot-verification/artifacts/wikidot-py-membership-applications-live-20260810.json",
          binding: "historical_case_manifest"
        }
      ]
    },
    {
      commit: "551fe7f05cac0c3322f9c69f43fbd4866d3fdfd2",
      status: "historical_evidence_only",
      references: [
        {
          path: "install/local/wikidot-verification/artifacts/wikidot-py-direct-messages-live-20260810.json",
          binding: "pinned_client"
        },
        {
          path: "install/local/wikidot-verification/artifacts/wikidot-py-forum-revisions-live-20260810.json",
          binding: "parity_record_commit"
        }
      ]
    }
  ])
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

test("active verifier requirements use the supported wikidot.py revision", () => {
  assert.match(
    requirements,
    new RegExp(`^wikidot @ git\\+https:\\/\\/github\\.com\\/Rokurolize\\/wikidot\\.py@${sourceLock.commit}$`, "mu")
  )
  assert.doesNotMatch(requirements, /2434bf77744488cb2095327c9e0e4450add78df3/u)
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

test("ListPages ignores unknown non-data-form parameters outside the compatibility allowlist", async () => {
  let renderedParameters = null
  const response = await handleAjaxModuleConnectorRequest(
    new Request("https://scp-wiki.wikijump.localhost/ajax-module-connector.php", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "wikidot_token7=fixture-token"
      },
      body: new URLSearchParams({
        moduleName: "list/ListPagesModule",
        module_body: "%%fullname%%",
        wikidot_token7: "fixture-token",
        arbitrary_future_selector: "widened"
      })
    }),
    {
      siteId: 6000006,
      renderListPages: async ({ parameters }) => {
        renderedParameters = parameters
        return { body: "%%fullname%%" }
      }
    }
  )

  assert.deepEqual(renderedParameters, {})
  assert.deepEqual(await response.json(), { status: "ok", body: "%%fullname%%" })
})
