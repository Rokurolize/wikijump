import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../scripts/", import.meta.url)
const scripts = [
  "capture_pr1334_deepwell_page_revision_jsonrpc_attribution.py",
  "capture_pr1334_ftml_reference_control_attribution.py",
  "capture_pr1334_wws_route_attribution.py",
]

test("fixed evidence writers create a fresh non-following file", async () => {
  for (const name of scripts) {
    const source = await readFile(new URL(name, root), "utf8")
    assert.match(source, /os\.O_EXCL/u, name)
    assert.match(source, /os\.O_NOFOLLOW/u, name)
    assert.match(source, /os\.fdopen/u, name)
  }
})
