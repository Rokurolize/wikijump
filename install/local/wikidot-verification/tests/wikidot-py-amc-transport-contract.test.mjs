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
const evidencePath = path.join(root, "install/local/wikidot-verification/artifacts/wikidot-py-amc-authenticated-live-20260815.json")
const localControlsEvidencePath = path.join(root, "install/local/wikidot-verification/artifacts/issue1374-amc-local-controls-20260815.json")
const localControlsTestPath = path.join(root, "install/local/wikidot-verification/tests/test_wikidot_py_amc_local_controls.py")
const sourceRoot = process.env.WIKIDOT_PY_CHECKOUT ?? path.resolve(root, "../wikidot.py")
const wrapperPath = process.env.WIKIDOT_PY_WRAPPER ?? path.join(os.homedir(), ".codex/skills/wikidot-py-operations/scripts/wikidot-python")
const gitEnvironment = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin"
}

const run = (contract = contractPath, source = sourceRoot, env = process.env, evidenceRoot = root) => spawnSync(process.execPath, [
  cli, "--contract", contract, "--source-root", source, "--evidence-root", evidenceRoot
], { encoding: "utf8", env })
const git = (directory, ...arguments_) => spawnSync("/usr/bin/git", ["-C", directory, ...arguments_], {
  encoding: "utf8",
  env: gitEnvironment
})

async function copySourceFiles(directory) {
  for (const relativePath of [
    "uv.lock",
    "src/wikidot/connector/ajax.py",
    "src/wikidot/common/exceptions.py",
    "tests/unit/test_amc_client.py"
  ]) {
    const target = path.join(directory, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(sourceRoot, relativePath), target)
  }
}

async function copyEvidenceFiles(directory) {
  for (const relativePath of [
    path.relative(root, evidencePath),
    path.relative(root, localControlsEvidencePath)
  ]) {
    const target = path.join(directory, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(root, relativePath), target)
  }
}

test("AMC transport contract is complete and bound to the supported wikidot.py source", () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /verified 19 AMC transport records with 4 live-current, 6 controlled-local, and 9 source-and-unit-only bindings/u)
})

test("AMC verifier invokes the controlled-local Python regression through the pinned wrapper", () => {
  const result = spawnSync(wrapperPath, [localControlsTestPath], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      WIKIDOT_PY_REPO: sourceRoot
    }
  })
  assert.equal(result.status, 0, result.stderr)
})

test("AMC transport verifier ignores inherited Git routing and config poison", () => {
  const result = run(contractPath, sourceRoot, {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/missing/global-config",
    GIT_CONFIG_SYSTEM: "/missing/system-config",
    GIT_DIR: "/missing/git-dir",
    GIT_OBJECT_DIRECTORY: "/missing/object-directory",
    GIT_REPLACE_REF_BASE: "refs/poisoned-replacements",
    GIT_WORK_TREE: "/missing/work-tree",
    PATH: "/missing/bin"
  })
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

test("AMC transport verifier rejects omitted and duplicate authenticated observations", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-evidence-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const original = JSON.parse(await fs.readFile(evidencePath, "utf8"))
  const relativeEvidencePath = path.relative(root, evidencePath)
  const mutations = [
    (evidence) => evidence.observations.pop(),
    (evidence) => evidence.observations.push(structuredClone(evidence.observations[0]))
  ]

  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(original)
    mutate(changed)
    const evidenceRoot = path.join(directory, `${index}`)
    const changedPath = path.join(evidenceRoot, relativeEvidencePath)
    await fs.mkdir(path.dirname(changedPath), { recursive: true })
    await fs.writeFile(changedPath, `${JSON.stringify(changed, null, 2)}\n`)
    const result = run(contractPath, sourceRoot, process.env, evidenceRoot)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /authenticated observation coverage/u)
  }
})

test("AMC transport verifier rejects omitted and duplicate missing live controls", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-missing-controls-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const original = JSON.parse(await fs.readFile(evidencePath, "utf8"))
  const relativeEvidencePath = path.relative(root, evidencePath)
  const mutations = [
    (evidence) => evidence.missing_controls.pop(),
    (evidence) => evidence.missing_controls.push(structuredClone(evidence.missing_controls[0]))
  ]

  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(original)
    mutate(changed)
    const evidenceRoot = path.join(directory, `${index}`)
    const changedPath = path.join(evidenceRoot, relativeEvidencePath)
    await fs.mkdir(path.dirname(changedPath), { recursive: true })
    await fs.writeFile(changedPath, `${JSON.stringify(changed, null, 2)}\n`)
    const result = run(contractPath, sourceRoot, process.env, evidenceRoot)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /missing live control coverage/u)
  }
})

test("AMC transport verifier rejects omitted and duplicate controlled-local observations", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-controlled-local-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const original = JSON.parse(await fs.readFile(localControlsEvidencePath, "utf8"))
  const relativeEvidencePath = path.relative(root, localControlsEvidencePath)
  const mutations = [
    (evidence) => evidence.observations.pop(),
    (evidence) => evidence.observations.push(structuredClone(evidence.observations[0]))
  ]

  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(original)
    mutate(changed)
    const evidenceRoot = path.join(directory, `${index}`)
    await copyEvidenceFiles(evidenceRoot)
    const changedPath = path.join(evidenceRoot, relativeEvidencePath)
    await fs.writeFile(changedPath, `${JSON.stringify(changed, null, 2)}\n`)
    const result = run(contractPath, sourceRoot, process.env, evidenceRoot)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /controlled-local observation coverage/u)
  }
})

