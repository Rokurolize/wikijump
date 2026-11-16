import { strict as assert } from "node:assert"
import test from "node:test"

import {
  buildWikidotPageInfoParts,
  buildWikidotPageInfoText,
  encodeWikidotDateFormat,
  formatWikidotSourceDate,
  WIKIDOT_PAGE_INFO_DATE_FORMAT
} from "../src/lib/wikidot/wikidot-page-info.ts"

test("formats imported Wikidot page revision metadata like the source shell", () => {
  const updatedAt = "2024-03-27T20:18:44Z"
  const now = Date.parse("2026-07-01T12:00:00+09:00")

  assert.equal(formatWikidotSourceDate(Date.parse(updatedAt)), "28 Mar 2024, 05:18")
  assert.equal(
    buildWikidotPageInfoText({ revision: 4, updatedAt, now }),
    "page revision: 4, last edited: 28 Mar 2024, 05:18 (825 days ago)"
  )
})

test("formats recent Wikidot page revision metadata with elapsed hours", () => {
  const updatedAt = "2026-07-01T05:52:50Z"
  const now = Date.parse("2026-07-01T16:30:00Z")

  assert.equal(
    buildWikidotPageInfoText({ revision: 234, updatedAt, now }),
    "page revision: 234, last edited: 1 Jul 2026, 14:52 (10 hours ago)"
  )
})

test("formats Japanese Wikidot page revision metadata like SCP-JP", () => {
  const updatedAt = "2023-01-07T06:16:27Z"
  const now = Date.parse("2026-07-04T00:16:27Z")

  assert.equal(
    buildWikidotPageInfoText({ revision: 6, updatedAt, now, locale: "ja" }),
    "ページリビジョン: 6, 最終更新: 7 Jan 2023, 15:16 (1273 days 前)"
  )
})

test("formats singular recent Wikidot page revision metadata units", () => {
  const updatedAt = "2026-07-01T05:52:50Z"

  assert.equal(
    buildWikidotPageInfoText({
      revision: 234,
      updatedAt,
      now: Date.parse("2026-07-01T06:53:00Z")
    }),
    "page revision: 234, last edited: 1 Jul 2026, 14:52 (1 hour ago)"
  )
  assert.equal(
    buildWikidotPageInfoText({
      revision: 234,
      updatedAt,
      now: Date.parse("2026-07-01T05:53:50Z")
    }),
    "page revision: 234, last edited: 1 Jul 2026, 14:52 (1 minute ago)"
  )
})

test("rejects invalid imported Wikidot page revision timestamps", () => {
  assert.equal(
    buildWikidotPageInfoText({
      revision: 4,
      updatedAt: "not a timestamp"
    }),
    null
  )
})

test("builds the odate span parts Wikidot renders around the page-info date", () => {
  const updatedAt = "2025-04-02T12:17:27Z"
  const now = Date.parse(updatedAt) + 593 * 24 * 60 * 60 * 1000

  const parts = buildWikidotPageInfoParts({ revision: 57, updatedAt, now })

  assert.equal(
    parts?.text,
    "page revision: 57, last edited: 2 Apr 2025, 21:17 (593 days ago)"
  )
  assert.deepEqual(parts?.date, {
    prefix: "page revision: 57, last edited: ",
    text: "2 Apr 2025, 21:17 (593 days ago)",
    epochSeconds: 1743596247,
    className:
      "odate time_1743596247 format_%25e%20%25b%20%25Y%2C%20%25H%3A%25M%20%28%25O%20ago%29"
  })
})

test("percent-encodes Wikidot date formats like ftml date elements", () => {
  assert.equal(WIKIDOT_PAGE_INFO_DATE_FORMAT, "%e %b %Y, %H:%M (%O ago)")
  assert.equal(
    encodeWikidotDateFormat(WIKIDOT_PAGE_INFO_DATE_FORMAT),
    "%25e%20%25b%20%25Y%2C%20%25H%3A%25M%20%28%25O%20ago%29"
  )
  assert.equal(encodeWikidotDateFormat("%d. %m. %Y"), "%25d.%20%25m.%20%25Y")
})

test("rejects invalid imported timestamps when building page-info parts", () => {
  assert.equal(
    buildWikidotPageInfoParts({ revision: 4, updatedAt: "not a timestamp" }),
    null
  )
})
