import assert from "node:assert/strict"
import test from "node:test"

import { hasInvalidXmlC0 } from "../src/lib/server/feed-xml.ts"
import { formatWikidotFeedDate } from "../src/lib/server/list-pages-feed.ts"
import { buildWikidotSiteChangesFeedXml } from "../src/lib/server/site-changes-feed.ts"

const output = {
  site_name: 'SCP & "Test"',
  items: [
    {
      revision_id: 3_000_000_123,
      revision_number: 7,
      is_new_page: false,
      is_file: false,
      created_at: "2026-10-07T16:53:08Z",
      slug: "forum:page-discussion",
      title: 'A "page" & <title>',
      change_type: "source",
      user_id: 42,
      user_name: "Author & User",
      body_html: "<p>One ]]> two</p>"
    },
    {
      revision_id: 3_000_000_124,
      revision_number: 1,
      is_new_page: true,
      is_file: false,
      created_at: "2026-10-07T15:00:00Z",
      slug: "new-page",
      title: "New page",
      change_type: "new page",
      user_id: 43,
      user_name: "Another <author>",
      body_html: "<p>Fresh</p>"
    }
  ]
}

test("site changes RSS reports the frozen channel and newest-first bounded rows", () => {
  const xml = buildWikidotSiteChangesFeedXml(
    "https://scp-wiki.wikijump.localhost/feed/site-changes.xml",
    output,
    new Date("2026-10-07T16:54:02Z")
  )

  assert.match(
    xml,
    /^<\?xml version="1\.0" encoding="UTF-8" \?>\n<rss version="2\.0" xmlns:content=/
  )
  assert.match(
    xml,
    /<title>Recent page changes from site "SCP &amp; &quot;Test&quot;" \(a Wikidot site\)<\/title>/
  )
  assert.match(xml, /<link>https:\/\/scp-wiki\.wikijump\.localhost<\/link>/)
  assert.match(xml, /<lastBuildDate>Wed, 07 Oct 2026 16:54:02 \+0000<\/lastBuildDate>/)
  assert.equal((xml.match(/<item>/gu) ?? []).length, 2)
  assert.match(
    xml,
    /<guid>http:\/\/scp-wiki\.wikijump\.localhost\/forum:page-discussion#revision-3000000123<\/guid>/
  )
  assert.match(
    xml,
    /<title>&quot;A &quot;page&quot; &amp; &lt;title&gt;&quot; - source change<\/title>/
  )
  assert.match(
    xml,
    /<link>https:\/\/scp-wiki\.wikijump\.localhost\/forum:page-discussion<\/link>/
  )
  assert.match(
    xml,
    /<description>Page: &lt;a href=&quot;https:\/\/scp-wiki\.wikijump\.localhost\/forum:page-discussion&quot;&gt;A &amp;quot;page&amp;quot; &amp;amp; &amp;lt;title&amp;gt;&lt;\/a&gt;/
  )
  assert.match(xml, /Current revision number: rev\. 7/)
  assert.match(xml, /Date changed: Wed, 07 Oct 2026 16:53:08 \+0000/)
  assert.match(xml, /Change type: source/)
  assert.match(xml, /By: Author &amp;amp; User/)
  assert.match(xml, /Page content preview: &lt;p&gt;One \]\]&gt; two&lt;\/p&gt;/)
  assert.match(xml, /<pubDate>Wed, 07 Oct 2026 16:53:08 \+0000<\/pubDate>/)
  assert.match(
    xml,
    /<!\[CDATA\[\n\t\t\t\t<p>One \]\]\]\]><!\[CDATA\[> two<\/p>\n\t\t\t\t\]\]>/
  )
})

test("site changes RSS item titles use the per-row change type", () => {
  const xml = buildWikidotSiteChangesFeedXml(
    "https://scp-wiki.wikijump.localhost/feed/site-changes.xml",
    output,
    new Date("2026-10-07T16:54:02Z")
  )

  assert.match(xml, /<title>&quot;New page&quot; - new page change<\/title>/)
  assert.match(xml, /Current revision number: new/)
  assert.match(
    xml,
    /<guid>http:\/\/scp-wiki\.wikijump\.localhost\/new-page#revision-3000000124<\/guid>/
  )
  assert.match(xml, /By: Another &amp;lt;author&amp;gt;/)
})

test("an empty site still produces the frozen channel shape", () => {
  const xml = buildWikidotSiteChangesFeedXml(
    "https://scp-wiki.wikijump.localhost/feed/site-changes.xml",
    { site_name: "Empty", items: [] },
    new Date("2026-10-07T16:54:02Z")
  )

  assert.equal((xml.match(/<item>/gu) ?? []).length, 0)
  assert.match(
    xml,
    /<title>Recent page changes from site "Empty" \(a Wikidot site\)<\/title>/
  )
  assert.equal(
    formatWikidotFeedDate(new Date("2026-10-07T16:53:08Z")),
    "Wed, 07 Oct 2026 16:53:08 +0000"
  )
})

