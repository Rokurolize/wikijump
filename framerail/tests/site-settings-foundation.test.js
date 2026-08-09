import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

  it("renders the seven general controls in captured order and keeps layout separate", async () => {
    const source = await readFile(
      new URL("../src/routes/[x+2d]/admin/SiteSettings.svelte", import.meta.url),
      "utf8"
    )
    const controls = [
      'name="unixName"',
      'name="name"',
      'name="subtitle"',
      'id="sm-general-language"',
      'id="site-description-field"',
      'id="sm-general-start"',
      'id="sm-general-welcome"'
    ]
    let previous = -1
    for (const control of controls) {
      const index = source.indexOf(control)
      assert.ok(index > previous, `${control} must follow the previous control`)
      previous = index
    }
    assert.match(source, /<form\s+id="sm-general-form"/u)
    assert.doesNotMatch(source, /name="layout"/u)

    const layout = await readFile(
      new URL("../src/routes/[x+2d]/admin/LayoutSettings.svelte", import.meta.url),
      "utf8"
    )
    assert.match(layout, /id="wikijump-layout-settings"/u)
    assert.match(layout, /name="layout"/u)
  })

  it("connects settings to server rendered head and toolbar authority", async () => {
    const source = await readFile(
      new URL("../src/routes/+layout.svelte", import.meta.url),
      "utf8"
    )
    assert.match(source, /normalizeGoogleAnalyticsSettings\(viewData\?\.site_settings/u)
    assert.match(source, /name="wikidot-site-analytics-profile"/u)
    assert.match(source, /normalizeThemeSetting\(viewData\?\.theme\)/u)
    assert.match(source, /\{#if showTopToolbar\}/u)
    assert.doesNotMatch(source, /\{#if useSandboxWikidotChrome\}\s*<div id="navi-bar">/u)

    const template = await readFile(new URL("../src/app.html", import.meta.url), "utf8")
    assert.match(template, /nonce="%sveltekit\.nonce%"/u)
    assert.match(template, /userTracker\._setAccount/u)
    assert.match(template, /userTracker\._trackPageview/u)
    assert.doesNotMatch(
      template,
      /google-analytics\.com|document\.createElement|\.src\s*=/u
    )
  })

  it("routes admin writes through trusted site and revision-bound actions", async () => {
    const actions = await readFile(
      new URL("../src/lib/server/load/admin.ts", import.meta.url),
      "utf8"
    )
    for (const action of [
      "adminAction",
      "analyticsAction",
      "toolbarAction",
      "themeAction",
      "autonumberAction",
      "layoutAction"
    ]) {
      assert.match(actions, new RegExp(`export async function ${action}\\b`, "u"))
    }
    assert.match(actions, /loadTrustedAdminSiteId\(request, form\.data\.siteId\)/u)
    assert.match(actions, /expectedSettingsRevision/u)
    assert.match(actions, /failForActionError\(error, \{ form \}\)/u)

    const client = await readFile(
      new URL("../src/lib/server/deepwell/admin.ts", import.meta.url),
      "utf8"
    )
    assert.match(client, /expected_settings_revision: expectedSettingsRevision/u)
    assert.match(client, /google_analytics: \{ enabled, profile \}/u)
    assert.match(client, /toolbars: \{ top, bottom \}/u)
    assert.match(client, /autonumber_enabled: enabled/u)
  })

  it("serves the observed legacy admin path through the same SSR and action seam", async () => {
    const server = await readFile(
      new URL("../src/routes/_admin/+page.server.ts", import.meta.url),
      "utf8"
    )
    assert.match(
      server,
      /export \{ actions, load \} from "\.\.\/\[x\+2d\]\/admin\/\+page\.server"/u
    )

    const page = await readFile(
      new URL("../src/routes/_admin/+page.svelte", import.meta.url),
      "utf8"
    )
    assert.match(page, /import AdminPage from "\.\.\/\[x\+2d\]\/admin\/\+page\.svelte"/u)
    assert.match(page, /<AdminPage \{data\} \{form\} \{params\} \/>/u)

    const errorPage = await readFile(
      new URL("../src/routes/_admin/+error.svelte", import.meta.url),
      "utf8"
    )
    assert.match(
      errorPage,
      /import AdminError from "\.\.\/\[x\+2d\]\/admin\/\+error\.svelte"/u
    )
    assert.match(errorPage, /<AdminError \/>/u)
  })
})
