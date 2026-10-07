import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import {fileURLToPath} from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/forum-feed-live-20261007")
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"))

test("ForumStart RSS live responses remain retained as dated, hash-bound evidence", async () => {
  assert.equal(manifest.schema, "wikijump.forum_feed_live_evidence.v1")
  assert.equal(manifest.feeds.length, 2)
  for (const feed of manifest.feeds) {
    assert.equal(feed.http_status, 200)
    assert.equal(feed.observation_date, "2026-10-07")
    const artifact = await fs.readFile(path.join(root, path.basename(feed.browser_artifact)))
    assert.equal(createHash("sha256").update(artifact).digest("hex"), feed.sha256)
    const html = artifact.toString("utf8")
    assert.match(html, /id="webkit-xml-viewer-source-xml"/)
    assert.match(html, new RegExp(`SCP Foundation - new forum ${feed.kind}`))
    assert.match(html, /<rss[\s\S]*<channel>/)
    assert.match(html, /<content:encoded>/)
    assert.match(html, /<wikidot:authorName>/)
    assert.equal((html.match(/<item>/gu) ?? []).length, feed.observed_item_count)
  }
})
