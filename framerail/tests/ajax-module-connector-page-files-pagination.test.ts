import assert from "node:assert/strict"
import test from "node:test"

import { renderWikidotPageFiles } from "../src/lib/server/ajax-module-connector-page-reads.ts"
import {
  PAGE_FILES_DEFAULT_PER_PAGE,
  isSupportedPageReadShape,
  slicePageFiles
} from "../src/lib/server/ajax-module-connector/request.ts"

const MODULE = "files/PageFilesModule"
const PAGE_ID = "3000132367"
const files = Array.from({ length: 250 }, (_, index) => ({
  file_id: 900000 + index,
  name: `file-${index}.txt`,
  mime: "text/plain",
  size: index
}))

const rowIds = (body: string) =>
  [...body.matchAll(/id="file-row-(\d+)"/gu)].map((match) => match[1])

const rowsOf = (body: string) =>
  body.slice(body.indexOf("<tbody>") + "<tbody>".length, body.indexOf("</tbody>"))

test("bounds the uncapped PageFiles rows to the default first slice", () => {
  assert.equal(PAGE_FILES_DEFAULT_PER_PAGE, 100)
  const full = renderWikidotPageFiles("start", files)
  const first = renderWikidotPageFiles(
    "start",
    slicePageFiles(files, { page_id: PAGE_ID })
  )

  assert.equal(rowIds(full).length, 250)
  assert.equal(rowIds(first).length, 100)
  assert.deepEqual(rowIds(first), rowIds(full).slice(0, PAGE_FILES_DEFAULT_PER_PAGE))
  assert.equal(rowsOf(first), rowsOf(full).slice(0, rowsOf(first).length))
})

test("slices PageFiles rows by page and perPage in Deepwell row order", () => {
  const full = renderWikidotPageFiles("start", files)
  const firstTen = renderWikidotPageFiles(
    "start",
    slicePageFiles(files, { page_id: PAGE_ID, perPage: "10" })
  )
  const secondTen = renderWikidotPageFiles(
    "start",
    slicePageFiles(files, { page_id: PAGE_ID, page: "2", perPage: "10" })
  )

  assert.equal(rowIds(firstTen).length, 10)
  assert.equal(rowIds(secondTen).length, 10)
  assert.deepEqual(rowIds(firstTen), rowIds(full).slice(0, 10))
  assert.deepEqual(rowIds(secondTen), rowIds(full).slice(10, 20))
  assert.equal(rowsOf(firstTen), rowsOf(full).slice(0, rowsOf(firstTen).length))
})

test("accepts only the canonical PageFiles pagination shape", () => {
  const accepted: Record<string, string>[] = [
    { page_id: PAGE_ID },
    { page_id: PAGE_ID, page: "1", perPage: "10" },
    { page_id: PAGE_ID, perPage: "100" },
    { page_id: PAGE_ID, page: "10000", perPage: "1" }
  ]
  for (const parameters of accepted) {
    assert.equal(
      isSupportedPageReadShape(MODULE, parameters),
      true,
      JSON.stringify(parameters)
    )
  }

  const rejected: Record<string, string>[] = [
    { page_id: "0" },
    { page_id: PAGE_ID, page: "0" },
    { page_id: PAGE_ID, page: "10001" },
    { page_id: PAGE_ID, page: "+1" },
    { page_id: PAGE_ID, page: "1.5" },
    { page_id: PAGE_ID, perPage: "0" },
    { page_id: PAGE_ID, perPage: "101" },
    { page_id: PAGE_ID, perPage: "-10" },
    { page_id: PAGE_ID, perPage: "01" }
  ]
  for (const parameters of rejected) {
    assert.equal(
      isSupportedPageReadShape(MODULE, parameters),
      false,
      JSON.stringify(parameters)
    )
  }
})
