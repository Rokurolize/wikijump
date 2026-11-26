import assert from "node:assert/strict"
import test from "node:test"

import { hasInvalidXmlC0 } from "../src/lib/server/feed-xml.ts"
import {
  InvalidWikidotListPagesFeedPath,
  buildWikidotListPagesFeedXml,
  formatWikidotFeedDate,
  parseWikidotListPagesFeedPath,
  wikidotListPagesFeedErrorBody,
  wikidotListPagesFeedSelectorError
} from "../src/lib/server/list-pages-feed.ts"

test("parses Wikidot feed path pairs with form-style spaces and last-value wins", () => {
  assert.deepEqual(
    parseWikidotListPagesFeedPath(
      "https://sandbox.example/feed/pages/t/First/t/Last+Title/d/A%26B/h/blog%3A_start/category/%2A%2C-deleted/tags/%2Bred%2C-blue/unknown/value"
    ),
    {
      title: "Last Title",
      description: "A&B",
      home: "blog:_start",
      selectors: {
        category: "*,-deleted",
        tags: "+red,-blue"
      }
    }
  )
})

test("parses the feed windowing parameters from the path", () => {
  assert.deepEqual(
    parseWikidotListPagesFeedPath(
      "https://sandbox.example/feed/pages/category/news/limit/5/rssLimit/2/offset/3/order/titleDesc/t/News"
    ),
    {
      title: "News",
      description: "",
      home: null,
      selectors: {
        category: "news",
        limit: "5",
        rssLimit: "2",
        offset: "3",
        order: "titleDesc"
      }
    }
  )
})

test("rejects non-numeric feed windowing parameters", () => {
  assert.equal(
    wikidotListPagesFeedSelectorError({ limit: "five" }),
    "Invalid limit argument."
  )
  assert.equal(
    wikidotListPagesFeedSelectorError({ rssLimit: "-1" }),
    "Invalid limit argument."
  )
  assert.equal(
    wikidotListPagesFeedSelectorError({ offset: "1.5" }),
    "Invalid offset argument."
  )
  assert.equal(wikidotListPagesFeedSelectorError({ limit: "10", offset: "0" }), null)
})

test("accepts more than one hundred selector values and caps oversized selectors cleanly", () => {
  const values = Array.from({ length: 101 }, (_, index) => `zzNoMatchCat${index}`).join(
    ","
  )
  const path = parseWikidotListPagesFeedPath(
    `https://sandbox.example/feed/pages/category/${values}/order/updated_at%20desc/limit/20/offset/0`
  )
  assert.ok(path)
  assert.equal(path.selectors.category, values)
  assert.equal(wikidotListPagesFeedSelectorError(path.selectors), null)

  const oversized = "x".repeat(8 * 1024 + 1)
  assert.equal(
    wikidotListPagesFeedSelectorError({ tags: oversized }),
    "Wikidot ListPages feed selector is too long (maximum 8192 bytes)."
  )
  assert.equal(wikidotListPagesFeedSelectorError({ tags: "x".repeat(8 * 1024) }), null)
})

test("pairs arguments sequentially and treats an orphan key as empty", () => {
  assert.deepEqual(
    parseWikidotListPagesFeedPath("https://sandbox.example/feed/pages/t/d/foo"),
    {
      title: "d",
      description: "",
      home: null,
      selectors: {}
    }
  )
  assert.deepEqual(
    parseWikidotListPagesFeedPath("https://sandbox.example/feed/pages/t"),
    {
      title: "",
      description: "",
      home: null,
      selectors: {}
    }
  )
})

test("rejects malformed percent escapes and paths outside the feed route", () => {
  assert.equal(parseWikidotListPagesFeedPath("https://sandbox.example/feed/pages"), null)
  assert.throws(
    () => parseWikidotListPagesFeedPath("https://sandbox.example/feed/pages/t/%ZZ"),
    InvalidWikidotListPagesFeedPath
  )
})

test("recognizes the feed endpoint's narrower selector grammar", () => {
  for (const pagetype of ["*", "hidden", "normal"]) {
    assert.equal(wikidotListPagesFeedSelectorError({ pagetype }), null)
  }
  assert.equal(
    wikidotListPagesFeedSelectorError({ pagetype: "all" }),
    "Invalid pagetype attribute."
  )

  for (const rating of ["0", "-1", ">0", ">=0", "<0", "<=0", "<>0", "=0"]) {
    assert.equal(wikidotListPagesFeedSelectorError({ rating }), null)
  }
  for (const rating of ["+1", "1.5", "!=0", "0foo"]) {
    assert.equal(
      wikidotListPagesFeedSelectorError({ rating }),
      "Invalid rating argument."
    )
  }

  assert.equal(wikidotListPagesFeedSelectorError({ range: "." }), null)
  assert.equal(
    wikidotListPagesFeedSelectorError({ range: "before" }),
    "Invalid range argument."
  )
})

