import assert from "node:assert/strict"
import test from "node:test"

import { wikidotSearchPath } from "../src/lib/wikidot/wikidot-search.js"

test("Wikidot top search preserves and path-encodes the submitted query", () => {
  assert.equal(
    wikidotSearchPath("codex search probe"),
    "/search:site/q/codex%20search%20probe"
  )
  assert.equal(wikidotSearchPath("  a/b? c  "), "/search:site/q/%20%20a%2Fb%3F%20c%20%20")
  assert.equal(
    wikidotSearchPath("Search this site"),
    "/search:site/q/Search%20this%20site"
  )
})
