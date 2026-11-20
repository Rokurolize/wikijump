import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const lockfile = readFileSync(join(root, "pnpm-lock.yaml"), "utf8")

test("frozen install resolves Vite to exactly 7.3.8", () => {
  assert.equal(manifest.dependencies.vite, "^7.3.8")
  assert.match(lockfile, / {6}vite:\n {8}specifier: \^7\.3\.8\n {8}version: 7\.3\.8\(/)
  assert.match(lockfile, /^ {2}vite@7\.3\.8:$/m)
  assert.doesNotMatch(lockfile, /^ {2}vite@7\.3\.7:$/m)
})
