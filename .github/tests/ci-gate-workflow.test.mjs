import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { classifyChanges, GROUPS } from "../scripts/classify-changes.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (file) => readFileSync(path.join(root, file), "utf8")
const workflow = (name) => read(`.github/workflows/${name}`)
const hasYamlLine = (source, expected) => source.split("\n").some((line) => line.trim() === expected)

const jobBlock = (source, jobName) => {
  const lines = source.split("\n")
  const start = lines.findIndex((line) => line === `  ${jobName}:`)
  assert.notEqual(start, -1, `missing job ${jobName}`)
  const next = lines.findIndex(
    (line, index) => index > start && /^  [A-Za-z0-9_]+:$/u.test(line)
  )
  return lines.slice(start, next === -1 ? lines.length : next)
}

const yamlScalar = (lines, indentation, key) => {
  const prefix = `${" ".repeat(indentation)}${key}: `
  const line = lines.find((candidate) => candidate.startsWith(prefix))
  assert.ok(line, `missing ${key} at indentation ${indentation}`)
  return line.slice(prefix.length)
}

const stepBlock = (job, stepName) => {
  const start = job.findIndex((line) => line === `      - name: ${stepName}`)
  assert.notEqual(start, -1, `missing step ${stepName}`)
  const next = job.findIndex(
    (line, index) => index > start && line.startsWith("      - name: ")
  )
  return job.slice(start, next === -1 ? job.length : next)
}

const metadataOnlyEdit = ({ eventName = "pull_request", action, baseChanged = false }) =>
  eventName === "pull_request" && action === "edited" && !baseChanged

const gateCheckName = (event) =>
  metadataOnlyEdit(event) ? "CI / metadata edit" : "CI / gate"

const gateRunsValidation = (event) => !metadataOnlyEdit(event)

test("one central workflow owns the aggregate check without reacting to labels", () => {
  const source = workflow("ci-gate.yaml")
  const trigger = source.slice(source.indexOf("on:\n"), source.indexOf("\npermissions:\n"))

  assert.match(trigger, /^\s*pull_request:$/m)
  assert.doesNotMatch(trigger, /^\s*paths(?:-ignore)?:$/m)
  for (const action of ["opened", "synchronize", "reopened", "edited", "ready_for_review", "converted_to_draft"]) {
    assert.ok(hasYamlLine(trigger, `- ${action}`), action)
  }
  assert.match(trigger, /^\s*merge_group:\s*$/m)
  assert.doesNotMatch(trigger, /^      - (?:labeled|unlabeled)$/m)
  assert.doesNotMatch(source, /landing|full-ci/)
  assert.match(source, /^permissions:\n  contents: read$/m)
  assert.doesNotMatch(source, /id-token:/)
})

test("base edits rerun central CI while metadata edits stay isolated", () => {
  const source = workflow("ci-gate.yaml")
  const concurrency = source.slice(source.indexOf("concurrency:\n"), source.indexOf("\njobs:\n"))
  const classify = source.slice(source.indexOf("  classify:\n"), source.indexOf("  workflow_policy:\n"))
  const gate = jobBlock(source, "gate")

  for (const section of [concurrency, classify, gate.join("\n")]) {
    assert.match(section, /github\.event\.action != 'edited' \|\| github\.event\.changes\.base != null/)
  }
  assert.match(concurrency, /format\('ci-pr-\{0\}', github\.event\.pull_request\.number\)/)
  assert.match(concurrency, /format\('ci-run-\{0\}', github\.run_id\)/)
  assert.match(concurrency, /cancel-in-progress:/)
  assert.equal(
    yamlScalar(gate, 4, "name"),
    "${{ github.event_name == 'pull_request' && github.event.action == 'edited' && github.event.changes.base == null && 'CI / metadata edit' || 'CI / gate' }}"
  )
  assert.doesNotMatch(gate.join("\n"), /CI \/ draft gate/)
})

