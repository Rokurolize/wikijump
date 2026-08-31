import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import test from "node:test"

const scriptPath = new URL("../scripts/capture-pr1334-a1061-cycle-cascade-20260810-c.py", import.meta.url)

test("A1061 cycle capture rejects fixture SSRF and budget amplification", async () => {
  const script = await readFile(scriptPath, "utf8")
  assert.match(script, /EXPECTED_PUBLIC_ORIGIN\s*=\s*["']http:\/\/sandbox-for-codex\.wikidot\.com["']/u)
  assert.match(script, /trust_env=False/u)
  assert.match(script, /follow_redirects=False/u)
  const probe = String.raw`
import importlib.util
import urllib.parse
from pathlib import Path

path = Path(${JSON.stringify(scriptPath.pathname)})
spec = importlib.util.spec_from_file_location("capture", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.socket.getaddrinfo = lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 80))]
assert module.validate_public_origin("http://sandbox-for-codex.wikidot.com") == "http://sandbox-for-codex.wikidot.com"
for value in ("http://127.0.0.1:8080", "https://sandbox-for-codex.wikidot.com", "http://sandbox-for-codex.wikidot.com/path", "http://user@sandbox-for-codex.wikidot.com"):
    try:
        module.validate_public_origin(value)
    except SystemExit:
        pass
    else:
        raise AssertionError(value)
limits = {name: bound for name, bound in module.MAX_BUDGETS.items()}
module.validate_budgets(limits)
limits["max_total_requests"] = module.MAX_BUDGETS["max_total_requests"] + 1
try:
    module.validate_budgets(limits)
except SystemExit:
    pass
else:
    raise AssertionError("unbounded request budget accepted")
`
  const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})
