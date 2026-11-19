import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { ACCESS_POLICIES } from "../src/lib/admin/admin-access-policy.ts"

describe("administrative access policy values", () => {
  it("matches the policy spellings persisted by Deepwell", () => {
    assert.deepEqual([...ACCESS_POLICIES], ["open", "closed", "private"])
  })
})