test("metadata edits cannot replace the aggregate gate context", () => {
  const source = workflow("ci-gate.yaml")
  const gate = jobBlock(source, "gate")
  const metadataStep = stepBlock(gate, "Metadata edit no-op")
  const validationStep = stepBlock(gate, "Require every selected check")

  assert.equal(
    yamlScalar(gate, 4, "name"),
    "${{ github.event_name == 'pull_request' && github.event.action == 'edited' && github.event.changes.base == null && 'CI / metadata edit' || 'CI / gate' }}"
  )
  assert.equal(yamlScalar(gate, 4, "if"), "${{ always() }}")
  assert.equal(
    yamlScalar(metadataStep, 8, "if"),
    "${{ github.event_name == 'pull_request' && github.event.action == 'edited' && github.event.changes.base == null }}"
  )
  assert.equal(
    yamlScalar(validationStep, 8, "if"),
    "${{ github.event_name != 'pull_request' || github.event.action != 'edited' || github.event.changes.base != null }}"
  )

  const events = [
    { action: "opened" },
    { action: "synchronize" },
    { action: "reopened" },
    { action: "edited", baseChanged: true },
    { action: "edited", baseChanged: false }
  ]
  for (const event of events) {
    if (gateCheckName(event) === "CI / gate") {
      assert.equal(gateRunsValidation(event), true, JSON.stringify(event))
    } else {
      assert.equal(gateCheckName(event), "CI / metadata edit")
      assert.equal(gateRunsValidation(event), false, JSON.stringify(event))
    }
  }

  const headSha = "0123456789abcdef"
  const checkLedger = new Map([
    ["CI / gate", { headSha, conclusion: "failure" }]
  ])
  const recordGate = (event, conclusion) => {
    checkLedger.set(gateCheckName(event), { headSha, conclusion })
  }
  recordGate({ action: "edited" }, "success")
  assert.deepEqual(checkLedger.get("CI / gate"), { headSha, conclusion: "failure" })
  assert.deepEqual(checkLedger.get("CI / metadata edit"), {
    headSha,
    conclusion: "success"
  })
  recordGate({ action: "edited", baseChanged: true }, "success")
  assert.deepEqual(checkLedger.get("CI / gate"), { headSha, conclusion: "success" })
})

test("PR classification uses three-dot history while push classification uses two endpoints", () => {
  const source = workflow("ci-gate.yaml")
  const classify = source.slice(source.indexOf("      - name: Classify every changed path"), source.indexOf("\n  workflow_policy:"))

  assert.match(classify, /elif \[\[ "\$\{GITHUB_EVENT_NAME\}" == pull_request \]\]; then\n\s+git diff --no-renames --name-only -z "\$\{BASE_SHA\}\.\.\.\$\{HEAD_SHA\}"/)
  assert.match(classify, /else\n\s+git diff --no-renames --name-only -z "\$\{BASE_SHA\}" "\$\{HEAD_SHA\}"/)
  assert.match(source, /fetch-depth: 0/)
  assert.doesNotMatch(classify, /pulls\/.*files|github\.event\.pull_request\.changed_files/)
})

