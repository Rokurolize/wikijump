import assert from "node:assert/strict"
import test from "node:test"

import { escapeFeedXmlText, hasInvalidXmlC0 } from "../src/lib/server/feed-xml.ts"

test("feed XML text strips only XML-invalid C0 controls", () => {
  assert.equal(escapeFeedXmlText("A\u0001B\u001fC"), "ABC")
  assert.equal(escapeFeedXmlText("\u0000\u0008\u000B\u000C\u000E\u001F"), "")
  assert.equal(escapeFeedXmlText("A\tB\nC\rD"), "A\tB\nC\rD")
  assert.equal(escapeFeedXmlText("hello"), "hello")
  assert.ok(!hasInvalidXmlC0(escapeFeedXmlText("a\u0001b\u001fc&<>\t\n\r")))
  assert.ok(hasInvalidXmlC0("a\u0001b"))
})

test("feed XML text keeps metacharacter escaping and all other bytes identical", () => {
  assert.equal(
    escapeFeedXmlText(`&<>"'\u00e9\u4e2d\u0001`),
    "&amp;&lt;&gt;&quot;&#039;\u00e9\u4e2d"
  )
  assert.equal(escapeFeedXmlText("&amp;\u0001"), "&amp;amp;")
})
