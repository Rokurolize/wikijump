// @ts-nocheck
import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer as createHttpServer } from "node:http"
import { fileURLToPath } from "node:url"
import { after, before, describe, it } from "node:test"

import { createServer as createViteServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const siteId = 17
const settingsRevision = 4
const sessionToken = "site-settings-session"

let previousWorkingDirectory
let vite
let render
let readable
let client
let originalClientRequest
let adminData
let siteSettingsComponent
let layoutSettingsComponent
let rootLayoutComponent
let canonicalAdminPage
let legacyAdminPage
let canonicalAdminError
let legacyAdminError
let canonicalAdminServer
let legacyAdminServer

const requestContext = (data, { error = null, routeId = "/[x+2d]/admin" } = {}) => {
  const page = {
    data,
    error,
    form: null,
    params: {},
    route: { id: routeId },
    state: {},
    status: error ? 403 : 200,
    url: new URL("https://wikijump.test/--/admin")
  }
  const updated = readable(false)
  return new Map([
    ["__request__", { page }],
    [
      "__svelte__",
      {
        page: readable(page),
        navigating: readable(null),
        updated: { subscribe: updated.subscribe, check: async () => false }
      }
    ]
  ])
}

const renderComponent = (component, props, context = requestContext(adminData)) => {
  return render(component, { props, context })
}

const actionEvent = (action, fields, trustedSiteId = siteId) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, String(value))
  return {
    request: new Request(`https://wikijump.test/--/admin?/${action}`, {
      method: "POST",
      body: data,
      headers: {
        "X-Wikijump-Site-Id": String(trustedSiteId),
        "X-Wikijump-Site-Slug": "test"
      }
    }),
    cookies: {
      get(name) {
        assert.equal(name, "wikijump_token")
        return sessionToken
      }
    },
    getClientAddress: () => "192.0.2.63"
  }
}

before(async () => {
  previousWorkingDirectory = process.cwd()
  process.chdir(root)
  vite = await createViteServer({
    root,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
  })

  ;({ render } = await vite.ssrLoadModule("svelte/server"))
  ;({ readable } = await vite.ssrLoadModule("svelte/store"))
  ;({ client } = await vite.ssrLoadModule("/src/lib/server/deepwell/index.ts"))
  originalClientRequest = client.request

  const { loadAdminPage } = await vite.ssrLoadModule("/src/lib/server/load/admin.ts")
  client.request = async (method) => {
    if (method === "admin_view") {
      return { type: "site_found", data: { categories: [], page_templates: [] } }
    }
    if (method === "translate") return {}
    throw new Error(`Unexpected Deepwell method ${method}`)
  }
  try {
    const site = {
      site_id: siteId,
      settings_revision: settingsRevision,
      slug: "test",
      name: "Test Wiki",
      tagline: "Compatibility fixture",
      description: "Site settings public-boundary fixture",
      default_page: "start",
      welcome_page: "welcome",
      locale: "en",
      layout: "wikidot"
    }
    const request = new Request("https://wikijump.test/--/admin", {
      headers: {
        "X-Wikijump-Site-Id": String(siteId),
        "X-Wikijump-Site-Slug": "test"
      }
    })
    adminData = await loadAdminPage(request, { get: () => sessionToken }, async () => ({
      site,
      site_settings: {},
      site_file_domain: "test.wjfiles.localhost",
      license_name: "CC BY-SA 3.0",
      license_url: "https://creativecommons.org/licenses/by-sa/3.0/",
      license_kind: "standard",
      license_html: null,
      user_session: null,
      locales: ["en-US", "en"]
    }))
  } finally {
    client.request = originalClientRequest
  }

  ;({ default: siteSettingsComponent } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/SiteSettings.svelte"
  ))
  ;({ default: layoutSettingsComponent } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/LayoutSettings.svelte"
  ))
  ;({ default: rootLayoutComponent } = await vite.ssrLoadModule(
    "/src/routes/+layout.svelte"
  ))
  ;({ default: canonicalAdminPage } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/+page.svelte"
  ))
  ;({ default: legacyAdminPage } = await vite.ssrLoadModule(
    "/src/routes/_admin/+page.svelte"
  ))
  ;({ default: canonicalAdminError } = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/+error.svelte"
  ))
  ;({ default: legacyAdminError } = await vite.ssrLoadModule(
    "/src/routes/_admin/+error.svelte"
  ))
  canonicalAdminServer = await vite.ssrLoadModule(
    "/src/routes/[x+2d]/admin/+page.server.ts"
  )
  legacyAdminServer = await vite.ssrLoadModule("/src/routes/_admin/+page.server.ts")
})

