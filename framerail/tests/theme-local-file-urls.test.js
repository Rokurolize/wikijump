import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  customThemeHeadHtml,
  localizeSiteFileUrl,
  localizeSiteFileUrlsInCss,
  resolveExternalThemeHref
} from "../src/lib/site-settings.js"

const SITE = { slug: "scp-wiki", from_wikidot: true }
const FILES = "scp-wiki.wjfiles.localhost"

describe("theme local file URL rewriting", () => {
  it("rewrites same-site wdfiles attachments to the local files authority", () => {
    assert.equal(
      localizeSiteFileUrl(
        "https://scp-wiki.wdfiles.com/local--files/docs/font-bauhaus.css",
        SITE,
        FILES
      ),
      "https://scp-wiki.wjfiles.localhost/local--files/docs/font-bauhaus.css"
    )
    assert.equal(
      localizeSiteFileUrl(
        "http://scp-wiki.wdfiles.com/local--files/a/b.png",
        SITE,
        FILES
      ),
      "https://scp-wiki.wjfiles.localhost/local--files/a/b.png"
    )
    assert.equal(
      localizeSiteFileUrl("//scp-wiki.wdfiles.com/local--files/a.css", SITE, FILES),
      "https://scp-wiki.wjfiles.localhost/local--files/a.css"
    )
  })

  it("preserves query, fragment, and encoding through the rewrite", () => {
    assert.equal(
      localizeSiteFileUrl(
        "https://SCP-WIKI.wdfiles.com/local--files/a%20b/c.css?download=true#full",
        SITE,
        FILES
      ),
      "https://scp-wiki.wjfiles.localhost/local--files/a%20b/c.css?download=true#full"
    )
  })

  it("keeps everything without same-site evidence literal", () => {
    const literal = [
      "https://cdn.scpwiki.com/foo/bar.css",
      "https://nu-scptheme.github.io/main.css",
      "https://www.wikidot.com/local--files/x/y.css",
      "https://www.wdfiles.com/local--files/x/y.css",
      "https://scp-wiki.wdfiles.com/local--code/theme/1",
      "https://scp-wiki.wdfiles.com/local--files/",
      "https://scp-jp.wdfiles.com/local--files/x/y.css",
      "https://other.wdfiles.com.evil.example.com/local--files/x.css",
      "https://user@scp-wiki.wdfiles.com/local--files/x.css",
      "https://scp-wiki.wdfiles.com:8443/local--files/x.css",
      "https://scp-wiki.wdfiles.com/not-files/x.css",
      "/local--files/relative.css",
      "data:text/css,body{}",
      "",
      null,
      undefined,
      42
    ]
    for (const url of literal) {
      assert.equal(localizeSiteFileUrl(url, SITE, FILES), null, String(url))
    }
    assert.equal(
      localizeSiteFileUrl(
        "https://scp-wiki.wdfiles.com/local--files/x.css",
        { slug: "scp-wiki", from_wikidot: false },
        FILES
      ),
      null
    )
    assert.equal(
      localizeSiteFileUrl("https://scp-wiki.wdfiles.com/local--files/x.css", null, FILES),
      null
    )
    assert.equal(
      localizeSiteFileUrl(
        "https://scp-wiki.wdfiles.com/local--files/x.css",
        SITE,
        "https://evil.example.com"
      ),
      null
    )
    assert.equal(
      localizeSiteFileUrl("https://scp-wiki.wdfiles.com/local--files/x.css", SITE, ""),
      null
    )
  })

  it("rewrites only evidenced urls inside stored custom css", () => {
    const css = [
      '@import url("https://scp-wiki.wdfiles.com/local--files/t/a.css");',
      "@import 'https://scp-jp.wdfiles.com/local--files/t/b.css';",
      '@import "https://scp-wiki.wdfiles.com/local--files/t/c.css";',
      ".x{background:url(https://scp-wiki.wdfiles.com/local--files/i/d.png?download=true#full)}",
      ".y{background:url(https://cdn.scpwiki.com/e/f.png)}",
      ".z{background:url(data:image/png;base64,AAA)}"
    ].join("\n")
    assert.equal(
      localizeSiteFileUrlsInCss(css, SITE, FILES),
      [
        '@import url("https://scp-wiki.wjfiles.localhost/local--files/t/a.css");',
        "@import 'https://scp-jp.wdfiles.com/local--files/t/b.css';",
        '@import "https://scp-wiki.wjfiles.localhost/local--files/t/c.css";',
        ".x{background:url(https://scp-wiki.wjfiles.localhost/local--files/i/d.png?download=true#full)}",
        ".y{background:url(https://cdn.scpwiki.com/e/f.png)}",
        ".z{background:url(data:image/png;base64,AAA)}"
      ].join("\n")
    )
  })

  it("keeps custom css byte-identical without site evidence", () => {
    const css = '@import url("https://scp-wiki.wdfiles.com/local--files/t/a.css");'
    assert.equal(localizeSiteFileUrlsInCss(css, null, FILES), css)
    assert.equal(localizeSiteFileUrlsInCss(css, SITE, null), css)
  })

  it("resolves external theme hrefs with the same evidence rule", () => {
    assert.equal(
      resolveExternalThemeHref(
        {
          type: "external",
          url: "https://scp-wiki.wdfiles.com/local--files/component:theme/font-bauhaus.css"
        },
        SITE,
        FILES
      ),
      "https://scp-wiki.wjfiles.localhost/local--files/component:theme/font-bauhaus.css"
    )
    assert.equal(
      resolveExternalThemeHref(
        { type: "external", url: "https://nu-scptheme.github.io/main.css" },
        SITE,
        FILES
      ),
      "https://nu-scptheme.github.io/main.css"
    )
    assert.equal(resolveExternalThemeHref({ type: "built_in", id: 1 }, SITE, FILES), null)
    assert.equal(resolveExternalThemeHref({ type: "custom", css: "x{}" }, SITE, FILES), null)
  })

  it("emits rewritten custom css in the head helper only with evidence", () => {
    const theme = {
      type: "custom",
      css: '.x{background:url("https://scp-wiki.wdfiles.com/local--files/i/a.png")}'
    }
    assert.equal(
      customThemeHeadHtml(theme, SITE, FILES),
      '<style data-wikidot-site-theme>.x{background:url("https://scp-wiki.wjfiles.localhost/local--files/i/a.png")}</style>'
    )
    assert.equal(
      customThemeHeadHtml(theme),
      '<style data-wikidot-site-theme>.x{background:url("https://scp-wiki.wdfiles.com/local--files/i/a.png")}</style>'
    )
    assert.equal(customThemeHeadHtml({ type: "built_in", id: 1 }, SITE, FILES), "")
  })
})
