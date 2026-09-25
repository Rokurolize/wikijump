import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  editPermissionDeniedMessage,
  isJapaneseWikidotLocale,
  toIntlLocales
} from "../src/lib/wikidot/wikidot-locale.js"

describe("Wikidot locale compatibility", () => {
  it("recognizes Wikidot Japanese locale identifiers", () => {
    assert.equal(isJapaneseWikidotLocale("ja-corrections"), true)
    assert.equal(isJapaneseWikidotLocale("ja_JP"), true)
    assert.equal(isJapaneseWikidotLocale("en"), false)
  })

  it("maps ja-corrections only at the Intl boundary", () => {
    const wikidotLocales = ["en-US", "ja-corrections", "en"]

    assert.deepEqual(toIntlLocales(wikidotLocales), ["en-US", "ja", "en"])
    assert.deepEqual(wikidotLocales, ["en-US", "ja-corrections", "en"])
    assert.doesNotThrow(() =>
      new Date("2026-07-22T00:00:00Z").toLocaleString(toIntlLocales(wikidotLocales))
    )
  })

  it("localizes the page edit permission error for the EN/CN/KO/JP theme branches", () => {
    assert.equal(editPermissionDeniedMessage("ja-corrections"), "このページを編集する権限がありません。")
    assert.equal(editPermissionDeniedMessage("ko-KR"), "이 페이지를 편집할 권한이 없습니다.")
    assert.equal(editPermissionDeniedMessage("zh-CN"), "您没有权限编辑此页面。")
    assert.equal(editPermissionDeniedMessage("zh-TW"), "您沒有權限編輯此頁面。")
    assert.equal(editPermissionDeniedMessage("en"), "You don't have permission to edit this page.")
  })
})
