import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  buildSitemapIndexXml,
  buildSitemapUrlsetXml,
  InvalidSitemapEntry,
  InvalidSitemapShardPath,
  formatSitemapLastmod,
  parseSitemapShardNumber,
  SITEMAP_ENTRIES_PER_SHARD
} from "../src/lib/server/sitemap.ts"

test("parses shard numbers starting at 1 and rejects anything else", () => {
  assert.equal(parseSitemapShardNumber("1"), 1)
  assert.equal(parseSitemapShardNumber("12"), 12)
  for (const bad of ["0", "01", "-1", "1.5", "1.xml", "", "one", "9007199254740992"]) {
    assert.throws(() => parseSitemapShardNumber(bad), InvalidSitemapShardPath)
  }
})

test("formats RFC 3339 timestamps as sitemap lastmod dates", () => {
  assert.equal(formatSitemapLastmod("2026-05-22T00:00:00+00:00"), "2026-05-22")
  assert.equal(formatSitemapLastmod("2026-07-22T14:03:10Z"), "2026-07-22")
  assert.throws(() => formatSitemapLastmod("2026-05-22"), InvalidSitemapEntry)
  assert.throws(() => formatSitemapLastmod("not a date"), InvalidSitemapEntry)
})

test("builds a sitemap index pointing at each shard page", () => {
  assert.equal(
    buildSitemapIndexXml("https://scp-wiki.example", 2),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `\t<sitemap>\n\t\t<loc>https://scp-wiki.example/sitemap_page_1.xml</loc>\n\t</sitemap>\n` +
      `\t<sitemap>\n\t\t<loc>https://scp-wiki.example/sitemap_page_2.xml</loc>\n\t</sitemap>\n` +
      `</sitemapindex>`
  )
})

test("builds a shard urlset with escaped locations and lastmod dates", () => {
  assert.equal(
    buildSitemapUrlsetXml("https://scp-wiki.example", [
      { slug: "scp-9506", last_modified: "2026-05-22T00:00:00+00:00" },
      { slug: "a&b", last_modified: "2026-07-22T14:03:10+00:00" }
    ]),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `\t<url>\n\t\t<loc>https://scp-wiki.example/scp-9506</loc>\n\t\t<lastmod>2026-05-22</lastmod>\n\t</url>\n` +
      `\t<url>\n\t\t<loc>https://scp-wiki.example/a&amp;b</loc>\n\t\t<lastmod>2026-07-22</lastmod>\n\t</url>\n` +
      `</urlset>`
  )
})

test("represents more than 50,000 public URLs in a bounded sitemap index", () => {
  const xml = buildSitemapIndexXml("https://scp-wiki.example", 51)
  assert.equal((xml.match(/<sitemap>/gu) ?? []).length, 51)
  assert.match(xml, /sitemap_page_51\.xml/u)
  assert.equal(SITEMAP_ENTRIES_PER_SHARD, 1_000)
})

test("public sitemap routes do not forward signed-in cookies to their inventory", async () => {
  for (const route of [
    "../src/routes/sitemap.xml/+server.ts",
    "../src/routes/sitemap_page_[n].xml/+server.ts"
  ]) {
    const source = await readFile(new URL(route, import.meta.url), "utf8")
    assert.match(source, /wikidotSitemap\(siteId, (?:0|shard), \{ siteId \}\)/u, route)
    assert.doesNotMatch(source, /sessionToken|cookies\.get/u, route)
  }
})
