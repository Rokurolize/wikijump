import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const cli = path.join(root, "install/local/wikidot-verification/scripts/verify-wikidot-py-amc-transport-contract.mjs")
const contractPath = path.join(root, "docs/development/wikidot-py-amc-transport-contract.json")
const sourceRoot = "/home/roku/src/Rokurolize/wikidot.py"

const run = (contract = contractPath, source = sourceRoot) => spawnSync(process.execPath, [
  cli, "--contract", contract, "--source-root", source
], { encoding: "utf8" })

test("AMC transport contract is complete and bound to the supported wikidot.py source", () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /verified 19 AMC transport records/u)
})

test("AMC transport verifier rejects omitted, duplicate, and unknown records", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-contract-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const original = JSON.parse(await fs.readFile(contractPath, "utf8"))
  const mutations = [
    (contract) => contract.records.pop(),
    (contract) => contract.records.push(structuredClone(contract.records[0])),
    (contract) => contract.records.push({ ...structuredClone(contract.records[0]), id: "unknown" })
  ]

  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(original)
    mutate(changed)
    const changedPath = path.join(directory, `${index}.json`)
    await fs.writeFile(changedPath, `${JSON.stringify(changed, null, 2)}\n`)
    const result = run(changedPath)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /record (coverage|identity)/u)
  }
})

test("AMC transport verifier rejects source drift", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-source-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  for (const relativePath of [
    "src/wikidot/connector/ajax.py",
    "src/wikidot/common/exceptions.py",
    "tests/unit/test_amc_client.py"
  ]) {
    const target = path.join(directory, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(sourceRoot, relativePath), target)
  }
  await fs.appendFile(path.join(directory, "src/wikidot/connector/ajax.py"), "\n# drift\n")

  const result = run(contractPath, directory)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /source drift/u)
})