test("site changes RSS escapes markup in user-controlled description fields", () => {
  const xml = buildWikidotSiteChangesFeedXml(
    "https://pentest.wikijump.localhost/feed/site-changes.xml",
    {
      site_name: "Pentest",
      items: [
        {
          revision_id: 3_000_000_200,
          revision_number: 1,
          is_new_page: true,
          is_file: false,
          created_at: "2026-11-18T11:41:44Z",
          slug: "artex-i608-xss",
          title:
            "ARTEX608XSS <img src=x onerror=window.__ARTEX608=1> </title><script>window.__ARTEX608_SCRIPT=1</script>",
          change_type: "new page",
          user_id: 20001954,
          user_name: "<b onmouseover=alert(3)>eve</b>",
          body_html: "<p>Body</p>"
        }
      ]
    },
    new Date("2026-11-18T11:42:00Z")
  )

  // Simulate a feed consumer: one pass of XML decoding of the description,
  // after which the fragment is treated as HTML.
  const rawDescription = /<description>([\s\S]*?)<\/description>/u.exec(xml)?.[1]
  assert.ok(rawDescription)
  const entities: Record<string, string> = {
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#039;": "'",
    "&amp;": "&"
  }
  const decoded = rawDescription.replace(
    /&(?:lt|gt|quot|#039|amp);/gu,
    (entity) => entities[entity] ?? entity
  )

  // The intended anchor markup survives as markup...
  assert.match(
    decoded,
    /Page: <a href="https:\/\/pentest\.wikijump\.localhost\/artex-i608-xss">/
  )
  // ...while the attacker-controlled title and user name are inert text.
  assert.ok(!decoded.includes("<img"), decoded)
  assert.ok(!decoded.includes("<script"), decoded)
  assert.ok(!decoded.includes("<b onmouseover"), decoded)
  assert.ok(decoded.includes("&lt;img src=x onerror=window.__ARTEX608=1&gt;"))
  assert.ok(decoded.includes("&lt;b onmouseover=alert(3)&gt;eve&lt;/b&gt;"))
})

test("site changes RSS strips XML-invalid C0 controls from title and user fields", () => {
  const xml = buildWikidotSiteChangesFeedXml(
    "https://pentest.wikijump.localhost/feed/site-changes.xml",
    {
      site_name: "Site\u0001Name\u001f",
      items: [
        {
          revision_id: 3_000_000_300,
          revision_number: 2,
          is_new_page: false,
          is_file: false,
          created_at: "2026-11-18T11:41:44Z",
          slug: "artex-c0",
          title: "A\u0001B\u001fC<&>\"'\t\r\nD",
          change_type: "source",
          user_id: 20001954,
          user_name: "Eve\u0001\u001f",
          body_html: "<p>Body</p>"
        }
      ]
    },
    new Date("2026-11-18T11:42:00Z")
  )

  assert.ok(!hasInvalidXmlC0(xml))
  assert.ok(xml.includes('Recent page changes from site "SiteName" (a Wikidot site)'))
  assert.ok(
    xml.includes("&quot;ABC&lt;&amp;&gt;&quot;&#039;\t\r\nD&quot; - source change"),
    "title keeps valid whitespace and existing escaping"
  )
  assert.ok(xml.includes("By: Eve"))
})

test("site changes RSS strips XML-invalid C0 controls from CDATA body content", () => {
  const xml = buildWikidotSiteChangesFeedXml(
    "https://pentest.wikijump.localhost/feed/site-changes.xml",
    {
      site_name: "Site",
      items: [
        {
          revision_id: 3_000_000_301,
          revision_number: 3,
          is_new_page: false,
          is_file: false,
          created_at: "2026-11-18T11:41:44Z",
          slug: "artex-cdata",
          title: "Body C0",
          change_type: "source",
          user_id: 20001954,
          user_name: "Author",
          body_html: "<p>A\u0001B\u001fC\t\n\r & <em>markup</em></p>"
        }
      ]
    },
    new Date("2026-11-18T11:42:00Z")
  )

  assert.ok(!hasInvalidXmlC0(xml))
  assert.ok(
    xml.includes(
      "\t\t\t\t<![CDATA[\n\t\t\t\t<p>ABC\t\n\r & <em>markup</em></p>\n\t\t\t\t]]>"
    ),
    "valid whitespace and markup in the body stay byte-identical"
  )
  assert.equal(
    (xml.match(/<!\[CDATA\[/gu) ?? []).length,
    (xml.match(/\]\]>/gu) ?? []).length,
    "CDATA sections stay balanced"
  )
})

test("site changes RSS keeps the CDATA ]]> split when body controls are present", () => {
  const xml = buildWikidotSiteChangesFeedXml(
    "https://pentest.wikijump.localhost/feed/site-changes.xml",
    {
      site_name: "Site",
      items: [
        {
          revision_id: 3_000_000_302,
          revision_number: 4,
          is_new_page: false,
          is_file: false,
          created_at: "2026-11-18T11:41:44Z",
          slug: "artex-cdata-split",
          title: "Body C0 split",
          change_type: "source",
          user_id: 20001954,
          user_name: "Author",
          body_html: "<p>\u0001one]]>two\u001f</p>"
        },
        {
          revision_id: 3_000_000_303,
          revision_number: 5,
          is_new_page: false,
          is_file: false,
          created_at: "2026-11-18T11:41:44Z",
          slug: "artex-cdata-joined",
          title: "Body C0 joined",
          change_type: "source",
          user_id: 20001954,
          user_name: "Author",
          body_html: "<p>]]\u0001></p>"
        }
      ]
    },
    new Date("2026-11-18T11:42:00Z")
  )

  assert.ok(!hasInvalidXmlC0(xml))
  assert.ok(xml.includes("<p>one]]]]><![CDATA[>two</p>"))
  assert.ok(xml.includes("<p>]]]]><![CDATA[></p>"))
  assert.equal(
    (xml.match(/<!\[CDATA\[/gu) ?? []).length,
    (xml.match(/\]\]>/gu) ?? []).length,
    "CDATA sections stay balanced"
  )
})
