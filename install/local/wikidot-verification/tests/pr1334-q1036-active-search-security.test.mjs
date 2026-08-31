import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import test from "node:test"

const scriptPath = new URL("../scripts/capture_pr1334_q1036_active_search.py", import.meta.url)

test("active-search capture rejects arbitrary initial and redirect targets", async () => {
  const script = await readFile(scriptPath, "utf8")
  assert.match(script, /EXPECTED_INITIAL_HOSTS/u)
  assert.match(script, /trust_env=False/u)
  assert.match(script, /validate_public_url\(url, EXPECTED_INITIAL_HOSTS\)/u)
  const probe = String.raw`
import importlib.util
import sys
import types
from pathlib import Path

httpx = types.ModuleType("httpx")
httpx.HTTPError = Exception
sys.modules["httpx"] = httpx
path = Path(${JSON.stringify(scriptPath.pathname)})
spec = importlib.util.spec_from_file_location("capture", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.socket.getaddrinfo = lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 443))]
assert module.validate_public_url("https://scp-wiki.wikidot.com/search:site/q/SCP-173", module.EXPECTED_INITIAL_HOSTS)
for value in ("http://scp-wiki.wikidot.com/x", "https://127.0.0.1/x", "https://example.com/x", "https://scp-wiki.wikidot.com/x?probe=1"):
    try:
        module.validate_public_url(value, module.EXPECTED_INITIAL_HOSTS)
    except ValueError:
        pass
    else:
        raise AssertionError(value)
limits = {name: bound for name, bound in module.MAX_BUDGETS.items()}
module.validate_budgets(limits)
limits["max_requests"] += 1
try:
    module.validate_budgets(limits)
except ValueError:
    pass
else:
    raise AssertionError("unbounded request budget accepted")
`
  const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})
