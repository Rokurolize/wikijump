import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const headOid = "1".repeat(40)
const remoteOid = "2".repeat(40)
const otherOid = "3".repeat(40)
const zeroOid = "0".repeat(40)

const writeExecutable = (file, source) => {
  writeFileSync(file, source)
  chmodSync(file, 0o755)
}

function createHarness(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "wikijump-preflight-"))
  const bin = path.join(directory, "bin")
  const commandLog = path.join(directory, "commands.log")
  const pathLog = path.join(directory, "paths.log")
  mkdirSync(bin)
  writeFileSync(commandLog, "")
  writeFileSync(pathLog, "")
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  writeExecutable(path.join(bin, "git"), `#!/usr/bin/env bash
set -euo pipefail

emit_scope() {
  case "$1" in
    all)
      printf '%s\\0' \
        deepwell/src/lib.rs \
        wws/src/lib.rs \
        framerail/src/lib.ts \
        locales/validator/src/main.rs
      ;;
    deepwell) printf '%s\\0' deepwell/src/lib.rs ;;
    deepwell_space) printf '%s\\0' 'deepwell/src/file with space.rs' ;;
    docs) printf '%s\\0' docs/development.md ;;
    *) echo "unexpected fake scope: $1" >&2; exit 4 ;;
  esac
}

case "$1" in
  rev-parse)
    if [[ "\${2:-}" == --show-toplevel ]]; then
      printf '%s\\n' "$PREFLIGHT_FAKE_ROOT"
    elif [[ "\${2:-}" == HEAD ]]; then
      printf '%s\\n' "$PREFLIGHT_HEAD_OID"
    else
      exit 0
    fi
    ;;
  merge-base)
    printf '%s\\n' "$3"
    ;;
  diff)
    if [[ "$#" -eq 6 ]]; then
      if [[ "$5" == "$PREFLIGHT_REMOTE_OID" ]]; then
        emit_scope "$PREFLIGHT_REMOTE_SCOPE"
      else
        emit_scope "$PREFLIGHT_FALLBACK_SCOPE"
      fi
    fi
    ;;
  *)
    echo "unexpected fake git invocation: $*" >&2
    exit 4
    ;;
esac
`)

  for (const command of ["cargo", "pnpm"]) {
    writeExecutable(path.join(bin, command), `#!/usr/bin/env bash
set -euo pipefail
{
  printf '${command}'
  printf ' %s' "$@"
  printf '\\n'
} >> "$PREFLIGHT_COMMAND_LOG"
`)
  }

  writeExecutable(path.join(bin, "node"), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == .github/scripts/classify-changes.mjs ]]; then
  tee "$PREFLIGHT_PATH_LOG" | "$PREFLIGHT_REAL_NODE" "$@"
else
  exec "$PREFLIGHT_REAL_NODE" "$@"
