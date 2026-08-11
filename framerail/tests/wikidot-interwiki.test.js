import { strict as assert } from "node:assert"
import test from "node:test"

import {
  buildWikidotInterwikiFrameHtml,
  extractWikidotInterwikiLinks
} from "../src/lib/wikidot/wikidot-interwiki.js"
import {
  isUsableStyleFrameCss,
  localizeWikidotThemeUrl
} from "../src/lib/wikidot/wikidot-styleframe-contract.js"
import {
  extractWikidotStyleFrameDeclarations,
  extractWikidotStyleFrameStylesheets
} from "../src/lib/wikidot/wikidot-styleframe-stylesheets.js"
import { buildWikidotStyleFrameHtml } from "../src/lib/wikidot/wikidot-styleframe.js"

test("builds an inert styleFrame document without parent access", () => {
  const html = buildWikidotStyleFrameHtml({
    priority: "2",
    themes: ["https://example.com/theme.css"],
    css: ".fixture { color: red; }"
  })

  assert.match(html, /wikidot-style-theme-count" content="1"/u)
  assert.match(html, /<ul hidden><li>https:\/\/example\.com\/theme\.css<\/li><\/ul>/u)
  assert.match(html, /<style>\.fixture \{ color: red; \}<\/style>/u)
  assert.doesNotMatch(html, /<script/u)
  assert.doesNotMatch(html, /(?:window\.)?parent|targetWindow\.document/u)
})

test("extracts priority-ordered styleFrame stylesheets for initial document CSS", () => {
  assert.deepEqual(
    extractWikidotStyleFrameStylesheets(
      [
        '<iframe src="/-/wikidot-interwiki/styleFrame.html?priority=2&amp;theme=https%3A%2F%2Fcdn.scpwiki.com%2Ftheme%2Fen%2Fbasalt%2Fbasalt-bedrock-min.css&amp;css=%7B%24css%7D"></iframe>',
        '<iframe src="/-/wikidot-interwiki/styleFrame.html?priority=1&theme=https%3A%2F%2Fscp-wiki.wdfiles.com%2Flocal--code%2Ftheme%253Abasalt%2F1"></iframe>'
      ],
      "https://scp-wiki.wikijump.localhost"
    ),
    [
      {
        href: "https://scp-wiki.wjfiles.localhost/local--code/theme%3Abasalt/1",
        priority: "1",
        priorityValue: 1,
        order: 1
      },
      {
        href: "https://cdn.scpwiki.com/theme/en/basalt/basalt-bedrock-min.css",
        priority: "2",
        priorityValue: 2,
        order: 0
      }
    ]
  )
})

test("extracts external and inline styleFrame CSS in canonical cascade order", () => {
  assert.deepEqual(
    extractWikidotStyleFrameDeclarations(
      [
        '<iframe src="/-/wikidot-interwiki/styleFrame.html?priority=2&amp;theme=https%3A%2F%2Fexample.com%2Flate.css&amp;css=.late%7Bdisplay%3Anone%7D"></iframe>',
        '<iframe src="/-/wikidot-interwiki/styleFrame.html?priority=1&amp;css=.early%7Bdisplay%3Ablock%7D"></iframe>'
      ],
      "https://scp-wiki.wikijump.localhost"
    ),
    [
      {
        css: ".early{display:block}",
        kind: "inline",
        order: 2,
        priority: "1",
        priorityValue: 1
      },
      {
        href: "https://example.com/late.css",
        kind: "theme",
        order: 0,
        priority: "2",
        priorityValue: 2
      },
      {
        css: ".late{display:none}",
        kind: "inline",
        order: 1,
        priority: "2",
        priorityValue: 2
      }
    ]
  )
})

test("does not preload a styleFrame theme already imported by page CSS", () => {
  assert.deepEqual(
    extractWikidotStyleFrameDeclarations(
      [
        '<iframe src="/-/wikidot-interwiki/styleFrame.html?priority=1&amp;theme=https%3A%2F%2Fscp-wiki.wdfiles.com%2Flocal--code%2Ftheme%253Ay2k%2F1"></iframe>'
      ],
      "https://scp-wiki.wikijump.localhost",
      [
        '@import url("https://scp-wiki.wdfiles.com/local--code/theme%3Ay2k/1"); .page-rule { color: red; }'
      ]
    ),
    []
  )
})

const cromPage = {
  translations: [
    { url: "http://scp-wiki-cn.wikidot.com/1231-warning" },
    { url: "https://fondationscp.wikidot.com/1231-warning" },
    { url: "https://scp-jp.wikidot.com/1231-warning" },
    { url: "https://scpko.wikidot.com/1231-warning" },
    { url: "https://scpfoundation.net/1231-warning" },
    { url: "https://scp-vn.wikidot.com/1231-warning" }
  ],
  translationOf: null
}

test("builds SCP interwiki language links from Crom translations", () => {
  assert.deepEqual(
    extractWikidotInterwikiLinks({
      community: "scp",
      lang: "en",
      sourcePath: "1231-warning",
      page: cromPage
    }).map((link) => link.label),
    ["中文", "Français", "日本語", "한국어", "Русский", "Tiếng Việt"]
  )
})

test("renders Wikidot-compatible interwiki visible text for translated SCP pages", () => {
  const html = buildWikidotInterwikiFrameHtml({
    community: "scp",
    lang: "en",
    pagename: "1231-warning",
    page: cromPage
  })

  assert.match(html, /In other languages/)
  assert.doesNotMatch(html, /IN OTHER LANGUAGES/)
  assert.match(html, /中文<\/a><\/div> <div class="menu-item" name="fr"/)
  assert.match(html, /中文/)
  assert.match(html, /Français/)
  assert.match(html, /日本語/)
  assert.match(html, /한국어/)
  assert.match(html, /Русский/)
  assert.match(html, /Tiếng Việt/)
  assert.doesNotMatch(html, /English/)
})

test("keeps non-placeholder styleFrame inline CSS safe", () => {
  const html = buildWikidotStyleFrameHtml({
    css: "body::before { content: '</style>'; }"
  })

  assert.equal(isUsableStyleFrameCss("{$css}"), false)
  assert.equal(isUsableStyleFrameCss("$css"), false)
  assert.equal(isUsableStyleFrameCss(" body { color: red } "), true)
  assert.match(html, /<style>body::before \{ content: '<\\\/style>'; \}<\/style>/)
  assert.doesNotMatch(html, /<script/u)
})

test("localizes Wikidot local file and code theme URLs to the local file host", () => {
  assert.equal(
    localizeWikidotThemeUrl(
      "https://scp-wiki.wdfiles.com/local--code/theme%3Abasalt/1",
      "https://scp-wiki.wikijump.localhost"
    ),
    "https://scp-wiki.wjfiles.localhost/local--code/theme%3Abasalt/1"
  )
  assert.equal(
    localizeWikidotThemeUrl(
      "https://scp-wiki.wdfiles.com/local--code/theme:basalt/1",
      "https://scp-wiki.wikijump.localhost"
    ),
    "https://scp-wiki.wjfiles.localhost/local--code/theme:basalt/1"
  )
  assert.equal(
    localizeWikidotThemeUrl(
      "https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css",
      "https://scp-wiki.wikijump.localhost"
    ),
    "https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css"
  )
})
