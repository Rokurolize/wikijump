import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const verificationRoot = fileURLToPath(new URL("../", import.meta.url))

test("tracked wjlab reconciler ignores trash and includes repository references", () => {
  const result = spawnSync(
    "python3",
    ["scripts/reconcile-wjlab-self-test.py"],
    {
      cwd: verificationRoot,
      encoding: "utf8"
    }
  )

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /reconcile-wjlab self-test: pass/u)
})