fi
`)

  const environment = (overrides = {}) => ({
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PREFLIGHT_COMMAND_LOG: commandLog,
    PREFLIGHT_FAKE_ROOT: root,
    PREFLIGHT_FALLBACK_SCOPE: "all",
    PREFLIGHT_HEAD_OID: headOid,
    PREFLIGHT_PATH_LOG: pathLog,
    PREFLIGHT_REAL_NODE: process.execPath,
    PREFLIGHT_REMOTE_OID: remoteOid,
    PREFLIGHT_REMOTE_SCOPE: "all",
    ...overrides
  })

  return {
    commands() {
      return readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean)
    },
    receivedPaths() {
      return readFileSync(pathLog, "utf8").split("\0").filter(Boolean)
    },
    runPreflight(args = [], overrides = {}) {
      return spawnSync("bash", ["scripts/preflight.sh", ...args], {
        cwd: root,
        encoding: "utf8",
        env: environment(overrides)
      })
    },
    runHook(input, overrides = {}) {
      return spawnSync("bash", [".githooks/pre-push", "origin", "ssh://example.invalid/wikijump"], {
        cwd: root,
        encoding: "utf8",
        env: environment(overrides),
        input
      })
    }
  }
}

test("checkpoint preflight avoids compiled checks for every selected group", (t) => {
  const harness = createHarness(t)
  const result = harness.runPreflight(["--base", remoteOid])

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(harness.commands(), [
    "cargo fmt --manifest-path deepwell/Cargo.toml --check",
    "cargo fmt --manifest-path wws/Cargo.toml --check",
    "pnpm --dir framerail lint",
    "pnpm --dir framerail test:unit",
    "cargo fmt --manifest-path locales/validator/Cargo.toml --all -- --check"
  ])
})

test("preflight preserves changed path boundaries", (t) => {
  const harness = createHarness(t)
  const result = harness.runPreflight(["--base", remoteOid], {
    PREFLIGHT_REMOTE_SCOPE: "deepwell_space"
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(harness.receivedPaths(), ["deepwell/src/file with space.rs"])
  assert.deepEqual(harness.commands(), [
    "cargo fmt --manifest-path deepwell/Cargo.toml --check"
  ])
})

test("final preflight is the single explicit full-check barrier", (t) => {
  const harness = createHarness(t)
  const result = harness.runPreflight(["--base", remoteOid, "--final"])

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(harness.commands(), [
    "cargo fmt --manifest-path deepwell/Cargo.toml --check",
    "cargo machete deepwell",
    "cargo clippy --manifest-path deepwell/Cargo.toml --tests --no-deps -- -D warnings",
    "cargo test --manifest-path deepwell/Cargo.toml",
    "cargo fmt --manifest-path wws/Cargo.toml --check",
    "cargo machete wws",
    "cargo clippy --manifest-path wws/Cargo.toml --tests --no-deps -- -D warnings",
    "cargo test --manifest-path wws/Cargo.toml",
    "pnpm --dir framerail lint",
    "pnpm --dir framerail test:unit",
    "pnpm --dir framerail build",
    "cargo fmt --manifest-path locales/validator/Cargo.toml --all -- --check",
    "cargo clippy --manifest-path locales/validator/Cargo.toml --locked --tests --no-deps -- -A unused -D warnings",
    "cargo run --manifest-path locales/validator/Cargo.toml --locked"
  ])

  const help = harness.runPreflight(["--help"])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /default checkpoint does not compile Cargo targets/)
  assert.match(help.stdout, /--final/)
  assert.doesNotMatch(help.stdout, /--full/)
  assert.doesNotMatch(help.stdout, /set -uo pipefail/)
  assert.equal(harness.runPreflight(["--full"]).status, 2)
})

test("pre-push checkpoints only the existing HEAD branch update", (t) => {
  const harness = createHarness(t)
  const result = harness.runHook(
    `refs/heads/topic ${headOid} refs/heads/topic ${remoteOid}\n`,
    { PREFLIGHT_REMOTE_SCOPE: "deepwell" }
  )

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`checkpoint base: ${remoteOid}`))
  assert.deepEqual(harness.commands(), [
    "cargo fmt --manifest-path deepwell/Cargo.toml --check"
  ])
})

test("pre-push falls back for every ambiguous or new ref shape", async (t) => {
  const fixtures = [
    {
      name: "multiple refs",
      input: [
        `refs/heads/topic ${headOid} refs/heads/topic ${remoteOid}`,
        `refs/tags/checkpoint ${otherOid} refs/tags/checkpoint ${zeroOid}`
      ].join("\n") + "\n"
    },
    {
      name: "deleted ref",
      input: `(delete) ${zeroOid} refs/heads/topic ${remoteOid}\n`
    },
    {
      name: "new branch with zero remote oid",
      input: `refs/heads/topic ${headOid} refs/heads/topic ${zeroOid}\n`
    },
    {
      name: "non-HEAD local ref",
      input: `refs/heads/other ${otherOid} refs/heads/other ${remoteOid}\n`
    }
  ]

  for (const fixture of fixtures) {
    await t.test(fixture.name, (t) => {
      const harness = createHarness(t)
      const result = harness.runHook(fixture.input, { PREFLIGHT_REMOTE_SCOPE: "docs" })

      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /checkpoint base: origin\/develop \(full branch fallback\)/)
      const commands = harness.commands().join("\n")
      for (const expected of [
        "cargo fmt --manifest-path deepwell/Cargo.toml --check",
        "cargo fmt --manifest-path wws/Cargo.toml --check",
        "pnpm --dir framerail test:unit",
        "cargo fmt --manifest-path locales/validator/Cargo.toml --all -- --check"
      ]) assert.ok(commands.includes(expected), `${fixture.name}: ${expected}`)
    })
  }
})
