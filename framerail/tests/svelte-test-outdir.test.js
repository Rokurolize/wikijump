import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import config from "../svelte.config.js"
import { loadConfigFromFile } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))

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
