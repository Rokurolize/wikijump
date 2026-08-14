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
const requirements = await fs.readFile(
  path.join(repositoryRoot, "install/local/wikidot-verification/requirements.txt"),
  "utf8"
)

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
  assert.deepEqual(
    {
      repository: contract.source.repository,
      commit: contract.source.commit,
      root_tree: contract.source.root_tree,
      objects: contract.source.objects
    },
    {
      repository: "Rokurolize/wikidot.py",
      commit: "9f33c0f450de9daf333b068e8d70527e033fc07c",
      root_tree: "7511e9dc88e5f585ff44f58a6275ff2634c34e3c",
      objects: [
        { path: "src/wikidot", type: "tree", oid: "e4c0e5299b6b68c771a2bf263c656d73f2ffdd38" },
        { path: "src/wikidot/module", type: "tree", oid: "514e1dfe6cada07f123f4f922c815fafe71ccc4b" },
        { path: "src/wikidot/connector", type: "tree", oid: "5e53e6b1bb4cc3591055100c99fcc8ed53ef0a7f" },
        { path: "src/wikidot/connector/ajax.py", type: "blob", oid: "9566f18a37cee098c371519963eeaadb56121e81" },
        { path: "pyproject.toml", type: "blob", oid: "7d2ed894e868994ce41af5fa83b4494fcb43cd07" },
        { path: "uv.lock", type: "blob", oid: "30a21e269683d755c5715cc937e332c8442143aa" }
      ]
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
    /^wikidot @ git\+https:\/\/github\.com\/Rokurolize\/wikidot\.py@9f33c0f450de9daf333b068e8d70527e033fc07c$/mu
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