after(async () => {
  if (client && originalClientRequest) client.request = originalClientRequest
  if (vite) await vite.close()
  if (previousWorkingDirectory) process.chdir(previousWorkingDirectory)
})

describe("Wikidot site settings public boundaries", () => {
  it("server-renders the seven general controls in captured order and keeps layout separate", () => {
    const siteBody = renderComponent(siteSettingsComponent, { data: adminData }).body
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
      const index = siteBody.indexOf(control)
      assert.ok(index > previous, `${control} must follow the previous control`)
      previous = index
    }
    assert.match(siteBody, /<form id="sm-general-form"/u)
    assert.doesNotMatch(siteBody, /name="layout"/u)

    const layoutBody = renderComponent(layoutSettingsComponent, {
      data: adminData
    }).body
    assert.match(layoutBody, /id="wikijump-layout-settings"/u)
    assert.match(layoutBody, /name="layout"/u)
  })

  it("server-renders analytics, theme, and toolbar settings from the request view", () => {
    const enabledData = {
      site: {
        name: "Rendered settings fixture",
        slug: "rendered-settings",
        locale: "en",
        layout: "wikidot",
        from_wikidot: true,
        top_bar_page: "nav:top",
        side_bar_page: "nav:side"
      },
      site_settings: {
        google_analytics: { enabled: true, profile: "UA-1-2" },
        toolbars: { top: true, bottom: false }
      },
      theme: { type: "external", url: "https://themes.example/site.css" },
      license_name: "CC BY-SA 3.0",
      license_url: "https://creativecommons.org/licenses/by-sa/3.0/",
      license_kind: "standard",
      license_html: null,
      user_session: null,
      internationalization: {}
    }
    const enabled = renderComponent(
      rootLayoutComponent,
      {},
      requestContext(enabledData, { routeId: "/[slug]/[...extra]" })
    )
    assert.match(enabled.head, /name="wikidot-site-analytics-profile" content="UA-1-2"/u)
    assert.match(
      enabled.head,
      /data-wikidot-site-theme="" href="https:\/\/themes\.example\/site\.css"/u
    )
    assert.match(enabled.body, /id="navi-bar"/u)

    const disabledData = structuredClone(enabledData)
    disabledData.site_settings.google_analytics = { enabled: false, profile: null }
    disabledData.site_settings.toolbars.top = false
    disabledData.theme = { type: "built_in", id: 1 }
    const disabled = renderComponent(
      rootLayoutComponent,
      {},
      requestContext(disabledData, { routeId: "/[slug]/[...extra]" })
    )
    assert.doesNotMatch(disabled.head, /wikidot-site-analytics-profile/u)
    assert.doesNotMatch(disabled.head, /data-wikidot-site-theme/u)
    assert.doesNotMatch(disabled.body, /id="navi-bar"/u)
  })

  it("serves analytics through nonce-protected full-document SSR without a remote loader", async () => {
    client.request = async (method) => {
      if (method === "preload_view") {
        return {
          site: {
            site_id: siteId,
            settings_revision: settingsRevision,
            slug: "test",
            name: "Test Wiki",
            tagline: "Compatibility fixture",
            description: "Site settings public-boundary fixture",
            default_page: "start",
            welcome_page: "welcome",
            locale: "en",
            layout: "wikidot",
            from_wikidot: true,
            top_bar_page: "nav:top",
            side_bar_page: "nav:side",
            favicon_source: null,
            ios_icon_source: null,
            windows_tile_source: null
          },
          site_settings: {
            google_analytics: { enabled: true, profile: "UA-1-2" },
            toolbars: { top: true, bottom: false }
          },
          site_file_domain: "test.wjfiles.localhost",
          license_name: "CC BY-SA 3.0",
          license_url: "https://creativecommons.org/licenses/by-sa/3.0/",
          license_kind: "standard",
          license_html: null,
          user_session: null
        }
      }
      if (method === "admin_view") {
        return { type: "site_found", data: { categories: [], page_templates: [] } }
      }
      if (method === "translate") return {}
      throw new Error(`Unexpected Deepwell method ${method}`)
    }

    const server = createHttpServer(vite.middlewares)
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    try {
      const address = server.address()
      assert.ok(address && typeof address === "object")
      const response = await fetch(`http://127.0.0.1:${address.port}/_admin`, {
        headers: {
          accept: "text/html",
          "accept-language": "en",
          "X-Wikijump-Site-Id": String(siteId),
          "X-Wikijump-Site-Slug": "test"
        }
      })
      const document = await response.text()

      assert.equal(response.status, 200)
      assert.match(response.headers.get("content-type") ?? "", /text\/html/u)
      assert.match(document, /name="wikidot-site-analytics-profile" content="UA-1-2"/u)
      assert.match(document, /userTracker\._setAccount/u)
      assert.match(document, /userTracker\._trackPageview/u)
      assert.doesNotMatch(
        document,
        /google-analytics\.com|document\.createElement|\.src\s*=/u
      )

      const analyticsScript = [
        ...document.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gu)
      ].find(
        ([, , body]) =>
          body.includes("userTracker._setAccount") &&
          body.includes("userTracker._trackPageview")
      )
      assert.ok(analyticsScript)
      const analyticsNonce = /\bnonce="([^"]+)"/u.exec(analyticsScript[1])?.[1]
      assert.ok(analyticsNonce)
      assert.notEqual(analyticsNonce, "%sveltekit.nonce%")
      assert.ok(
        (response.headers.get("content-security-policy") ?? "").includes(
          `'nonce-${analyticsNonce}'`
        )
      )
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      client.request = originalClientRequest
    }
  })

  it("routes settings writes through the trusted site and revision-bound action seam", async () => {
    const cases = [
      {
        action: "site",
        fields: {
          siteId,
          expectedSettingsRevision: settingsRevision,
          name: "Renamed wiki",
          slug: "renamed-wiki",
          tagline: "Updated tagline",
          description: "Updated description",
          defaultPage: "home",
          welcomePage: "welcome",
          locale: "en",
          action: "edit"
        },
        method: "site_update",
        expected: {
          name: "Renamed wiki",
          slug: "renamed-wiki",
          tagline: "Updated tagline",
          description: "Updated description",
          default_page: "home",
          welcome_page: "welcome",
          locale: "en"
        }
      },
      {
        action: "analytics",
        fields: {
          siteId,
          expectedSettingsRevision: settingsRevision,
          enabled: true,
          profile: "UA-1-2"
        },
        method: "site_update",
        expected: { google_analytics: { enabled: true, profile: "UA-1-2" } }
      },
      {
        action: "toolbar",
        fields: {
          siteId,
          expectedSettingsRevision: settingsRevision,
          top: true,
          bottom: false
        },
        method: "site_update",
        expected: { toolbars: { top: true, bottom: false } }
      },
      {
        action: "theme",
        fields: {
          siteId,
          categoryId: 23,
          expectedSettingsRevision: settingsRevision,
          themeType: "external",
          builtinId: 1,
          externalUrl: "https://themes.example/site.css",
          customCss: ""
        },
        method: "category_update",
        expected: {
          category: 23,
          theme: { type: "external", url: "https://themes.example/site.css" }
        }
      },
      {
        action: "autonumber",
        fields: {
          siteId,
          categoryId: 23,
          expectedSettingsRevision: settingsRevision,
          enabled: true
        },
        method: "category_update",
        expected: { category: 23, autonumber_enabled: true }
      },
      {
        action: "siteLayout",
        fields: {
          siteId,
          expectedSettingsRevision: settingsRevision,
          layout: "wikidot"
        },
        method: "site_update",
        expected: { layout: "wikidot" }
      }
    ]

    const calls = []
    let mutationFailure = null
    client.request = async (method, params, context) => {
      calls.push({ method, params, context })
      if (method === "session_get") return { user_id: 41 }
      if (mutationFailure) throw mutationFailure
      return { settings_revision: settingsRevision + 1 }
    }
    try {
      for (const { action, fields, method, expected } of cases) {
        assert.equal(typeof canonicalAdminServer.actions[action], "function")
        calls.length = 0
        const result = await canonicalAdminServer.actions[action](
          actionEvent(action, fields)
        )
        assert.equal(result.form.valid, true, action)
        assert.deepEqual(calls[0], {
          method: "session_get",
          params: [sessionToken],
          context: undefined
        })
        assert.equal(calls[1].method, method, action)
        assert.equal(calls[1].params.site, siteId, action)
        assert.equal(calls[1].params.expected_settings_revision, settingsRevision, action)
        assert.equal(calls[1].params.user_id, 41, action)
        assert.equal(calls[1].params.ip_address, "192.0.2.63", action)
        assert.deepEqual(calls[1].context, { sessionToken, siteId }, action)
        for (const [name, value] of Object.entries(expected)) {
          assert.deepEqual(calls[1].params[name], value, `${action}: ${name}`)
        }
      }

      calls.length = 0
      const denied = await canonicalAdminServer.actions.analytics(
        actionEvent("analytics", {
          siteId: 999,
          expectedSettingsRevision: settingsRevision,
          enabled: true,
          profile: "UA-1-2"
        })
      )
      assert.equal(denied.status, 403)
      assert.deepEqual(calls, [])

      mutationFailure = {
        message: "Site settings changed since revision 4",
        code: 4000,
        data: { expected_settings_revision: 4, current_settings_revision: 5 }
      }
      const stale = await canonicalAdminServer.actions.analytics(
        actionEvent("analytics", {
          siteId,
          expectedSettingsRevision: settingsRevision,
          enabled: true,
          profile: "UA-1-2"
        })
      )
      assert.equal(stale.status, 500)
      assert.equal(stale.data.form.valid, true)
      assert.equal(stale.data.message, "Site settings changed since revision 4")
      assert.equal(stale.data.code, 4000)
      assert.deepEqual(stale.data.data, {
        expected_settings_revision: 4,
        current_settings_revision: 5
      })
    } finally {
      client.request = originalClientRequest
    }
  })

  it("serves the legacy admin route through the same rendered page and action seam", () => {
    assert.equal(legacyAdminServer.load, canonicalAdminServer.load)
    assert.equal(legacyAdminServer.actions, canonicalAdminServer.actions)

    const canonicalBody = renderComponent(canonicalAdminPage, {
      data: adminData
    }).body
    const legacyBody = renderComponent(legacyAdminPage, {
      data: adminData,
      form: null,
      params: {}
    }).body
    const formActions = (body) =>
      [...body.matchAll(/<form[^>]+action="([^"]+)"/gu)].map((match) => match[1])
    assert.deepEqual(formActions(legacyBody), formActions(canonicalBody))
    for (const id of ["sm-general-form", "wikijump-layout-settings"]) {
      assert.match(legacyBody, new RegExp(`id="${id}"`, "u"))
    }

    const error = {
      view: "admin_permissions",
      html: "<strong>Permission boundary fixture</strong>"
    }
    const errorContext = requestContext(adminData, {
      error,
      routeId: "/_admin"
    })
    const canonicalErrorBody = renderComponent(canonicalAdminError, {}, errorContext).body
    const legacyErrorBody = renderComponent(
      legacyAdminError,
      {},
      requestContext(adminData, { error, routeId: "/_admin" })
    ).body
    for (const body of [canonicalErrorBody, legacyErrorBody]) {
      assert.match(body, /UNTRANSLATED:Lacks permissions for page/u)
      assert.match(body, /<strong>Permission boundary fixture<\/strong>/u)
    }
  })
})
