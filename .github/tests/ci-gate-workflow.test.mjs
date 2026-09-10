import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { classifyChanges, GROUPS } from "../scripts/classify-changes.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (file) => readFileSync(path.join(root, file), "utf8")
const workflow = (name) => read(`.github/workflows/${name}`)
const triggerBlock = (source) =>
  source.slice(source.indexOf("on:\n"), source.indexOf("\npermissions:"))

const validationWorkflows = [
  "ci-gate.yaml",
  "codex-cloud.yaml",
  "full-ci.yaml",
  "wikidot-verification.yaml"
]

const forbiddenCiCommands = [
  /node\s+--test/u,
  /(?:pnpm|npm|yarn)\s+[^\n]*\btest(?::[\w-]+)?\b/u,
  /\bcargo\s+test\b/u,
  /\bcargo\s+clippy\b/u,
  /\bcargo\s+fmt\b/u,
  /\bpytest\b/u,
  /\bplaywright\b[^\n]*(?:test|install)/u,
  /\bactionlint\b/u,
  /(?:pnpm|npm|yarn)\s+[^\n]*\binstall\b/u,
  /\bdocker\s+build\b/u,
  /\bpnpm\s+[^\n]*\blint\b/u
]

test("central CI publishes only a no-op gate", () => {
  const source = workflow("ci-gate.yaml")
  const trigger = triggerBlock(source)

  assert.match(trigger, /^\s*pull_request:$/mu)
  assert.match(trigger, /^\s*merge_group:\s*$/mu)
  assert.match(trigger, /^\s*push:$/mu)
  assert.match(trigger, /^\s*workflow_dispatch:\s*$/mu)
  assert.match(source, /^permissions: \{\}$/mu)
  assert.match(source, /^  gate:$/mu)
  assert.match(source, /^    name: CI \/ gate$/mu)
  assert.match(source, /Local-validation-only policy/u)
  assert.match(source, /GitHub CI intentionally runs no tests/u)
  assert.doesNotMatch(source, /^  (?:classify|workflow_policy|deepwell|wws|framerail|locales|verification):$/mu)
  assert.doesNotMatch(source, /^\s*uses:/mu)
})

test("Browser CI is manual-only and runs no browser validation", () => {
  const source = workflow("full-ci.yaml")
  const trigger = triggerBlock(source)

  assert.match(trigger, /^\s*workflow_dispatch:\s*$/mu)
  assert.doesNotMatch(trigger, /pull_request:|push:|merge_group:/u)
  assert.match(source, /Browser tests are intentionally disabled in GitHub Actions/u)
  assert.doesNotMatch(source, /^\s*uses:/mu)
})

test("Wikidot verification is manual-only and runs no verification", () => {
  const source = workflow("wikidot-verification.yaml")
  const trigger = triggerBlock(source)

  assert.match(trigger, /^\s*workflow_dispatch:\s*$/mu)
  assert.doesNotMatch(trigger, /pull_request:|push:|merge_group:/u)
  assert.match(source, /persistent identity-bound response cache/u)
  assert.match(source, /cache hit must perform zero external requests/u)
  assert.doesNotMatch(source, /^\s*uses:/mu)
})

test("Codex Cloud validation publishes no CI-side tests or lint", () => {
  const source = workflow("codex-cloud.yaml")

  assert.match(source, /Codex Cloud script validation is intentionally disabled in GitHub Actions/u)
  assert.match(source, /Run Bash syntax, ShellCheck, and regression tests in the maintained local workspace/u)
  assert.doesNotMatch(source, /^\s*uses:/mu)
})

test("GitHub validation workflows execute no tests, installs, lint, builds, or compatibility acquisition", () => {
  for (const name of validationWorkflows) {
    const source = workflow(name)
    for (const pattern of forbiddenCiCommands) {
      assert.doesNotMatch(source, pattern, `${name}: ${pattern}`)
    }
    assert.doesNotMatch(
      source,
      /(?:candidate-cases|live-reference|sandbox-oracle|WIKIDOT_USERNAME|WIKIDOT_PASSWORD|wikidot\.com|wdfiles)/iu,
      `${name}: external compatibility acquisition`
    )
  }
})