test("component and lockfile changes select complete validation", () => {
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

test("classifier and gate changes fail closed", () => {
  for (const file of [
    ".github/workflows/ci-gate.yaml",
    ".github/scripts/classify-changes.mjs",
    ".github/tests/ci-gate-workflow.test.mjs"
  ]) {
    const selected = classifyChanges([file])
    for (const group of GROUPS) assert.equal(selected[group], true, `${file}: ${group}`)
  }

  const manual = classifyChanges([], true)
  for (const group of GROUPS) assert.equal(manual[group], true, group)
})

test("Browser CI changes select Framerail and workflow policy", () => {
  const selected = classifyChanges([".github/workflows/full-ci.yaml"])
  for (const group of ["framerail", "workflow"]) assert.equal(selected[group], true, group)
  for (const group of ["deepwell", "wws", "locales"]) assert.equal(selected[group], false, group)
})

test("documentation is cheap and unknown paths fail closed", () => {
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
  }
})

test("Wikidot verification inputs select only the dedicated workflow", () => {
  for (const file of [
    "install/local/wikidot-verification/artifacts/example.json",
    "install/local/wikidot-verification/scripts/run-generic-runtime-differential.mjs",
    "install/local/wikidot-verification/src/generic-runtime-differential.mjs",
    "install/local/wikidot-verification/tests/generic-runtime-differential.test.mjs",
    "install/local/wikidot-verification/package.json",
    "scripts/data/wikidot-implementation-ledger.json",
    "scripts/data/wikidot-live-observations.json",
    "scripts/generate-wikidot-specifications.mjs",
    "scripts/initialize-wikidot-implementation-ledger.mjs",
    "scripts/lib/wikidot-implementation-ledger.mjs",
    "docs/wikidot-specifications/catalog.json"
  ]) {
    const selected = classifyChanges([file])
    for (const group of GROUPS) assert.equal(selected[group], false, `${file}: ${group}`)
  }

  const source = workflow("wikidot-verification.yaml")
  const trigger = source.slice(source.indexOf("on:\n"), source.indexOf("\npermissions:\n"))
  for (const pathFilter of [
    "'install/local/wikidot-verification/**'",
    "'install/standing/**'",
    "'scripts/data/wikidot-implementation-ledger.json'",
    "'scripts/data/wikidot-live-observations.json'",
    "'scripts/generate-wikidot-specifications.mjs'",
    "'scripts/initialize-wikidot-implementation-ledger.mjs'",
    "'scripts/lib/wikidot-implementation-ledger.mjs'",
    "'docs/wikidot-specifications/**'",
    "'.github/workflows/wikidot-verification.yaml'"
  ]) assert.ok(hasYamlLine(trigger, `- ${pathFilter}`), pathFilter)

  const concurrency = source.slice(source.indexOf("concurrency:\n"), source.indexOf("\njobs:\n"))
  assert.match(concurrency, /format\('wikidot-verification-pr-\{0\}', github\.event\.pull_request\.number\)/)
  assert.match(concurrency, /format\('wikidot-verification-run-\{0\}', github\.run_id\)/)
  assert.match(concurrency, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
})

test("Deepwell validation stays fast and service-free", () => {
  const source = workflow("ci-gate.yaml")
  const deepwell = source.slice(source.indexOf("  deepwell:\n"), source.indexOf("  wws:\n"))
  const gate = jobBlock(source, "gate")

  assert.match(deepwell, /needs\.classify\.outputs\.deepwell == 'true'/)
  assert.doesNotMatch(deepwell, /services:|DATABASE_URL|Start MinIO|sqlx|clippy|cargo test|target/)
  assert.match(deepwell, /timeout-minutes: 2/)
  for (const command of [
    "cargo machete deepwell",
    "cargo fmt --manifest-path deepwell/Cargo.toml --all -- --check"
  ]) assert.ok(deepwell.includes(command), command)
  assert.ok(hasYamlLine(gate.join("\n"), "- deepwell"))
  assert.equal(
    yamlScalar(gate, 4, "name"),
    "${{ github.event_name == 'pull_request' && github.event.action == 'edited' && github.event.changes.base == null && 'CI / metadata edit' || 'CI / gate' }}"
  )
  assert.doesNotMatch(gate.join("\n"), /CI \/ draft gate/)
  assert.doesNotMatch(source, /deepwell_(?:draft|candidate)|tarpaulin|coverage\/cobertura/)
})

test("draft CI stays lightweight while candidate CI adds compiled checks", () => {
  const source = workflow("ci-gate.yaml")
  const wws = jobBlock(source, "wws")
  const wwsDraft = stepBlock(wws, "Validate draft")
  const wwsCandidate = stepBlock(wws, "Validate candidate")
  const framerail = jobBlock(source, "framerail")
  const framerailDraft = stepBlock(framerail, "Validate draft")
  const framerailCandidate = stepBlock(framerail, "Build candidate")
  const locales = jobBlock(source, "locales")
  const localesDraft = stepBlock(locales, "Validate draft")
  const localesCandidate = stepBlock(locales, "Validate candidate")

  for (const command of ["cargo machete wws", "cargo fmt --all -- --check"]) {
    assert.ok(wwsDraft.join("\n").includes(command), command)
  }
  assert.doesNotMatch(wwsDraft.join("\n"), /cargo (?:clippy|test)|node --test/)
  assert.equal(
    yamlScalar(wwsCandidate, 8, "if"),
    "${{ needs.classify.outputs.candidate == 'true' }}"
  )
  for (const command of [
    "cargo clippy --locked --tests --no-deps",
    "cargo test --locked --all-features -- --nocapture --test-threads 1",
    "node --test tests/resize-iframe.test.mjs"
  ]) assert.ok(wwsCandidate.join("\n").includes(command), command)

  for (const command of [
    "pnpm --dir framerail lint",
    "pnpm --dir framerail test:unit"
  ]) assert.ok(framerailDraft.join("\n").includes(command), command)
  assert.doesNotMatch(framerailDraft.join("\n"), /pnpm --dir framerail build/)
  assert.equal(
    yamlScalar(framerailCandidate, 8, "if"),
    "${{ needs.classify.outputs.candidate == 'true' }}"
  )
  assert.match(framerailCandidate.join("\n"), /pnpm --dir framerail build/)

  assert.match(localesDraft.join("\n"), /cargo fmt --all -- --check/)
  assert.doesNotMatch(localesDraft.join("\n"), /cargo (?:clippy|run)/)
  assert.equal(
    yamlScalar(localesCandidate, 8, "if"),
    "${{ needs.classify.outputs.candidate == 'true' }}"
  )
  for (const command of [
    "cargo clippy --locked --tests --no-deps",
    "cargo run --locked"
  ]) assert.ok(localesCandidate.join("\n").includes(command), command)
})

test("optional Browser CI contains only browser validation", () => {
  for (const old of ["deepwell.yaml", "wws.yaml", "framerail.yaml"]) {
    assert.equal(existsSync(path.join(root, ".github/workflows", old)), false, old)
  }

  const source = workflow("full-ci.yaml")
  const trigger = source.slice(source.indexOf("on:\n"), source.indexOf("\npermissions:\n"))
  const concurrency = source.slice(source.indexOf("concurrency:\n"), source.indexOf("\njobs:\n"))
  for (const action of ["opened", "synchronize", "reopened", "edited", "ready_for_review", "converted_to_draft", "labeled", "unlabeled", "closed"]) {
    assert.ok(hasYamlLine(trigger, `- ${action}`), action)
  }
  assert.ok(hasYamlLine(source, "framerail_browser:"))
  assert.doesNotMatch(source, /codecov|tarpaulin|coverage|id-token:/i)
  assert.equal((source.match(/contains\(github\.event\.pull_request\.labels\.\*\.name, 'full-ci'\)/g) ?? []).length, 1)
  assert.match(concurrency, /github\.workflow/)
  assert.match(concurrency, /cancel-in-progress:/)
  for (const condition of [
    "github.event.pull_request.draft == false",
    "github.event.action != 'closed'",
    "github.event.action != 'converted_to_draft'",
    "github.event.action == 'labeled' && github.event.label.name == 'full-ci'"
  ]) assert.equal(source.split(condition).length - 1, 1, condition)
  assert.ok(source.split("github.event.action == 'edited' && github.event.changes.base != null").length - 1 >= 1)
  assert.match(source, /pnpm --dir framerail test/)
  assert.match(source, /timeout-minutes: 5/)
})

test("Full CI cancellation and execution policy handles label lifecycle cheaply", () => {
  const active = ({ action, label = null, baseChanged = false }) =>
    !["labeled", "unlabeled", "edited"].includes(action) ||
    (["labeled", "unlabeled"].includes(action) && label === "full-ci") ||
    (action === "edited" && baseChanged)
  const run = ({ action, label = null, baseChanged = false, draft = false, hasFullCi = false }) =>
    !draft && hasFullCi && !["closed", "converted_to_draft"].includes(action) && (
      !["labeled", "unlabeled", "edited"].includes(action) ||
      (action === "labeled" && label === "full-ci") ||
      (action === "edited" && baseChanged)
    )

  for (const action of ["opened", "synchronize", "reopened", "ready_for_review"]) {
    assert.equal(active({ action }), true, `${action}: active`)
    assert.equal(run({ action, hasFullCi: true }), true, `${action}: run`)
    assert.equal(run({ action }), false, `${action}: no label`)
  }
  assert.equal(active({ action: "labeled", label: "full-ci" }), true)
  assert.equal(run({ action: "labeled", label: "full-ci", hasFullCi: true }), true)
  assert.equal(active({ action: "unlabeled", label: "full-ci" }), true)
  assert.equal(run({ action: "unlabeled", label: "full-ci", hasFullCi: true }), false)
  assert.equal(active({ action: "labeled", label: "docs" }), false)
  assert.equal(run({ action: "labeled", label: "docs", hasFullCi: true }), false)
  assert.equal(active({ action: "edited", baseChanged: true }), true)
  assert.equal(run({ action: "edited", baseChanged: true, hasFullCi: true }), true)
  assert.equal(active({ action: "edited" }), false)
  assert.equal(active({ action: "converted_to_draft" }), true)
  assert.equal(run({ action: "converted_to_draft", hasFullCi: true }), false)
  assert.equal(active({ action: "closed" }), true)
  assert.equal(run({ action: "closed", hasFullCi: true }), false)
})

test("Framerail unit and browser suites remain separate", () => {
  const pkg = JSON.parse(read("framerail/package.json"))
  const gate = workflow("ci-gate.yaml")
  const full = workflow("full-ci.yaml")
  const playwright = read("framerail/playwright.config.ts")

  // The unit suite may name files or glob them, but it must reach only `*.test.*`;
  // Playwright's specs are `*.spec.*` and belong to the browser suite alone.
  assert.match(pkg.scripts["test:unit"], /^node --test(?: tests\/(?:\*|[\w-]+)\.test\.(?:js|ts))+$/)
  assert.doesNotMatch(pkg.scripts["test:unit"], /\.spec\.(?:js|ts)/)
  // `test` is the browser suite, run through a script because Playwright needs run-time ports.
  // It must not chain the unit suite: ci-gate runs that already, and full-ci would repeat it.
  assert.equal(pkg.scripts.test, "node tests/playwright-runner.js")
  assert.doesNotMatch(pkg.scripts.test, /test:unit/)
  for (const command of ["build", "test:unit", "lint"]) assert.ok(gate.includes(`pnpm --dir framerail ${command}`), command)
  assert.match(full, /pnpm --dir framerail test/)
  assert.doesNotMatch(playwright, /\.test\.(?:js|ts)/)
})

test("central gate owns workflow policy and locales validation", () => {
  for (const old of ["workflow-lint.yaml", "locales.yaml"]) {
    assert.equal(existsSync(path.join(root, ".github/workflows", old)), false, old)
  }
  const source = workflow("ci-gate.yaml")
  assert.match(source, /node --test \.github\/tests\/\*\.test\.mjs/)
  assert.match(source, /cargo run --locked/)
})

test("actions in touched workflows are immutable pins with version comments", () => {
  for (const name of ["ci-gate.yaml", "full-ci.yaml"]) {
    const source = workflow(name)
    const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)\s+#\s+(\S+)$/gm)]
    assert.ok(uses.length > 0, name)
    for (const [, action, version] of uses) {
      assert.match(action, /^[^@]+@[0-9a-f]{40}$/, `${name}: ${action}`)
      assert.match(version, /^v\d+(?:\.\d+)*$/, `${name}: ${version}`)
    }
    assert.equal(uses.length, (source.match(/^\s*uses:/gm) ?? []).length, name)
  }
})

test("external actions in every workflow are immutable pins", () => {
  const workflowRoot = path.join(root, ".github/workflows")
  for (const name of readdirSync(workflowRoot).filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))) {
    const source = read(`.github/workflows/${name}`)
    for (const [, action] of source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#\s*\S+)?$/gm)) {
      if (action.startsWith("./")) continue
      assert.match(action, /^[^@]+@[0-9a-f]{40}$/, `${name}: ${action}`)
    }
  }
})

test("caching ~/.cargo/bin also caches cargo's install registry", () => {
  const source = workflow("ci-gate.yaml")
  const blocks = source.split(/^\s*- name: /m).filter((block) => block.includes("~/.cargo/bin"))
  assert.ok(blocks.length > 0)
  for (const block of blocks) {
    // Without .crates.toml/.crates2.json cargo has no record of having installed
    // the cached binary, so `cargo install` aborts on the unexpected file.
    assert.match(block, /~\/\.cargo\/\.crates\.toml/)
    assert.match(block, /~\/\.cargo\/\.crates2\.json/)
  }
})