test("renders RSS metadata, items, escaped descriptions, and safe CDATA", () => {
  const path = parseWikidotListPagesFeedPath(
    "https://sandbox.example/feed/pages/t/%3CFeed%26/d/%22Description%22/h/blog%3A_start"
  )
  assert.ok(path)
  const xml = buildWikidotListPagesFeedXml(
    "https://sandbox.example/feed/pages/t/test",
    path,
    {
      items: [
        {
          slug: "category:one&two",
          title: "<One>",
          created_at: "2026-07-22T23:23:22Z",
          body_html: "<p>body ]]> & text</p>",
          created_by_html: '<span class="printuser">A & B</span>'
        }
      ]
    },
    new Date("2026-07-27T09:53:12Z")
  )

  assert.ok(xml.includes("<title>&lt;Feed&amp;</title>"))
  assert.ok(xml.includes("<description>&quot;Description&quot;</description>"))
  assert.ok(xml.includes("<link>blog:_start</link>"))
  assert.ok(xml.includes("<guid>http://sandbox.example/category:one&amp;two</guid>"))
  assert.ok(xml.includes("<link>https://sandbox.example/category:one&amp;two</link>"))
  assert.ok(xml.includes("<title>&lt;One&gt;</title>"))
  assert.ok(xml.includes("Wed, 22 Jul 2026 23:23:22 +0000"))
  assert.ok(xml.includes("Mon, 27 Jul 2026 09:53:12 +0000"))
  assert.ok(xml.includes("&lt;p&gt;body ]]&gt; &amp; text&lt;/p&gt;"))
  assert.ok(xml.includes("]]]]><![CDATA[>"))
  assert.doesNotMatch(xml, /<script>/)
})

test("pages RSS strips XML-invalid C0 controls from channel and item titles", () => {
  const path = parseWikidotListPagesFeedPath(
    "https://sandbox.example/feed/pages/t/%01Feed%1F/d/%01Description%1F"
  )
  assert.ok(path)
  const xml = buildWikidotListPagesFeedXml(
    "https://sandbox.example/feed/pages/t/test",
    path,
    {
      items: [
        {
          slug: "category:one",
          title: "A\u0001B\u001fC<&>\"'\t\n\rD",
          created_at: "2026-07-22T23:23:22Z",
          body_html: "<p>body</p>",
          created_by_html: "author"
        }
      ]
    },
    new Date("2026-07-27T09:53:12Z")
  )

  assert.ok(!hasInvalidXmlC0(xml))
  assert.ok(xml.includes("<title>Feed</title>"))
  assert.ok(xml.includes("<description>Description</description>"))
  assert.ok(
    xml.includes("ABC&lt;&amp;&gt;&quot;&#039;\t\n\rD"),
    "valid whitespace and metacharacter escaping survive the strip"
  )
})

test("pages RSS strips XML-invalid C0 controls from CDATA body content", () => {
  const path = parseWikidotListPagesFeedPath(
    "https://sandbox.example/feed/pages/t/Body%20C0"
  )
  assert.ok(path)
  const xml = buildWikidotListPagesFeedXml(
    "https://sandbox.example/feed/pages/t/body-c0",
    path,
    {
      items: [
        {
          slug: "category:one",
          title: "Body C0",
          created_at: "2026-07-22T23:23:22Z",
          body_html: "<p>A\u0001B\u001fC\t\n\r & <em>markup</em></p>",
          created_by_html: "author"
        }
      ]
    },
    new Date("2026-07-27T09:53:12Z")
  )

  assert.ok(!hasInvalidXmlC0(xml))
  assert.ok(
    xml.includes("\t\t\t\t\t\t <p>ABC\t\n\r & <em>markup</em></p>\n<p>by author</p> "),
    "valid whitespace and markup in the body stay byte-identical"
  )
  assert.equal(
    (xml.match(/<!\[CDATA\[/gu) ?? []).length,
    (xml.match(/\]\]>/gu) ?? []).length,
    "CDATA sections stay balanced"
  )
})

test("pages RSS keeps the CDATA ]]> split when body controls are present", () => {
  const path = parseWikidotListPagesFeedPath("https://sandbox.example/feed/pages/t/split")
  assert.ok(path)
  const xml = buildWikidotListPagesFeedXml(
    "https://sandbox.example/feed/pages/t/split",
    path,
    {
      items: [
        {
          slug: "category:two",
          title: "Body C0 split",
          created_at: "2026-07-22T23:23:22Z",
          body_html: "<p>\u0001one]]>two\u001f</p>",
          created_by_html: "ed\u0001itor"
        }
      ]
    },
    new Date("2026-07-27T09:53:12Z")
  )

  assert.ok(!hasInvalidXmlC0(xml))
  assert.ok(xml.includes("<p>one]]]]><![CDATA[>two</p>\n<p>by editor</p>"))
  assert.equal(
    (xml.match(/<!\[CDATA\[/gu) ?? []).length,
    (xml.match(/\]\]>/gu) ?? []).length,
    "CDATA sections stay balanced"
  )
})

test("formats the live generic feed error without exposing a stack trace", () => {
  assert.equal(
    wikidotListPagesFeedErrorBody("Invalid rating argument."),
    "A nasty error has occurred. If the problem repeats, please fill (if possible) a bug report.<br/><br/>Invalid rating argument."
  )
  assert.equal(
    formatWikidotFeedDate(new Date("2026-01-02T03:04:05Z")),
    "Fri, 02 Jan 2026 03:04:05 +0000"
  )
})