test("AMC transport verifier rejects current witness omission and historical masquerade", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-witness-class-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const original = JSON.parse(await fs.readFile(contractPath, "utf8"))
  const mutations = [
    (contract) => { contract.evidence.current_witness = null },
    (contract) => { contract.evidence.current_witness.classification = "historical" },
    (contract) => {
      contract.evidence.historical_witnesses.push({
        ...structuredClone(contract.evidence.current_witness),
        classification: "historical"
      })
    }
  ]

  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(original)
    mutate(changed)
    const changedPath = path.join(directory, `${index}.json`)
    await fs.writeFile(changedPath, `${JSON.stringify(changed, null, 2)}\n`)
    const result = run(changedPath)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /current and historical witness classification/u)
  }
})

test("AMC transport verifier rejects omitted, duplicate, unknown, and misclassified record bindings", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-record-bindings-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const original = JSON.parse(await fs.readFile(contractPath, "utf8"))
  const mutations = [
    {
      mutate: (contract) => contract.evidence.record_bindings.pop(),
      error: /binding coverage is not a bijection/u
    },
    {
      mutate: (contract) => contract.evidence.record_bindings.push(structuredClone(contract.evidence.record_bindings[0])),
      error: /binding coverage is not a bijection/u
    },
    {
      mutate: (contract) => { contract.evidence.record_bindings[0].record_id = "unknown-record" },
      error: /binding coverage is not a bijection/u
    },
    {
      mutate: (contract) => {
        const binding = contract.evidence.record_bindings.find(({ record_id: recordId }) => recordId === "http-session-proxy-isolation")
        binding.authority = "live_current"
        binding.observation_ids = ["sandbox-success-envelope"]
        delete binding.missing_control_ids
        delete binding.reason
      },
      error: /binding is misclassified/u
    },
    {
      mutate: (contract) => {
        const binding = contract.evidence.record_bindings.find(({ record_id: recordId }) => recordId === "form-envelope")
        binding.observation_ids = ["unknown-observation"]
      },
      error: /live-current record binding is invalid/u
    },
    {
      mutate: (contract) => {
        const binding = contract.evidence.record_bindings.find(({ record_id: recordId }) => recordId === "cookie-envelope")
        binding.missing_control_ids = ["unknown-missing-control"]
      },
      error: /source-and-unit-only record binding is invalid/u
    },
    {
      mutate: (contract) => {
        const binding = contract.evidence.record_bindings.find(({ record_id: recordId }) => recordId === "form-envelope")
        binding.missing_control_ids = ["cookie-envelope-validation"]
      },
      error: /live-current record binding is invalid/u
    }
  ]

  for (const [index, { mutate, error }] of mutations.entries()) {
    const changed = structuredClone(original)
    mutate(changed)
    const changedPath = path.join(directory, `${index}.json`)
    await fs.writeFile(changedPath, `${JSON.stringify(changed, null, 2)}\n`)
    const result = run(changedPath)
    assert.equal(result.status, 1)
    assert.match(result.stderr, error)
  }
})

test("AMC transport verifier rejects secret values, hashes, and recorded-secret claims", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-secret-evidence-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const original = JSON.parse(await fs.readFile(evidencePath, "utf8"))
  const relativeEvidencePath = path.relative(root, evidencePath)
  const mutations = [
    (evidence) => { evidence.authority.username = "must-not-be-recorded" },
    (evidence) => { evidence.secrets.session_cookie_hash_recorded = true },
    (evidence) => { evidence.secrets.token_value = "must-not-be-recorded" }
  ]

  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(original)
    mutate(changed)
    const evidenceRoot = path.join(directory, `${index}`)
    const changedPath = path.join(evidenceRoot, relativeEvidencePath)
    await fs.mkdir(path.dirname(changedPath), { recursive: true })
    await fs.writeFile(changedPath, `${JSON.stringify(changed, null, 2)}\n`)
    const result = run(contractPath, sourceRoot, process.env, evidenceRoot)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /secret redaction/u)
  }
})

test("AMC transport verifier rejects source drift", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-source-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await copySourceFiles(directory)
  await fs.appendFile(path.join(directory, "src/wikidot/connector/ajax.py"), "\n# drift\n")

  const result = run(contractPath, directory)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /source drift/u)
})

test("AMC transport verifier rejects working lock drift", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-lock-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const clone = path.join(directory, "source")
  const cloned = spawnSync("/usr/bin/git", ["clone", "--quiet", sourceRoot, clone], {
    encoding: "utf8",
    env: gitEnvironment
  })
  assert.equal(cloned.status, 0, cloned.stderr)
  await fs.appendFile(path.join(clone, "uv.lock"), "\n# drift\n")

  const result = run(contractPath, clone)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /source lock drift/u)
})

test("AMC transport verifier rejects execution wrapper drift", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-wrapper-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const wrapper = path.join(directory, "wikidot-python")
  await fs.copyFile(wrapperPath, wrapper)
  await fs.appendFile(wrapper, "\n# drift\n")

  const result = spawnSync(process.execPath, [
    cli,
    "--contract", contractPath,
    "--source-root", sourceRoot,
    "--evidence-root", root,
    "--wrapper", wrapper
  ], { encoding: "utf8", env: process.env })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /execution wrapper drift/u)
})

test("AMC transport verifier rejects exact bytes committed under an invented Git identity", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wikidot-py-amc-invented-source-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await copySourceFiles(directory)
  assert.equal(git(directory, "init", "--quiet").status, 0)
  assert.equal(git(directory, "add", ".").status, 0)
  assert.equal(git(directory, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "invented").status, 0)

  const result = run(contractPath, directory)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /source Git identity drift/u)
})
