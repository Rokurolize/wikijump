#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, "../../../..")
const gitExecutable = "/usr/bin/git"
const gitEnvironment = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin"
})
const expectedSource = {
  repository: "Rokurolize/wikidot.py",
  commit: "9f33c0f450de9daf333b068e8d70527e033fc07c",
  root_tree: "7511e9dc88e5f585ff44f58a6275ff2634c34e3c",
  objects: [
    { path: "src/wikidot/connector/ajax.py", git_oid: "9566f18a37cee098c371519963eeaadb56121e81", sha256: "5e3a5615c4b419a02a4cc631c7995bca0da043b5891cf4cab4d2eb947726fd1a" },
    { path: "src/wikidot/common/exceptions.py", git_oid: "5d0fce2612fbba2a778651a7091140c3b87d01a7", sha256: "585e8cc58be390d0d9611664578bf01ead53fb9c311f6eeebf1e4a81501dc9af" },
    { path: "tests/unit/test_amc_client.py", git_oid: "5111e0250e32a57e392a3e6cfe19de62665a8482", sha256: "83ec1843d509d08f0bd63ee1c41cb73f3d2aa7ab815bd5f848cd5f23c2f1a65c" }
  ]
}
const expectedIds = new Set([
  "form-envelope", "token-injection", "cookie-envelope", "exact-site-http-opt-in",
  "http-session-proxy-isolation", "site-transport-probe", "site-probe-redirect", "amc-redirect",
  "http-retry", "invalid-json-retry", "empty-object-retry", "missing-status", "non-string-status",
  "try-again-status", "not-ok-status", "no-permission-status", "other-status", "ok-and-batch-result",
  "exception-taxonomy"
])
const expectedContractSha256 = "c5ce284742a81fddad0a411087b7950af6b209b4e24a94072ebfdfd3f7376de3"

function parseArgs(argv) {
  let contract = path.join(repositoryRoot, "docs/development/wikidot-py-amc-transport-contract.json")
  let sourceRoot = "/home/roku/src/Rokurolize/wikidot.py"
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--contract") contract = path.resolve(argv[++index] ?? "")
    else if (argv[index] === "--source-root") sourceRoot = path.resolve(argv[++index] ?? "")
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  return { contract, sourceRoot }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

function git(root, ...arguments_) {
  const result = spawnSync(gitExecutable, ["-C", root, ...arguments_], {
    encoding: "utf8",
    env: gitEnvironment
  })
  if (result.status !== 0) throw new Error("AMC transport source Git identity drift")
  return result.stdout.trim()
}

async function main() {
  const { contract: contractPath, sourceRoot } = parseArgs(process.argv.slice(2))
  const contract = JSON.parse(await fs.readFile(contractPath, "utf8"))
  if (contract.schema !== "wikijump.wikidot_py_amc_transport_contract.v1") throw new Error("unknown AMC transport contract schema")
  if (JSON.stringify(contract.source) !== JSON.stringify(expectedSource)) throw new Error("AMC transport source identity drift")

  for (const object of expectedSource.objects) {
    const bytes = await fs.readFile(path.join(sourceRoot, object.path))
    if (sha256(bytes) !== object.sha256) throw new Error(`AMC transport source drift: ${object.path}`)
  }
  const gitIdentity = {
    root: await fs.realpath(sourceRoot),
    topLevel: await fs.realpath(git(sourceRoot, "rev-parse", "--show-toplevel")),
    commit: git(sourceRoot, "rev-parse", "--verify", "HEAD"),
    rootTree: git(sourceRoot, "rev-parse", "HEAD^{tree}"),
    objects: expectedSource.objects.map(({ path: objectPath }) => git(sourceRoot, "rev-parse", `HEAD:${objectPath}`))
  }
  if (gitIdentity.root !== gitIdentity.topLevel || gitIdentity.commit !== expectedSource.commit ||
      gitIdentity.rootTree !== expectedSource.root_tree ||
      gitIdentity.objects.some((oid, index) => oid !== expectedSource.objects[index].git_oid)) {
    throw new Error("AMC transport source Git identity drift")
  }

  if (!Array.isArray(contract.records)) throw new Error("AMC transport record coverage must be an array")
  const ids = contract.records.map(({ id }) => id)
  if (new Set(ids).size !== ids.length) throw new Error("AMC transport record identity is duplicated")
  if (ids.some((id) => !expectedIds.has(id))) throw new Error("AMC transport record identity is unknown")
  if (ids.length !== expectedIds.size || [...expectedIds].some((id) => !ids.includes(id))) {
    throw new Error("AMC transport record coverage is incomplete")
  }
  if (contract.record_count !== expectedIds.size) throw new Error("AMC transport record coverage count is stale")
  for (const record of contract.records) {
    if (!new Set(["request", "transport", "retry", "response", "exception"]).has(record.dimension) ||
        typeof record.contract !== "string" || !record.contract ||
        typeof record.source_ref !== "string" || !record.source_ref.startsWith("src/wikidot/") ||
        typeof record.test_witness !== "string" || !record.test_witness.startsWith("tests/unit/test_amc_client.py#")) {
      throw new Error(`AMC transport record identity is invalid: ${record.id}`)
    }
  }
  if (contract.evidence_boundary?.live_authenticated_evidence !== "missing" ||
      !contract.evidence_boundary?.gaps?.includes("Source-contract coverage must not be reported as live authenticated parity.")) {
    throw new Error("AMC transport evidence boundary is missing")
  }
  if (sha256(JSON.stringify(contract)) !== expectedContractSha256) throw new Error("AMC transport contract drift")
  process.stdout.write(`verified ${contract.records.length} AMC transport records at ${expectedSource.commit}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
