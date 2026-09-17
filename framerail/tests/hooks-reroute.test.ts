import { strict as assert } from "node:assert"
import test from "node:test"

import { reroute } from "../src/hooks.ts"

const request = (url: string) => ({ url: new URL(url), fetch: globalThis.fetch })

test("printer-friendly doubled slash resolves to the single-slash route", async () => {
  assert.equal(
    await reroute(
      request("http://example.test/printer--friendly//doc-wiki-syntax:buttons")
    ),
    "/printer--friendly/doc-wiki-syntax:buttons"
  )
  assert.equal(
    await reroute(
      request("http://example.test/printer--friendly//open43-issue777-fixture")
    ),
    "/printer--friendly/open43-issue777-fixture"
  )
})

test("unrelated paths keep their exact route", async () => {
  assert.equal(await reroute(request("http://example.test/scp-173")), undefined)
  assert.equal(
    await reroute(
      request("http://example.test/printer--friendly/doc-wiki-syntax:buttons")
    ),
    undefined
  )
})
