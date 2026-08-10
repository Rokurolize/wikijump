import assert from "node:assert/strict"
import test from "node:test"

import {
  renderWikidotPageFiles,
  renderWikidotViewSource
} from "../src/lib/server/ajax-module-connector-page-reads.js"

test("renders page source in the Wikidot client parsing boundary", () => {
  assert.equal(
    renderWikidotViewSource('alpha < beta & [[div title="x"]]'),
    '<h1>Page Source</h1>\n\n<div class="page-source">\n\talpha &lt; beta &amp; [[div title=&quot;x&quot;]]\n</div>\n'
  )
})

test("renders attached files in the Wikidot client parsing boundary", () => {
  assert.equal(
    renderWikidotPageFiles("drafts:client parity", [
      {
        file_id: 402,
        name: 'alpha & "beta".txt',
        mime: "text/plain",
        size: 2048
      }
    ]),
    '<h1>Files</h1>\n<table class="page-files"><tbody><tr id="file-row-402"><td><a href="/local--files/drafts%3Aclient%20parity/alpha%20%26%20%22beta%22.txt">alpha &amp; &quot;beta&quot;.txt</a></td><td><span title="text/plain">text/plain</span></td><td>2048 Bytes</td></tr></tbody></table>'
  )
})

test("renders an empty file list without fabricating rows", () => {
  assert.equal(
    renderWikidotPageFiles("main", []),
    "<h1>Files</h1>\n<p>No files attached to this page</p>"
  )
})
