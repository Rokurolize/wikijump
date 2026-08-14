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
const expectedCurrentWitness = {
  path: "install/local/wikidot-verification/artifacts/wikidot-py-amc-authenticated-live-20260815.json",
  sha256: "5b2b09e1f3a405ee98e97792b51a423adf26a8e2f7c0a5fdea3bf5065af80983",
  classification: "current",
  run_id: "wikidot-py-amc-authenticated-live-20260815-a",
  source_commit: expectedSource.commit,
  source_root_tree: expectedSource.root_tree
}
const expectedLock = {
  path: "/home/roku/src/Rokurolize/wikidot.py/uv.lock",
  git_oid: "30a21e269683d755c5715cc937e332c8442143aa",
  sha256: "8644ed6c80c8f658549f8eae20c20cbb6ab5873c34c72b61da4fecac294b8def"
}
const expectedWrapper = {
  path: "/home/roku/.codex/skills/wikidot-py-operations/scripts/wikidot-python",
  sha256: "ed912a115469573bbcc9c071be42b97455331d085f84ab1404cd1a75b9ff5a15"
}
const expectedObservationIds = new Set([
  "authenticated-www-read",
  "logout-cookie-boundary",
  "sandbox-success-envelope",
  "missing-exact-site-opt-in",
  "wrong-exact-site-opt-in",
  "site-probe-same-host-http-redirect",
  "missing-page-terminal-status",
  "invalid-thread-terminal-status",
  "read-not-ok-retry-exhaustion",
  "side-effect-classified-not-ok-terminal",
  "side-effect-http-error-retry-exhaustion"
])
const expectedMissingControlIds = new Set([
  "explicit-token-override",
  "cookie-envelope-validation",
  "http-session-proxy-isolation",
  "site-probe-failure-branches",
  "http-request-error-retry",
  "no-permission-action-context",
  "batch-result-and-return-exceptions",
  "exception-taxonomy-completeness",
  "malformed-or-empty-json-response",
  "missing-status-response",
  "non-string-status-response",
  "try-again-response",
  "amc-post-redirect"
])
const expectedLiveRecordIds = new Set([
  "form-envelope",
  "exact-site-http-opt-in",
  "not-ok-status",
  "other-status"
])
const expectedSecretClaims = {
  session_cookie_present: true,
  session_cookie_value_recorded: false,
  session_cookie_hash_recorded: false,
  token_value_recorded: false,
  token_hash_recorded: false,
  form_token_equal_to_cookie_token: true,
  username_recorded: false,
  password_recorded: false
}
const expectedContractSha256 = "92b09a5358ee912536d42cc27880e5916b07921376daa287c3f6461aef3bb607"

function parseArgs(argv) {
  let contract = path.join(repositoryRoot, "docs/development/wikidot-py-amc-transport-contract.json")
  let sourceRoot = "/home/roku/src/Rokurolize/wikidot.py"
  let evidenceRoot = repositoryRoot
  let wrapper = expectedWrapper.path
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--contract") contract = path.resolve(argv[++index] ?? "")
    else if (argv[index] === "--source-root") sourceRoot = path.resolve(argv[++index] ?? "")
    else if (argv[index] === "--evidence-root") evidenceRoot = path.resolve(argv[++index] ?? "")
    else if (argv[index] === "--wrapper") wrapper = path.resolve(argv[++index] ?? "")
    else throw new Error(`unknown argument: ${argv[index]}`)
  }
  return { contract, evidenceRoot, sourceRoot, wrapper }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

function containsSecretKey(value) {
  if (Array.isArray(value)) return value.some(containsSecretKey)
  if (value === null || typeof value !== "object") return false
  const forbidden = new Set(["username", "password", "token_value", "token_hash", "session_cookie_value", "session_cookie_hash"])
  return Object.entries(value).some(([key, nested]) => forbidden.has(key) || containsSecretKey(nested))
}

