import assert from "node:assert/strict"
import test from "node:test"

import { authCancelDestination } from "../src/lib/auth-cancel.js"

test("authentication cancellation always uses the safe platform root", () => {
  assert.equal(authCancelDestination(), "/")
})
