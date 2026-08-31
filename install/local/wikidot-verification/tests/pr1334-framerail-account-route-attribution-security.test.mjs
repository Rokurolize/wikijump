import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import test from "node:test"

const scriptPath = new URL("../scripts/capture_pr1334_framerail_account_route_attribution.py", import.meta.url)

test("Framerail account attribution binds output to a clean source identity", async () => {
  const script = await readFile(scriptPath, "utf8")
  assert.match(script, /rev-parse.*HEAD\^\{tree\}/u)
  assert.match(script, /status.*--porcelain=v1/u)
  assert.match(script, /output\.open\("x"\)/u)
  const probe = String.raw`
import importlib.util
import subprocess
from pathlib import Path
from types import SimpleNamespace

path = Path(${JSON.stringify(scriptPath.pathname)})
spec = importlib.util.spec_from_file_location("capture", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def fake_run(command, **kwargs):
    if command[1:] == ["rev-parse", "HEAD"]:
        return SimpleNamespace(stdout=module.BASE_COMMIT + "\n")
    if command[1:] == ["rev-parse", "HEAD^{tree}"]:
        return SimpleNamespace(stdout=module.BASE_TREE + "\n")
    return SimpleNamespace(stdout=b"")
module.subprocess.run = fake_run
module.verify_repository()
def wrong_tree(command, **kwargs):
    if command[1:] == ["rev-parse", "HEAD"]:
        return SimpleNamespace(stdout=module.BASE_COMMIT + "\n")
    if command[1:] == ["rev-parse", "HEAD^{tree}"]:
        return SimpleNamespace(stdout="0" * 40 + "\n")
    return SimpleNamespace(stdout=b"")
module.subprocess.run = wrong_tree
try:
    module.verify_repository()
except RuntimeError:
    pass
else:
    raise AssertionError("stale tree accepted")
`
  const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})
