import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  WIKIDOT_SITE_LANGUAGES,
  isWikidotSiteLanguage
} from "../src/lib/admin/wikidot-site-languages.js"
import {
  googleAnalyticsQueueScript,
  googleAnalyticsHeadHtml,
  normalizeGoogleAnalyticsSettings,
  normalizeThemeSetting
} from "../src/lib/site-settings.js"

describe("Wikidot site settings foundation", () => {
  it("uses the captured Wiki Settings language values in source order", () => {
    assert.equal(WIKIDOT_SITE_LANGUAGES.length, 121)
    assert.deepEqual(WIKIDOT_SITE_LANGUAGES.slice(0, 4), [
      { group: "Stable", value: "en", label: "English" },
      {
        group: "Stable",
        value: "en-au-mate",
        label: "↳English Australian Mate"
      },
      {
        group: "Stable",
        value: "en-corrections",
        label: "↳English (Corrections)"
      },
      {
        group: "Stable",
        value: "en-pirate",
        label: "↳English (Pirate Speak)"
      }
    ])
    assert.deepEqual(WIKIDOT_SITE_LANGUAGES.at(-1), {
      group: "Experimental",
      value: "zy-tr",
      label: "↳Zhuyin Fuhao (Traditional)"
    })
    assert.equal(isWikidotSiteLanguage("ja-corrections"), true)
    assert.equal(isWikidotSiteLanguage("en-US"), false)
  })

  it("keeps analytics disabled by default and emits only the observed queue entries", () => {
    assert.deepEqual(normalizeGoogleAnalyticsSettings(undefined), {
      enabled: false,
      profile: null
    })
    assert.equal(
      googleAnalyticsQueueScript({ enabled: false, profile: "UA-00000000-2" }),
      ""
    )
    assert.equal(googleAnalyticsQueueScript({ enabled: true, profile: "G-ABC123" }), "")
    assert.equal(
      googleAnalyticsQueueScript({ enabled: true, profile: "UA-00000000-2" }),
      "_gaq.push(['userTracker._setAccount', 'UA-00000000-2']);\n_gaq.push(['userTracker._trackPageview']);"
    )
    assert.equal(googleAnalyticsHeadHtml(undefined), "")
    assert.equal(
      googleAnalyticsHeadHtml({
        enabled: true,
        profile: "UA-1-2</script><script>alert(1)</script>"
      }),
      ""
    )
    const head = googleAnalyticsHeadHtml({ enabled: true, profile: "UA-1-2" })
    assert.equal(head.startsWith("<script>"), true)
    assert.doesNotMatch(head, /https?:|\.src\s*=|google-analytics\.com/u)
  })

  it("keeps effective theme variants separate for initial head rendering", () => {
    assert.deepEqual(normalizeThemeSetting({ type: "built_in", id: 1 }), {
      type: "built_in",
      id: 1
    })
    assert.deepEqual(
      normalizeThemeSetting({ type: "external", url: "https://themes.example/a.css" }),
      { type: "external", url: "https://themes.example/a.css" }
    )
    assert.deepEqual(
      normalizeThemeSetting({ type: "external", url: "http://themes.example/a.css" }),
      { type: "built_in", id: 1 }
    )
    assert.deepEqual(
      normalizeThemeSetting({ type: "custom", css: "</style><script>x</script>" }),
      { type: "built_in", id: 1 }
    )
  })
})
