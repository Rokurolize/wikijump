import assert from "node:assert/strict"
import test from "node:test"

import {
  buildWikidotForumFeedXml,
  formatWikidotForumFeedDate,
  wikidotForumFeedHeaders
} from "../src/lib/server/forum-feed.ts"

const output = {
  site_name: 'SCP & "Test"',
  site_description: "Secure <safe> & sound",
  items: [
    {
      forum_post_id: 91,
      forum_thread_id: 42,
      created_at: "2026-10-07T12:21:30Z",
      title: "Post & <title>",
      thread_title: "Thread's title",
      thread_slug: "thread-title",
      page_slug: null,
      forum_group_id: 2,
      forum_group_name: "Group",
      forum_category_id: 8,
      forum_category_name: "Category",
      forum_category_slug: "category",
      author_user_id: 17,
      author_name: "Author & User",
      content_html: "<p>One ]]> two</p>"
    }
  ]
}

test("forum RSS uses local identifiers, public channel metadata, and safe CDATA", () => {
  const xml = buildWikidotForumFeedXml(
    "https://scp-wiki.wikijump.localhost/feed/forum/posts.xml",
    "posts",
    output,
    new Date("2026-10-07T16:54:02Z")
  )

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8" \?>\n<rss version="2\.0" xmlns:content=/)
  assert.match(xml, /<title>SCP &amp; &quot;Test&quot; - new forum posts<\/title>/)
  assert.match(xml, /<link>https:\/\/scp-wiki\.wikijump\.localhost\/forum\/start<\/link>/)
  assert.match(xml, /<description>Posts in forums of the site &quot;SCP &amp; &quot;Test&quot;&quot; - Secure &lt;safe&gt; &amp; sound<\/description>/)
  assert.match(xml, /<guid>http:\/\/scp-wiki\.wikijump\.localhost\/forum\/t-42#post-91<\/guid>/)
  assert.match(xml, /<title\/>\n\t\t\t<link>https:\/\/scp-wiki\.wikijump\.localhost\/forum\/t-42\/thread-title#post-91<\/link>\n\t\t\t<description\/>/)
  assert.match(xml, /<link>https:\/\/scp-wiki\.wikijump\.localhost\/forum\/t-42\/thread-title#post-91<\/link>/)
  assert.match(xml, /<wikidot:authorUserId>17<\/wikidot:authorUserId>/)
  assert.match(xml, /<pubDate>Wed, 07 Oct 2026 12:21:30 \+0000<\/pubDate>/)
  assert.match(xml, /<!\[CDATA\[\n\t\t\t\t<p>One \]\]\]\]><!\[CDATA\[> two<\/p>/)
  assert.match(xml, /Forum category: <a href="https:\/\/scp-wiki\.wikijump\.localhost\/forum\/c-8">Group \/ Category<\/a>/)
  assert.match(xml, /Forum thread: <a href="https:\/\/scp-wiki\.wikijump\.localhost\/forum\/t-42\/thread-title">Thread&#039;s title<\/a>/)
})

test("thread RSS uses the thread identity and UTC dates", () => {
  const xml = buildWikidotForumFeedXml(
    "https://example.wikijump.localhost/feed/forum/threads.xml",
    "threads",
    output,
    new Date("2026-10-07T16:53:15Z")
  )

  assert.match(xml, /<title>Thread&#039;s title<\/title>/)
  assert.match(xml, /<guid>http:\/\/example\.wikijump\.localhost\/forum\/t-42<\/guid>/)
  assert.match(xml, /<link>https:\/\/example\.wikijump\.localhost\/forum\/t-42\/thread-title<\/link>/)
  assert.equal(formatWikidotForumFeedDate(new Date("2026-10-07T16:53:15Z")), "Wed, 07 Oct 2026 16:53:15 +0000")
})

test("forum RSS responses use the observed XML content type and cache policy", () => {
  const headers = wikidotForumFeedHeaders()
  assert.equal(headers.get("content-type"), "text/xml;charset=utf-8")
  assert.equal(headers.get("cache-control"), "no-cache, must-revalidate")
  assert.equal(headers.get("expires"), "Mon, 26 Jul 1997 05:00:00 GMT")
})