test("local classifier still selects complete component validation", () => {
  assert.equal(classifyChanges(["deepwell/Cargo.lock"]).deepwell, true)
  assert.equal(classifyChanges(["wws/Cargo.lock"]).wws, true)
  assert.equal(classifyChanges(["locales/validator/Cargo.lock"]).locales, true)
  assert.equal(classifyChanges(["framerail/pnpm-lock.yaml"]).framerail, true)
  assert.equal(classifyChanges(["install/prod/deepwell/config.toml"]).deepwell, true)

  const toolchain = classifyChanges(["rust-toolchain.toml"])
  assert.equal(toolchain.deepwell, true)
  assert.equal(toolchain.wws, true)
  assert.equal(toolchain.locales, true)
})

test("local classifier keeps workflow and verification ownership", () => {
  for (const file of [
    ".github/workflows/ci-gate.yaml",
    ".github/scripts/classify-changes.mjs",
    ".github/tests/ci-gate-workflow.test.mjs"
  ]) {
    const selected = classifyChanges([file])
    assert.equal(selected.workflow, true, `${file}: workflow`)
  }

  const browser = classifyChanges([".github/workflows/full-ci.yaml"])
  assert.equal(browser.workflow, true)
  assert.equal(browser.framerail, true)

  const verification = classifyChanges([".github/workflows/wikidot-verification.yaml"])
  assert.equal(verification.workflow, true)
  assert.equal(verification.verification, true)

  const manual = classifyChanges([], true)
  for (const group of GROUPS) assert.equal(manual[group], true, group)
  assert.equal(manual.verification, true, "verification")
})

test("documentation stays cheap and unknown local-preflight paths fail closed", () => {
  const docs = classifyChanges(["README.md", "AGENTS.md", "docs/development.md"])
  for (const group of GROUPS) assert.equal(docs[group], false, group)

  for (const file of [
    "new-service/config.toml",
    "unexpected-root.json",
    "install/new-tier/config.toml",
    "scripts/data/wikidot-unknown-output.json"
  ]) {
    const selected = classifyChanges([file])
    for (const group of GROUPS) assert.equal(selected[group], true, `${file}: ${group}`)
    assert.equal(selected.verification, true, `${file}: verification`)
  }
})

test("verification inputs remain selected by the local preflight classifier", () => {
  for (const file of [
    "install/local/wikidot-verification/artifacts/example.json",
    "install/local/wikidot-verification/src/generic-runtime-differential.mjs",
    "install/local/wikidot-verification/tests/generic-runtime-differential.test.mjs",
    "install/standing/tests/verify-promotion-precondition.test.mjs",
    "scripts/data/wikidot-implementation-ledger.json",
    "scripts/data/wikidot-live-observations.json",
    "scripts/generate-wikidot-specifications.mjs",
    "docs/wikidot-specifications/catalog.json"
  ]) {
    const selected = classifyChanges([file])
    for (const group of GROUPS) assert.equal(selected[group], false, `${file}: ${group}`)
    assert.equal(selected.verification, true, `${file}: verification`)
  }
})

test("Framerail unit and browser scripts remain available for local validation", () => {
  const pkg = JSON.parse(read("framerail/package.json"))
  const playwright = read("framerail/playwright.config.ts")

  assert.match(pkg.scripts["test:unit"], /run-test-no-external-network\.sh/u)
  assert.match(pkg.scripts["test:unit"], /svelte-kit sync && node --test/u)
  assert.doesNotMatch(pkg.scripts["test:unit"], /\.spec\.(?:js|ts)/u)
  assert.equal(pkg.scripts.test, "../scripts/run-test-no-external-network.sh node tests/playwright-runner.js")
  assert.doesNotMatch(pkg.scripts.test, /test:unit/u)
  assert.doesNotMatch(playwright, /\.test\.(?:js|ts)/u)
})

test("external actions in every remaining workflow are immutable pins", () => {
  const workflowRoot = path.join(root, ".github/workflows")
  for (const name of readdirSync(workflowRoot).filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))) {
    const source = read(`.github/workflows/${name}`)
    for (const [, action] of source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#\s*\S+)?$/gmu)) {
      if (action.startsWith("./")) continue
      assert.match(action, /^[^@]+@[0-9a-f]{40}$/u, `${name}: ${action}`)
    }
  }
})

test("validation workflows contain no Wikidot or WDFiles origin literals", () => {
  for (const name of validationWorkflows) {
    assert.doesNotMatch(workflow(name), /(?:wikidot\.com|wdfiles)/iu, name)
  }
})
