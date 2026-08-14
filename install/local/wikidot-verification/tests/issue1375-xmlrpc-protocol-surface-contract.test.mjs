import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { verifyIssue1375XmlRpcProtocolSurfaceContract } from "../src/issue1375-xmlrpc-protocol-surface-contract.mjs"

const contractUrl = new URL("../fixtures/issue1375-xmlrpc-protocol-surface-contract.json", import.meta.url)
const wikijumpRoot = new URL("../../../../", import.meta.url)
const translationRoot = new URL("../../../../../scp-wiki-translation/", import.meta.url)
const contract = JSON.parse(await readFile(contractUrl, "utf8"))
const options = {
  repositories: {
    "scp-wiki-translation": translationRoot,
    wikijump: wikijumpRoot
  },
  repositoryRevisions: {
    "scp-wiki-translation": "58b996999930e88dec937db5eaa6363c94b48b8e",
    wikijump: "acb51c30120317936e7da8a52c89d4ae062310eb"
  }
}

test("issue #1375 XML-RPC protocol contract is exact and source-bound", async () => {
  const result = await verifyIssue1375XmlRpcProtocolSurfaceContract(contract, options)
  assert.deepEqual(result, {
    authority_gap_count: 3,
    historical_attribution: { method_count: 17, record_count: 31 },
    protocol_record_count: 16,
    source_count: 12
  })

  for (const mutation of [
    (value) => value.protocol_records.pop(),
    (value) => value.protocol_records.push(structuredClone(value.protocol_records[0])),
    (value) => value.protocol_records.push({
      ...structuredClone(value.protocol_records[0]),
      surface_id: "xmlrpc-protocol:unknown"
    })
  ]) {
    const changed = structuredClone(contract)
    mutation(changed)
    await assert.rejects(
      verifyIssue1375XmlRpcProtocolSurfaceContract(changed, options),
      /protocol records must contain each expected surface exactly once/
    )
  }

  await assert.rejects(
    verifyIssue1375XmlRpcProtocolSurfaceContract(contract, {
      ...options,
      readFile: async (url) => {
        const bytes = await readFile(url)
        return url.pathname.endsWith("authentication.ts")
          ? Buffer.concat([bytes, Buffer.from("\n// drift\n")])
          : bytes
      }
    }),
    /source drift: framerail-authentication/
  )
})
