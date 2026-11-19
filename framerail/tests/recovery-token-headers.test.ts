import { strict as assert } from "node:assert"
import test from "node:test"

import { applyStaticSecurityHeaders } from "../src/lib/server/security-headers.ts"

const headersFor = (pathname: string) => {
  const response = new Response("ok")
  applyStaticSecurityHeaders(response, pathname, "test", "local")
  return response.headers
}

const TOKEN = "a".repeat(48)

test("password recovery pages forbid caching and referrer leakage", () => {
  for (const pathname of [`/-/reset/${TOKEN}`, "/-/forgot"]) {
    const headers = headersFor(pathname)
    assert.equal(headers.get("cache-control"), "no-store", pathname)
    assert.equal(headers.get("referrer-policy"), "no-referrer", pathname)
  }
})

test("sibling email token pages forbid caching and referrer leakage", () => {
  for (const pathname of [`/-/verify-email/${TOKEN}`, `/-/delete-account/${TOKEN}`]) {
    const headers = headersFor(pathname)
    assert.equal(headers.get("cache-control"), "no-store", pathname)
    assert.equal(headers.get("referrer-policy"), "no-referrer", pathname)
  }
})

test("ordinary pages keep the default security headers", () => {
  const headers = headersFor("/some-page")
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin")
  assert.equal(headers.get("cache-control"), null)
})