function git(root, ...arguments_) {
  const result = spawnSync(gitExecutable, ["-C", root, ...arguments_], {
    encoding: "utf8",
    env: gitEnvironment
  })
  if (result.status !== 0) throw new Error("AMC transport source Git identity drift")
  return result.stdout.trim()
}

async function main() {
  const { contract: contractPath, evidenceRoot, sourceRoot, wrapper } = parseArgs(process.argv.slice(2))
  const contract = JSON.parse(await fs.readFile(contractPath, "utf8"))
  if (contract.schema !== "wikijump.wikidot_py_amc_transport_contract.v1") throw new Error("unknown AMC transport contract schema")
  if (JSON.stringify(contract.source) !== JSON.stringify(expectedSource)) throw new Error("AMC transport source identity drift")

  for (const object of expectedSource.objects) {
    const bytes = await fs.readFile(path.join(sourceRoot, object.path))
    if (sha256(bytes) !== object.sha256) throw new Error(`AMC transport source drift: ${object.path}`)
  }
  const lockBytes = await fs.readFile(path.join(sourceRoot, "uv.lock"))
  if (sha256(lockBytes) !== expectedLock.sha256) throw new Error("AMC transport source lock drift")
  const wrapperBytes = await fs.readFile(wrapper)
  if (sha256(wrapperBytes) !== expectedWrapper.sha256) throw new Error("AMC transport execution wrapper drift")
  const gitIdentity = {
    root: await fs.realpath(sourceRoot),
    topLevel: await fs.realpath(git(sourceRoot, "rev-parse", "--show-toplevel")),
    commit: git(sourceRoot, "rev-parse", "--verify", "HEAD"),
    rootTree: git(sourceRoot, "rev-parse", "HEAD^{tree}"),
    objects: expectedSource.objects.map(({ path: objectPath }) => git(sourceRoot, "rev-parse", `HEAD:${objectPath}`)),
    lock: git(sourceRoot, "rev-parse", "HEAD:uv.lock")
  }
  if (gitIdentity.root !== gitIdentity.topLevel || gitIdentity.commit !== expectedSource.commit ||
      gitIdentity.rootTree !== expectedSource.root_tree ||
      gitIdentity.lock !== expectedLock.git_oid ||
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
  if (contract.evidence_boundary?.live_authenticated_evidence !== "mixed_by_record" ||
      !contract.evidence_boundary?.gaps?.includes("Current authenticated coverage must not be widened beyond a live_current record binding.")) {
    throw new Error("AMC transport evidence boundary is missing")
  }
  const currentWitness = contract.evidence?.current_witness
  const historicalWitnesses = contract.evidence?.historical_witnesses
  if (currentWitness?.classification !== "current" || !Array.isArray(historicalWitnesses) ||
      historicalWitnesses.some((witness) => witness?.classification !== "historical") ||
      historicalWitnesses.some((witness) => witness.path === currentWitness.path || witness.run_id === currentWitness.run_id)) {
    throw new Error("AMC transport current and historical witness classification drift")
  }
  if (JSON.stringify(currentWitness) !== JSON.stringify(expectedCurrentWitness)) {
    throw new Error("AMC transport current authenticated witness drift")
  }
  const evidenceBytes = await fs.readFile(path.join(evidenceRoot, expectedCurrentWitness.path))
  const evidence = JSON.parse(evidenceBytes)
  if (evidence.schema !== "wikijump.wikidot_py_amc_authenticated_live.v1" ||
      evidence.classification !== "current" || evidence.run_id !== expectedCurrentWitness.run_id ||
      evidence.source?.commit !== expectedSource.commit || evidence.source?.root_tree !== expectedSource.root_tree ||
      JSON.stringify(evidence.source?.lock) !== JSON.stringify(expectedLock) ||
      JSON.stringify(evidence.source?.wrapper) !== JSON.stringify(expectedWrapper)) {
    throw new Error("AMC transport current authenticated witness identity drift")
  }
  if (containsSecretKey(evidence) || JSON.stringify(evidence.secrets) !== JSON.stringify(expectedSecretClaims)) {
    throw new Error("AMC transport authenticated witness secret redaction drift")
  }
  const observationIds = Array.isArray(evidence.observations) ? evidence.observations.map(({ id }) => id) : []
  if (observationIds.length !== expectedObservationIds.size || new Set(observationIds).size !== observationIds.length ||
      observationIds.some((id) => !expectedObservationIds.has(id)) ||
      [...expectedObservationIds].some((id) => !observationIds.includes(id))) {
    throw new Error("AMC transport authenticated observation coverage is incomplete or duplicated")
  }
  const missingControls = Array.isArray(evidence.missing_controls) ? evidence.missing_controls : []
  const missingControlIds = missingControls.map(({ id }) => id)
  if (missingControlIds.length !== expectedMissingControlIds.size ||
      new Set(missingControlIds).size !== missingControlIds.length ||
      missingControlIds.some((id) => !expectedMissingControlIds.has(id)) ||
      [...expectedMissingControlIds].some((id) => !missingControlIds.includes(id)) ||
      missingControls.some((control) => control.live_state !== "missing" ||
        control.coverage !== "source_and_unit_only" ||
        !Array.isArray(control.source_refs) || control.source_refs.length === 0 ||
        control.source_refs.some((reference) => !reference.startsWith("src/wikidot/")) ||
        !Array.isArray(control.test_witnesses) || control.test_witnesses.length === 0 ||
        control.test_witnesses.some((reference) => !reference.startsWith("tests/unit/test_amc_client.py#")))) {
    throw new Error("AMC transport missing live control coverage is incomplete or duplicated")
  }
  const bindings = contract.evidence?.record_bindings
  const bindingIds = Array.isArray(bindings) ? bindings.map(({ record_id: recordId }) => recordId) : []
  if (bindingIds.length !== expectedIds.size || new Set(bindingIds).size !== bindingIds.length ||
      bindingIds.some((id) => !expectedIds.has(id)) || [...expectedIds].some((id) => !bindingIds.includes(id))) {
    throw new Error("AMC transport record evidence binding coverage is not a bijection")
  }
  for (const binding of bindings) {
    const shouldBeLive = expectedLiveRecordIds.has(binding.record_id)
    if (binding.authority !== (shouldBeLive ? "live_current" : "source_and_unit_only")) {
      throw new Error(`AMC transport record evidence binding is misclassified: ${binding.record_id}`)
    }
    if (shouldBeLive) {
      if (!Array.isArray(binding.observation_ids) || binding.observation_ids.length === 0 ||
          new Set(binding.observation_ids).size !== binding.observation_ids.length ||
          binding.observation_ids.some((id) => !expectedObservationIds.has(id)) ||
          "missing_control_ids" in binding) {
        throw new Error(`AMC transport live-current record binding is invalid: ${binding.record_id}`)
      }
    } else if (!Array.isArray(binding.missing_control_ids) || binding.missing_control_ids.length === 0 ||
        new Set(binding.missing_control_ids).size !== binding.missing_control_ids.length ||
        binding.missing_control_ids.some((id) => !expectedMissingControlIds.has(id)) ||
        typeof binding.reason !== "string" || binding.reason.length === 0 ||
        "observation_ids" in binding) {
      throw new Error(`AMC transport source-and-unit-only record binding is invalid: ${binding.record_id}`)
    }
  }
  if (sha256(evidenceBytes) !== expectedCurrentWitness.sha256) throw new Error("AMC transport current authenticated witness bytes drift")
  if (sha256(JSON.stringify(contract)) !== expectedContractSha256) throw new Error("AMC transport contract drift")
  process.stdout.write(`verified ${contract.records.length} AMC transport records with ${expectedLiveRecordIds.size} live-current and ${expectedIds.size - expectedLiveRecordIds.size} source-and-unit-only bindings at ${expectedSource.commit}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
