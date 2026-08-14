import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { verifyIssue1375XmlRpcProtocolSurfaceContract } from "../src/issue1375-xmlrpc-protocol-surface-contract.mjs"

const contractUrl = new URL("../fixtures/issue1375-xmlrpc-protocol-surface-contract.json", import.meta.url)
const wikijumpRoot = new URL("../../../../", import.meta.url)
const contract = JSON.parse(await readFile(contractUrl, "utf8"))
const options = {
  repositories: {
    wikijump: wikijumpRoot
  }
}

test("issue #1375 XML-RPC protocol contract is exact and source-bound", async () => {
  const result = await verifyIssue1375XmlRpcProtocolSurfaceContract(contract, options)
  assert.deepEqual(result, {
    authority_gap_count: 3,
    historical_attribution: { method_count: 17, record_count: 31 },
    live_observation_count: 26,
    missing_control_count: 10,
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

  const inventedRevision = structuredClone(contract)
  inventedRevision.repositories.find(({ repository_id }) => repository_id === "wikijump").revision =
    "f".repeat(40)
  await assert.rejects(
    verifyIssue1375XmlRpcProtocolSurfaceContract(inventedRevision, options),
    /source revision is unavailable: wikijump/
  )

  const sourceDrift = structuredClone(contract)
  sourceDrift.sources.find(({ source_id }) => source_id === "framerail-authentication").sha256 =
    "0".repeat(64)
  await assert.rejects(
    verifyIssue1375XmlRpcProtocolSurfaceContract(sourceDrift, options),
    /source drift: framerail-authentication/
  )

  const snapshotDrift = structuredClone(contract)
  const apiSnapshot = snapshotDrift.sources.find(
    ({ source_id }) => source_id === "wikidot-api-reference"
  )
  apiSnapshot.sha256 = "0".repeat(64)
  apiSnapshot.upstream.sha256 = "0".repeat(64)
  await assert.rejects(
    verifyIssue1375XmlRpcProtocolSurfaceContract(snapshotDrift, options),
    /source drift: wikidot-api-reference/
  )

  const omittedObservation = structuredClone(contract)
  omittedObservation.protocol_evidence_bindings
    .find(({ surface_id }) => surface_id === "xmlrpc-protocol:multicall-boundary:count")
    .observation_ids.pop()
  await assert.rejects(
    verifyIssue1375XmlRpcProtocolSurfaceContract(omittedObservation, options),
    /live observations must be bound exactly once/
  )

  const duplicateObservation = structuredClone(contract)
  duplicateObservation.protocol_evidence_bindings
    .find(({ surface_id }) => surface_id === "xmlrpc-protocol:multicall-boundary:nested")
    .observation_ids.push("xmlrpc-live:multicall-count-100")
  await assert.rejects(
    verifyIssue1375XmlRpcProtocolSurfaceContract(duplicateObservation, options),
    /live observations must be bound exactly once/
  )

  const masqueradingControl = structuredClone(contract)
  masqueradingControl.protocol_evidence_bindings
    .find(({ surface_id }) => surface_id === "xmlrpc-protocol:resource-boundary:body-bytes")
    .observation_ids.push("xmlrpc-missing:request-body-limit")
  await assert.rejects(
    verifyIssue1375XmlRpcProtocolSurfaceContract(masqueradingControl, options),
    /binding refers to an unknown live observation/
  )
})
