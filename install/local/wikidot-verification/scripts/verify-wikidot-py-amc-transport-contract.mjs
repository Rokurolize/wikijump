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
const expectedControlledLocalWitness = {
  path: "install/local/wikidot-verification/artifacts/issue1374-amc-local-controls-20260815.json",
  sha256: "b00acdb25722d164f125ba9146bf652875764f8055f925803637d8263627475d",
  classification: "controlled_local_fixture",
  source_commit: expectedSource.commit,
  source_root_tree: expectedSource.root_tree,
  test_path: "install/local/wikidot-verification/tests/test_wikidot_py_amc_local_controls.py",
  test_sha256: "5ba693b4a4a547928c8703168f00a2017b6f0ad031bd4d1906fb376369065e47"
}
const expectedLock = {
  git_oid: "30a21e269683d755c5715cc937e332c8442143aa",
  sha256: "8644ed6c80c8f658549f8eae20c20cbb6ab5873c34c72b61da4fecac294b8def"
}
const expectedWrapper = {
  sha256: "ed912a115469573bbcc9c071be42b97455331d085f84ab1404cd1a75b9ff5a15"
}
const expectedControlledLocalSource = {
  repository: expectedSource.repository,
  commit: expectedSource.commit,
  root_tree: expectedSource.root_tree,
  version: "4.4.1",
  objects: expectedSource.objects,
  lock_sha256: expectedLock.sha256
}
const expectedControlledLocalFixture = {
  transport: "http",
  bind: "127.0.0.1",
  endpoint_path: "/ajax-module-connector.php",
  public_connector: "AjaxModuleConnectorClient.request",
  attempt_limit: 2,
  post_count_total: 12,
  get_count: 0,
  redirects_followed: false,
  external_requests: 0,
  persistent_state: false,
  request_bodies_recorded: false,
  response_bodies_recorded: false,
  cookie_values_recorded: false,
  credential_values_recorded: false
}
const expectedControlledLocalObservations = [
  { id: "amc-post-redirect", http_status: 302, post_count: 1, exception: "WikidotTransportSecurityException" },
  { id: "malformed-json-response", http_status: 200, post_count: 2, exception: "ResponseDataException" },
  { id: "empty-json-object-response", http_status: 200, post_count: 2, exception: "ResponseDataException" },
  { id: "missing-status-response", http_status: 200, post_count: 2, exception: "ResponseDataException" },
  { id: "missing-status-side-effect-response", http_status: 200, post_count: 1, exception: "ResponseDataException", replayed: false },
  { id: "non-string-status-response", http_status: 200, post_count: 2, exception: "ResponseDataException" },
  { id: "try-again-response", http_status: 200, post_count: 2, exception: "WikidotStatusCodeException", exception_status: "try_again" }
]
const expectedControlledLocalObservationIds = new Set(expectedControlledLocalObservations.map(({ id }) => id))
const expectedControlledLocalRecordIds = new Set([
  "amc-redirect", "invalid-json-retry", "empty-object-retry", "missing-status", "non-string-status", "try-again-status"
])
const expectedBindingCounts = {
  live_current: 4,
  controlled_local_fixture: 6,
  source_and_unit_only: 9
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
const expectedContractSha256 = "f6d6b22de6b69f689e746b198680a5d1ca547d69ac32bb61ccab7092c98a0bdd"

function parseArgs(argv) {
  let contract = path.join(repositoryRoot, "docs/development/wikidot-py-amc-transport-contract.json")
  let sourceRoot = process.env.WIKIDOT_PY_CHECKOUT ?? path.resolve(repositoryRoot, "../wikidot.py")
  let evidenceRoot = repositoryRoot
  let wrapper = process.env.WIKIDOT_PY_WRAPPER ?? path.join(repositoryRoot, "install/local/wikidot-verification/fixtures/wikidot-python-wrapper.sh")
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

function containsAbsolutePath(value) {
  if (Array.isArray(value)) return value.some(containsAbsolutePath)
  if (value === null || typeof value !== "object") return false
  return Object.entries(value).some(([key, nested]) =>
    ((key === "path" || key === "test_path") && typeof nested === "string" && path.isAbsolute(nested)) ||
    containsAbsolutePath(nested))
}

function hasRecordedPathSuffix(value, suffix) {
  return typeof value === "string" && path.isAbsolute(value) && value.endsWith(suffix)
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
      !contract.evidence_boundary?.gaps?.includes("Current authenticated coverage must not be widened beyond a live_current record binding.") ||
      !contract.evidence_boundary?.gaps?.includes("Controlled-local fixture observations exercise transport branches only and do not widen live Wikidot evidence.")) {
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
      evidence.source?.lock?.git_oid !== expectedLock.git_oid ||
      evidence.source?.lock?.sha256 !== expectedLock.sha256 ||
      !hasRecordedPathSuffix(evidence.source?.lock?.path, path.join("wikidot.py", "uv.lock")) ||
      evidence.source?.wrapper?.sha256 !== expectedWrapper.sha256 ||
      !hasRecordedPathSuffix(evidence.source?.wrapper?.path, path.join(".codex", "skills", "wikidot-py-operations", "scripts", "wikidot-python"))) {
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
  const controlledLocalWitness = contract.evidence?.controlled_local_witness
  if (JSON.stringify(controlledLocalWitness) !== JSON.stringify(expectedControlledLocalWitness) ||
      path.isAbsolute(controlledLocalWitness?.path) || path.isAbsolute(controlledLocalWitness?.test_path)) {
    throw new Error("AMC transport controlled-local witness identity drift")
  }
  const controlledLocalEvidenceBytes = await fs.readFile(path.join(evidenceRoot, expectedControlledLocalWitness.path))
  const controlledLocalEvidence = JSON.parse(controlledLocalEvidenceBytes)
  const expectedControlledLocalTest = {
    path: expectedControlledLocalWitness.test_path,
    sha256: expectedControlledLocalWitness.test_sha256
  }
  if (controlledLocalEvidence.schema !== "wikijump.issue1374.amc_local_controls.v1" ||
      controlledLocalEvidence.issue !== 1374 ||
      controlledLocalEvidence.classification !== expectedControlledLocalWitness.classification ||
      JSON.stringify(controlledLocalEvidence.source_identity) !== JSON.stringify(expectedControlledLocalSource) ||
      JSON.stringify(controlledLocalEvidence.fixture) !== JSON.stringify(expectedControlledLocalFixture) ||
      JSON.stringify(controlledLocalEvidence.test) !== JSON.stringify(expectedControlledLocalTest) ||
      JSON.stringify(controlledLocalEvidence.cleanup) !== JSON.stringify({
        server_stopped: true,
        thread_joined: true,
        temporary_paths_retained: []
      }) ||
      JSON.stringify(controlledLocalEvidence.redactions) !== JSON.stringify([
        "credentials",
        "cookies",
        "session identifiers",
        "CSRF tokens",
        "wikidot_token7 value",
        "request body values",
        "response body bytes"
      ]) || containsSecretKey(controlledLocalEvidence) || containsAbsolutePath(controlledLocalEvidence)) {
    throw new Error("AMC transport controlled-local evidence redaction or identity drift")
  }
  const controlledLocalObservationIds = Array.isArray(controlledLocalEvidence.observations)
    ? controlledLocalEvidence.observations.map(({ id }) => id)
    : []
  if (controlledLocalObservationIds.length !== expectedControlledLocalObservationIds.size ||
      new Set(controlledLocalObservationIds).size !== controlledLocalObservationIds.length ||
      controlledLocalObservationIds.some((id) => !expectedControlledLocalObservationIds.has(id)) ||
      [...expectedControlledLocalObservationIds].some((id) => !controlledLocalObservationIds.includes(id)) ||
      JSON.stringify(controlledLocalEvidence.observations) !== JSON.stringify(expectedControlledLocalObservations)) {
    throw new Error("AMC transport controlled-local observation coverage is incomplete or duplicated")
  }
  const controlledLocalTestBytes = await fs.readFile(path.join(repositoryRoot, expectedControlledLocalWitness.test_path))
  if (sha256(controlledLocalEvidenceBytes) !== expectedControlledLocalWitness.sha256 ||
      sha256(controlledLocalTestBytes) !== expectedControlledLocalWitness.test_sha256) {
    throw new Error("AMC transport controlled-local evidence bytes drift")
  }
  if (JSON.stringify(contract.evidence?.binding_counts) !== JSON.stringify(expectedBindingCounts) ||
      contract.evidence?.controlled_local_observation_count !== expectedControlledLocalObservationIds.size) {
    throw new Error("AMC transport evidence binding counts are stale")
  }
  const bindings = contract.evidence?.record_bindings
  const bindingIds = Array.isArray(bindings) ? bindings.map(({ record_id: recordId }) => recordId) : []
  if (bindingIds.length !== expectedIds.size || new Set(bindingIds).size !== bindingIds.length ||
      bindingIds.some((id) => !expectedIds.has(id)) || [...expectedIds].some((id) => !bindingIds.includes(id))) {
    throw new Error("AMC transport record evidence binding coverage is not a bijection")
  }
  const actualBindingCounts = {
    live_current: 0,
    controlled_local_fixture: 0,
    source_and_unit_only: 0
  }
  const boundControlledLocalObservationIds = []
  for (const binding of bindings) {
    const shouldBeLive = expectedLiveRecordIds.has(binding.record_id)
    const shouldBeControlledLocal = expectedControlledLocalRecordIds.has(binding.record_id)
    const expectedAuthority = shouldBeLive
      ? "live_current"
      : shouldBeControlledLocal ? "controlled_local_fixture" : "source_and_unit_only"
    if (binding.authority !== expectedAuthority) {
      throw new Error(`AMC transport record evidence binding is misclassified: ${binding.record_id}`)
    }
    actualBindingCounts[binding.authority] += 1
    if (shouldBeLive) {
      if (!Array.isArray(binding.observation_ids) || binding.observation_ids.length === 0 ||
          new Set(binding.observation_ids).size !== binding.observation_ids.length ||
          binding.observation_ids.some((id) => !expectedObservationIds.has(id)) ||
          "missing_control_ids" in binding) {
        throw new Error(`AMC transport live-current record binding is invalid: ${binding.record_id}`)
      }
    } else if (shouldBeControlledLocal) {
      if (!Array.isArray(binding.observation_ids) || binding.observation_ids.length === 0 ||
          new Set(binding.observation_ids).size !== binding.observation_ids.length ||
          binding.observation_ids.some((id) => !expectedControlledLocalObservationIds.has(id)) ||
          "missing_control_ids" in binding || "reason" in binding) {
        throw new Error(`AMC transport controlled-local record binding is invalid: ${binding.record_id}`)
      }
      boundControlledLocalObservationIds.push(...binding.observation_ids)
    } else if (!Array.isArray(binding.missing_control_ids) || binding.missing_control_ids.length === 0 ||
        new Set(binding.missing_control_ids).size !== binding.missing_control_ids.length ||
        binding.missing_control_ids.some((id) => !expectedMissingControlIds.has(id)) ||
        typeof binding.reason !== "string" || binding.reason.length === 0 ||
        "observation_ids" in binding) {
      throw new Error(`AMC transport source-and-unit-only record binding is invalid: ${binding.record_id}`)
    }
  }
  if (JSON.stringify(actualBindingCounts) !== JSON.stringify(expectedBindingCounts) ||
      boundControlledLocalObservationIds.length !== expectedControlledLocalObservationIds.size ||
      new Set(boundControlledLocalObservationIds).size !== boundControlledLocalObservationIds.length ||
      boundControlledLocalObservationIds.some((id) => !expectedControlledLocalObservationIds.has(id)) ||
      [...expectedControlledLocalObservationIds].some((id) => !boundControlledLocalObservationIds.includes(id))) {
    throw new Error("AMC transport controlled-local binding coverage is incomplete or duplicated")
  }
  if (sha256(evidenceBytes) !== expectedCurrentWitness.sha256) throw new Error("AMC transport current authenticated witness bytes drift")
  if (sha256(JSON.stringify(contract)) !== expectedContractSha256) throw new Error("AMC transport contract drift")
  process.stdout.write(`verified ${contract.records.length} AMC transport records with ${expectedBindingCounts.live_current} live-current, ${expectedBindingCounts.controlled_local_fixture} controlled-local, and ${expectedBindingCounts.source_and_unit_only} source-and-unit-only bindings at ${expectedSource.commit}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
