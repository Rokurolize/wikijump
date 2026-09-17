import { strict as assert } from "node:assert"
import test from "node:test"

import {
  buildWikidotPrintOptionsHtml,
  buildWikidotPrintSourceInfoHtml,
  buildWikidotPrinterFriendlyUrl,
  wikidotPrintView
} from "../src/lib/wikidot/wikidot-print-view.js"

const fakeElement = (attributes = {}) => {
  const listeners = new Map()
  return {
    getAttribute(name) {
      return attributes[name] ?? null
    },
    addEventListener(type, listener) {
      listeners.set(type, listener)
    },
    removeEventListener(type) {
      listeners.delete(type)
    },
    click() {
      listeners.get("click")?.({ preventDefault() {} })
    },
    hasListener(type) {
      return listeners.has(type)
    }
  }
}

test("printer-friendly URL preserves the live doubled slash", () => {
  assert.equal(
    buildWikidotPrinterFriendlyUrl("/doc-wiki-syntax:buttons"),
    "/printer--friendly//doc-wiki-syntax:buttons"
  )
  assert.equal(
    buildWikidotPrinterFriendlyUrl("/open43-issue777-fixture"),
    "/printer--friendly//open43-issue777-fixture"
  )
})

test("print options keep the verified font sizes and single native print control", () => {
  const html = buildWikidotPrintOptionsHtml()
  for (const size of ["6pt", "8pt", "10pt", "12pt", "14pt", "16pt"]) {
    assert.ok(
      html.includes(
        `onclick="WIKIDOT.printview.listeners.changeFontSize(event, '${size}')"`
      ),
      `missing font size ${size}: ${html}`
    )
  }
  assert.ok(
    html.includes(
      '<b><a href="javascript:;" onclick="window.print()">PRINT THE PAGE</a></b>'
    ),
    `missing native print control: ${html}`
  )
  assert.equal((html.match(/window\.print\(\)/gu) ?? []).length, 1)
  assert.ok(html.includes('<div id="print-options">'))
})

test("print source info escapes site and page identity", () => {
  const html = buildWikidotPrintSourceInfoHtml({
    siteName: 'Site <"unsafe">',
    siteUrl: "http://example.test/?a=1&b=2",
    pageTitle: "Page <script>",
    pageUrl: "http://example.test/page&x"
  })
  assert.ok(html.includes("Site &lt;\"unsafe\"&gt;"), html)
  assert.ok(html.includes("http://example.test/?a=1&amp;b=2"), html)
  assert.ok(html.includes("Page &lt;script&gt;"), html)
  assert.ok(!html.includes("<script>"), html)
})

test("print view binds only the generated option handlers", () => {
  const change = fakeElement({
    onclick: "WIKIDOT.printview.listeners.changeFontSize(event, '12pt')"
  })
  const unknown = fakeElement({
    onclick: "WIKIDOT.printview.listeners.changeFontSize(document, '12pt')"
  })
  const nativePrint = fakeElement({ onclick: "window.print()" })
  const close = fakeElement({ href: "#" })
  const content = { style: {} }
  const root = {
    querySelector: (selector) => (selector === "#print-content" ? content : null),
    querySelectorAll: (selector) => {
      if (selector.startsWith('a[onclick^="WIKIDOT.printview.listeners.changeFontSize"')) {
        return [change, unknown]
      }
      if (selector === 'a[onclick="window.print()"]') return [nativePrint]
      return [close]
    }
  }

  const printed = []
  const closed = []
  const previousPrint = globalThis.print
  const previousClose = globalThis.close
  globalThis.print = () => printed.push(true)
  globalThis.close = () => closed.push(true)
  try {
    const action = wikidotPrintView(root)
    assert.equal(change.hasListener("click"), true)
    assert.equal(unknown.hasListener("click"), false)
    assert.equal(nativePrint.hasListener("click"), true)
    assert.equal(close.hasListener("click"), true)

    change.click()
    assert.equal(content.style.fontSize, "12pt")
    unknown.click()
    assert.equal(content.style.fontSize, "12pt")
    nativePrint.click()
    assert.equal(printed.length, 1)
    close.click()
    assert.equal(closed.length, 1)

    action.destroy()
    assert.equal(change.hasListener("click"), false)
    assert.equal(nativePrint.hasListener("click"), false)
  } finally {
    globalThis.print = previousPrint
    globalThis.close = previousClose
  }
})
