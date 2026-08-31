import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import test from "node:test"

const scriptPath = new URL("../scripts/capture-pr1334-q1034-q778-actor-deletion-20260810-a.py", import.meta.url)

test("Q1034/Q778 capture rejects fixture SSRF, proxy, redirect, and budget amplification", async () => {
  const script = await readFile(scriptPath, "utf8")
  assert.match(script, /EXPECTED_PUBLIC_ORIGIN\s*=\s*["']http:\/\/sandbox-for-codex\.wikidot\.com["']/u)
  assert.match(script, /build_opener\(urllib\.request\.ProxyHandler\(\{\}\),\s*RefuseRedirectHandler\(\)\)/u)
  assert.doesNotMatch(script, /urllib\.request\.urlopen/u)
  const probe = String.raw`
import importlib.util
import ipaddress
import urllib.error
import urllib.request
from pathlib import Path

path = Path(${JSON.stringify(scriptPath.pathname)})
spec = importlib.util.spec_from_file_location("capture", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.socket.getaddrinfo = lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 80))]
assert module.validate_public_origin("http://sandbox-for-codex.wikidot.com") == "http://sandbox-for-codex.wikidot.com"
for value in ("http://127.0.0.1", "https://sandbox-for-codex.wikidot.com", "http://sandbox-for-codex.wikidot.com/path", "http://user@sandbox-for-codex.wikidot.com"):
    try:
        module.validate_public_origin(value)
    except SystemExit:
        pass
    else:
        raise AssertionError(value)
limits = {name: bound for name, bound in module.MAX_BUDGETS.items()}
module.validate_budgets(limits)
limits["read_retry_limit"] = module.MAX_BUDGETS["read_retry_limit"] + 1
try:
    module.validate_budgets(limits)
except SystemExit:
    pass
else:
    raise AssertionError("unbounded retries accepted")
try:
    module.RefuseRedirectHandler().redirect_request(urllib.request.Request("http://sandbox-for-codex.wikidot.com/forum/start"), None, 302, "Found", {}, "http://127.0.0.1")
except urllib.error.HTTPError:
    pass
else:
    raise AssertionError("redirect accepted")
`
  const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})
