import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

const scriptPath = new URL("../scripts/capture_wikidot_featuredsite_global_rotation_v2.py", import.meta.url)

test("FeaturedSite rotation does not establish authority from failed controls", () => {
  const probe = String.raw`
import importlib.util
import sys
import types
from pathlib import Path

bs4 = types.ModuleType("bs4")
bs4.BeautifulSoup = object
sys.modules["bs4"] = bs4
path = Path(${JSON.stringify(scriptPath.pathname)})
spec = importlib.util.spec_from_file_location("capture", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fixture = {"budgets": {"maximum_schedule_lateness_seconds": 3}, "rule_ids": ["global_rotation"]}
def observation(index, kind, identity, *, error_type=None, status=200, rejected=False):
    return {"probe_id": f"probe-{index}", "kind": kind, "selected_card_identity": identity, "request_body_sha256": "same", "schedule_lateness_seconds": 0, "error_type": error_type, "response_status": status, "response_rejected_over_budget": rejected}
observations = [observation(index, "producer", "alpha.example" if index < 4 else "beta.example") for index in range(8)]
observations.extend([observation(8, "negative_control", None), observation(9, "negative_control", None)])
authority, claims, positive, counts, blockers = module.classify(observations, fixture)
assert authority == "established"
failed = [*observations]
failed[8] = observation(8, "negative_control", None, error_type="TimeoutError", status=None)
authority, claims, positive, counts, blockers = module.classify(failed, fixture)
assert authority == "not_established"
assert positive == []
assert any("observation-errors" in blocker for blocker in blockers)
failed[9] = observation(9, "negative_control", None, status=200, rejected=True)
authority, claims, positive, counts, blockers = module.classify(failed, fixture)
assert authority == "not_established"
`
  const result = spawnSync("python3", ["-c", probe], { encoding: "utf8" })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})
