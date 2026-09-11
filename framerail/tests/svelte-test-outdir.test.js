import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import config from "../svelte.config.js"
import { loadConfigFromFile } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

test("unit test entrypoint generates the shared SvelteKit tsconfig before isolated workers start", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
  assert.equal(
    pkg.scripts["test:unit"],
    "../scripts/run-framerail-unit-tests.sh"
  )
})

test("focused unit tests use the same sync and network-guard bootstrap as the full suite", () => {
  const runner = readFileSync(resolve(root, "../scripts/run-framerail-unit-tests.sh"), "utf8")
  assert.match(runner, /run-test-no-external-network\.sh/)
  assert.match(runner, /svelte-kit sync/)
  assert.match(runner, /node --test/)
})

test("node test workers isolate SvelteKit and Vite generated state by process", async () => {
  assert.equal(process.env.NODE_TEST_CONTEXT, "child-v8")
  assert.equal(
    config.kit.outDir,
    resolve(tmpdir(), `wikijump-framerail-svelte-kit-test-${process.pid}`)
  )
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "test" },
    resolve(root, "vite.config.ts")
  )
  assert.ok(loaded)
  assert.equal(
    loaded.config.cacheDir,
    resolve(tmpdir(), `wikijump-framerail-vite-test-${process.pid}`)
  )
})
