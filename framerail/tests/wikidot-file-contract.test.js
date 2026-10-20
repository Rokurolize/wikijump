import assert from "node:assert/strict"
import { test } from "node:test"

import {
  isMirrorFileInventoryReadOnly,
  sortFilesWikidot,
  wikidotFileSize,
  wikidotFileTotals,
  wikidotFileTypeDescription
} from "../src/lib/wikidot-file-contract.js"

test("file sizes match the frozen Wikidot strings", () => {
  assert.equal(wikidotFileSize(204126), "199.34 kB")
  assert.equal(wikidotFileSize(108082), "105.55 kB")
  assert.equal(wikidotFileSize(7067459), "6.74 MB")
  assert.equal(wikidotFileSize(0), "0 Bytes")
  assert.equal(wikidotFileSize(1023), "1023 Bytes")
  assert.equal(wikidotFileSize(1024), "1.00 kB")
  assert.equal(wikidotFileSize(1048576), "1.00 MB")
})

test("only fixture-observed types map to Wikidot labels", () => {
  assert.equal(wikidotFileTypeDescription("image/png"), "PNG image data")
  assert.equal(wikidotFileTypeDescription("image/jpeg"), "JPEG image data")
  assert.equal(wikidotFileTypeDescription("image/gif"), "GIF image data")
  assert.equal(wikidotFileTypeDescription("application/pdf"), "application/pdf")
  assert.equal(wikidotFileTypeDescription(undefined), "")
})

test("files sort case-insensitively by name like the frozen list", () => {
  const names = [
    "WHEN_ALERT.png",
    "alert.jpg",
    "AFTER_FOG.png",
    "weathermap.gif",
    "Sam.jpg",
    "cold.jpg"
  ].map((name) => ({ name }))
  assert.deepEqual(
    sortFilesWikidot(names).map((file) => file.name),
    [
      "AFTER_FOG.png",
      "alert.jpg",
      "cold.jpg",
      "Sam.jpg",
      "weathermap.gif",
      "WHEN_ALERT.png"
    ]
  )
})

test("totals count files and sum bytes", () => {
  assert.deepEqual(wikidotFileTotals([{ size: 100 }, { size: 200 }, {}]), {
    count: 3,
    bytes: 300
  })
  assert.deepEqual(wikidotFileTotals([]), { count: 0, bytes: 0 })
})

test("mirror inventory is read-only only when page and site are both imported", () => {
  const imported = { from_wikidot: true }
  const native = { from_wikidot: false }
  assert.equal(isMirrorFileInventoryReadOnly(imported, imported), true)
  assert.equal(isMirrorFileInventoryReadOnly(imported, native), false)
  assert.equal(isMirrorFileInventoryReadOnly(native, imported), false)
  assert.equal(isMirrorFileInventoryReadOnly(native, native), false)
  assert.equal(isMirrorFileInventoryReadOnly(null, imported), false)
  assert.equal(isMirrorFileInventoryReadOnly(imported, undefined), false)
})
