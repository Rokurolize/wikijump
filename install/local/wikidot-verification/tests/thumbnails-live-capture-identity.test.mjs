import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const scriptUrl = new URL("../scripts/capture-thumbnails-live.mjs", import.meta.url)

test("thumbnail capture binds evidence to a clean source commit and tree", async () => {
  const script = await readFile(scriptUrl, "utf8")
  assert.match(script, /rev-parse.*HEAD/u)
  assert.match(script, /rev-parse.*HEAD\^\{tree\}/u)
  assert.match(script, /status.*--porcelain=v1/u)
  assert.match(script, /capture_source:\s*capturedSource/u)
})
