import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const cliPath = path.join(
  repositoryRoot,
  "install/local/wikidot-verification/scripts/build-deepwell-jsonrpc-contract-manifest.mjs"
)
const inventoryCliPath = path.join(
  repositoryRoot,
  "install/local/wikidot-verification/scripts/build-compatibility-surface-inventory.mjs"
)
const manifestPath = path.join(repositoryRoot, "docs/development/deepwell-jsonrpc-contract-manifest.json")

function runCli(cli, argumentsList) {
  return spawnSync(process.execPath, [cli, ...argumentsList], { encoding: "utf8" })
}

test("Deepwell JSON-RPC manifest exactly covers the current registered contract", async () => {
  const result = runCli(cliPath, ["--root", repositoryRoot, "--verify"])

  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  assert.equal(manifest.schema, "wikijump.deepwell_jsonrpc_contract_manifest.v1")
  assert.equal(manifest.method_count, 163)
  assert.equal(manifest.methods.length, manifest.method_count)
  assert.equal(new Set(manifest.methods.map(({ method }) => method)).size, manifest.method_count)
  for (const method of manifest.methods) {
    assert.equal(method.endpoint_owner.component, "deepwell")
    assert.match(method.endpoint_owner.source, /^deepwell\/src\/endpoints\/[^/]+\.rs#[A-Za-z_][A-Za-z0-9_]*$/u)
    assert.match(method.endpoint_owner.source_sha256, /^[0-9a-f]{64}$/u)
    assert.equal(method.params_schema.transport, "jsonrpsee::types::params::Params<'static>")
    assert.equal(typeof method.params_schema.decoder, "string")
    assert.ok(Array.isArray(method.actor_context.requirements))
    assert.ok(["mutating", "read_only_or_indirect"].includes(method.mutation_class.classification))
    assert.ok(["default", "RepeatableRead"].includes(method.transaction_isolation))
    assert.equal(method.test_witness.reference, "install/local/wikidot-verification/tests/deepwell-jsonrpc-contract-manifest.test.mjs#Deepwell JSON-RPC manifest exactly covers the current registered contract")
  }

  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "deepwell-contract-inventory-"))
  const inventoryPath = path.join(outputDirectory, "inventory.json")
  const inventoryResult = runCli(inventoryCliPath, ["--root", repositoryRoot, "--output", inventoryPath])
  assert.equal(inventoryResult.status, 0, inventoryResult.stderr)
  const inventory = JSON.parse(await fs.readFile(inventoryPath, "utf8"))
  const inventoryMethods = inventory.surfaces
    .filter(({ kind }) => kind === "deepwell_jsonrpc_method")
    .map(({ surface_id }) => surface_id.slice("deepwell-jsonrpc:".length))
    .sort()
  assert.deepEqual(inventoryMethods, manifest.methods.map(({ method }) => method).sort())
})

test("Deepwell JSON-RPC verifier rejects omitted or duplicate contract records", async () => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "deepwell-contract-manifest-"))
  const outputPath = path.join(outputDirectory, "manifest.json")
  await fs.copyFile(manifestPath, outputPath)
  const original = JSON.parse(await fs.readFile(outputPath, "utf8"))

  const omitted = structuredClone(original)
  omitted.methods.pop()
  omitted.method_count -= 1
  await fs.writeFile(outputPath, `${JSON.stringify(omitted, null, 2)}\n`)
  const omittedResult = runCli(cliPath, ["--root", repositoryRoot, "--output", outputPath, "--verify"])
  assert.equal(omittedResult.status, 1)
  assert.match(omittedResult.stderr, /contract manifest is stale/u)

  const duplicate = structuredClone(original)
  duplicate.methods.push(structuredClone(duplicate.methods[0]))
  duplicate.method_count += 1
  await fs.writeFile(outputPath, `${JSON.stringify(duplicate, null, 2)}\n`)
  const duplicateResult = runCli(cliPath, ["--root", repositoryRoot, "--output", outputPath, "--verify"])
  assert.equal(duplicateResult.status, 1)
  assert.match(duplicateResult.stderr, /contract manifest is stale/u)
})

test("Deepwell JSON-RPC generator rejects a duplicate source registration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepwell-contract-source-"))
  await fs.cp(path.join(repositoryRoot, "deepwell"), path.join(root, "deepwell"), { recursive: true })
  for (const evidencePath of [
    "install/local/wikidot-verification/artifacts/pr1334-deepwell-identity-jsonrpc-attribution-20260810.json",
    "install/local/wikidot-verification/artifacts/pr1334-deepwell-page-revision-jsonrpc-attribution-20260810.json"
  ]) {
    const target = path.join(root, evidencePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(repositoryRoot, evidencePath), target)
  }
  const apiPath = path.join(root, "deepwell/src/api.rs")
  const apiSource = await fs.readFile(apiPath, "utf8")
  await fs.writeFile(apiPath, apiSource.replace("#[cfg(test)]", 'register!("ping", ping);\n\n#[cfg(test)]'))

  const result = runCli(cliPath, ["--root", root, "--output", path.join(root, "manifest.json")])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /duplicate JSON-RPC registration: ping/u)
})
