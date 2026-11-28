import assert from "node:assert/strict"
import test from "node:test"

import { deepwellJsonRpcUrl } from "../src/lib/server/deepwell/url.ts"

test("Deepwell RPC URLs leave IPv4 literals unchanged", () => {
  assert.equal(deepwellJsonRpcUrl("127.0.0.1", 2747), "http://127.0.0.1:2747/jsonrpc")
})

test("Deepwell RPC URLs leave hostnames unchanged", () => {
  assert.equal(deepwellJsonRpcUrl("deepwell", "2747"), "http://deepwell:2747/jsonrpc")
})

test("Deepwell RPC URLs bracket bare IPv6 literals", () => {
  assert.equal(deepwellJsonRpcUrl("::1", 2747), "http://[::1]:2747/jsonrpc")
})

test("Deepwell RPC URLs do not double-bracket IPv6 literals", () => {
  assert.equal(deepwellJsonRpcUrl("[::1]", 2747), "http://[::1]:2747/jsonrpc")
})
