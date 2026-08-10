import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { stringify as stringifyDevalue } from "devalue";

import { Open43SettingsBrowserAdapter } from "../src/open43-settings-browser-adapter.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const REVISION_CONFLICT_MESSAGE = "The request is in some way malformed or incorrect";

const semantic = {
  analytics: { profile: "UA-754-1", queue: [["_setAccount", "UA-754-1"], ["_trackPageview"]], nonce: "nonce" },
  theme: { marker: "open43-fixture", stylesheet_order: ["base", "site", "page"], site_theme_count: 1, site_theme_css: ":root{}" },
  toolbar: { top_toolbar_count: 1 },
  admin: { controls: [], general_values: {} },
};

function fakePage(initialUrl, events, { replaceDocumentOnNavigation = false, documentPolicies = [] } = {}) {
  let documentIdentity = "document-1";
  let clientHref = null;
  let url = initialUrl;
  const listeners = new Map();
  const documentResponse = (responseUrl) => {
    const policy = documentPolicies.shift();
    const response = {
      url: () => responseUrl,
      status: () => 200,
      headers: () => ({ ...(policy === undefined ? {} : { "content-security-policy": policy }) }),
      request: () => ({ resourceType: () => "document" }),
    };
    for (const listener of listeners.get("response") ?? []) listener(response);
    return response;
  };
  return {
    on(name, listener) {
      const values = listeners.get(name) ?? new Set();
      values.add(listener);
      listeners.set(name, values);
    },
    off(name, listener) { listeners.get(name)?.delete(listener); },
    async setViewportSize() {},
    async addInitScript() {},
    async goto(nextUrl) { url = nextUrl; events.push(`goto:${new URL(nextUrl).pathname}`); return documentResponse(nextUrl); },
    async reload() { events.push(`reload:${new URL(url).pathname}`); return documentResponse(url); },
    async waitForLoadState() {},
    async waitForURL() {},
    url: () => url,
    locator(selector) { return { async click() { assert.notEqual(selector, "#open43-client-navigation", "the injected hidden link must use DOM activation"); } }; },
    async evaluate(callback, argument) {
      const source = callback.toString();
      if (typeof argument === "number") return { status: "complete" };
      if (typeof argument === "string") { clientHref = argument; return undefined; }
      if (source.includes("#open43-client-navigation")) { url = clientHref; if (replaceDocumentOnNavigation) documentIdentity = "document-2"; return undefined; }
      if (argument !== undefined || source.includes("requestAnimationFrame")) return undefined;
      if (source.includes("document_identity")) return { document_identity: documentIdentity, snapshot: structuredClone(semantic) };
      if (source.includes("__open43DocumentIdentity")) return documentIdentity;
      if (source.includes("visible_after_scroll")) return { visible_after_scroll: true, focusable_link: true, client_navigation_preserved: true };
      return structuredClone(semantic);
    },
    async close() {},
  };
}

test("the settings adapter changes gate attribution between immediate and settled capture phases", async () => {
  const events = [];
  const url = "https://scpaiueouiuiuiui.wikijump.localhost:18443/104";
  const page = fakePage(url, events);
  const context = { async newPage() { return page; } };
  let captureCount = 0;
  const browserContexts = {
    async newCandidateContext() { return { context, environment: {} }; },
    async setActiveFixture(fixtureId) { events.push(`fixture:${fixtureId}`); },
    async captureCandidateObservation(options) {
      events.push("capture:start");
      await options.onPhase("domcontentloaded_immediate_observation");
      if (options.navigate) await options.navigate({ page, url: options.url, timeoutMs: 300_000 });
      else await page.goto(options.url);
      events.push("artifact:immediate");
      await options.onPhase("settled");
      events.push("artifact:settled");
      captureCount += 1;
      return {
        input_url: url,
        final_url: url,
        navigation_status: 200,
        failures: [],
        first_paint: { document: { phase: "domcontentloaded_immediate_observation" }, screenshot: { path: `initial-${captureCount}.png`, sha256: "a".repeat(64) } },
        document: { phase: "settled", resource_completion: { status: "complete" } },
        settled_viewport_screenshot: { path: `settled-${captureCount}.png`, sha256: "b".repeat(64) },
      };
    },
  };
  const adapter = new Open43SettingsBrowserAdapter({
    browserContexts,
    pageOrigin: "https://scpaiueouiuiuiui.wikijump.localhost:18443",
    storageState: () => ({ cookies: [], origins: [] }),
  });
  const fromUrl = "https://scpaiueouiuiuiui.wikijump.localhost:18443/boundary-check";
  const pair = await adapter.capturePagePair({ url, label: "S755_THEME", index: 0, navigationFromUrl: fromUrl });
  assert.deepEqual(events, [
    "capture:start",
    "fixture:S755_THEME_INITIAL",
    "goto:/104",
    "artifact:immediate",
    "fixture:S755_THEME_SETTLED",
    "artifact:settled",
    "reload:/104",
    "fixture:S755_THEME_INITIAL",
    "goto:/boundary-check",
    "capture:start",
    "fixture:S755_THEME_INITIAL",
    "artifact:immediate",
    "fixture:S755_THEME_SETTLED",
    "artifact:settled",
  ]);
  assert.equal(pair.navigation_from_url, fromUrl);
  assert.deepEqual(pair.navigation_source, semantic);
  assert.equal(pair.reload_url, url);
  assert.equal(pair.client_navigation_preserved_document, true);
  assert.equal(pair.client_resource_completion, "complete");
  assert.ok(pair.client_transition_capture);
  assert.notEqual(pair.client_transition_capture.first_paint.screenshot.path, pair.client_transition_capture.settled_viewport_screenshot.path);
  assert.notEqual(pair.capture.first_paint.screenshot.sha256, pair.capture.settled_viewport_screenshot.sha256);
});

test("the settings adapter cannot repair a missing initial CSP header with a later response", async () => {
  const events = [];
  const url = "https://scpaiueouiuiuiui.wikijump.localhost:18443/boundary-check";
  const page = fakePage(url, events, { documentPolicies: [undefined, "script-src 'nonce-nonce'"] });
  const browserContexts = (ownedPage) => ({
    async newCandidateContext() { return { context: { async newPage() { return ownedPage; } }, environment: {} }; },
    async setActiveFixture() {},
    async captureCandidateObservation(options) {
      await options.onPhase("domcontentloaded_immediate_observation");
      const navigation = await options.navigate({ page: ownedPage, url: options.url, timeoutMs: 300_000 });
      await options.onPhase("settled");
      return {
        input_url: url,
        final_url: url,
        navigation_status: navigation.status(),
        failures: [],
        first_paint: { document: { phase: "domcontentloaded_immediate_observation" }, screenshot: { path: "initial.png", sha256: "a".repeat(64) } },
        document: { phase: "settled", resource_completion: { status: "complete" } },
        settled_viewport_screenshot: { path: "settled.png", sha256: "b".repeat(64) },
      };
    },
  });
  const adapter = new Open43SettingsBrowserAdapter({ browserContexts: browserContexts(page), pageOrigin: new URL(url).origin, storageState: () => ({ cookies: [], origins: [] }) });
  const pair = await adapter.capturePagePair({ url, label: "S754_ANALYTICS", index: 0 });
  assert.equal(pair.initial_navigation_csp_header_sha256, null);
  assert.equal(pair.csp_nonce_matches_initial_navigation_header, false);
  assert.equal(events.includes("reload:/boundary-check"), true);

  const policy = "default-src 'self'; script-src 'nonce-nonce'";
  const validPage = fakePage(url, [], { documentPolicies: [policy] });
  const validAdapter = new Open43SettingsBrowserAdapter({ browserContexts: browserContexts(validPage), pageOrigin: new URL(url).origin, storageState: () => ({ cookies: [], origins: [] }) });
  const valid = await validAdapter.capturePagePair({ url, label: "S754_ANALYTICS", index: 1 });
  assert.equal(valid.initial_navigation_csp_header_sha256, createHash("sha256").update(policy).digest("hex"));
  assert.equal(valid.csp_nonce_matches_initial_navigation_header, true);
  assert.equal(JSON.stringify(valid).includes(policy), false);
});

test("the settings adapter rejects a client navigation that replaces the document", async () => {
  const events = [];
  const url = "https://scpaiueouiuiuiui.wikijump.localhost:18443/104";
  const page = fakePage(url, events, { replaceDocumentOnNavigation: true });
  const context = { async newPage() { return page; } };
  const browserContexts = {
    async newCandidateContext() { return { context, environment: {} }; },
    async setActiveFixture() {},
    async captureCandidateObservation(options) {
      await options.onPhase("domcontentloaded_immediate_observation");
      await page.goto(options.url);
      await options.onPhase("settled");
      return {
        input_url: url,
        final_url: url,
        navigation_status: 200,
        failures: [],
        first_paint: { document: { phase: "domcontentloaded_immediate_observation" }, screenshot: { path: "initial.png", sha256: "a".repeat(64) } },
        document: { phase: "settled", resource_completion: { status: "complete" } },
        settled_viewport_screenshot: { path: "settled.png", sha256: "b".repeat(64) },
      };
    },
  };
  const adapter = new Open43SettingsBrowserAdapter({ browserContexts, pageOrigin: "https://scpaiueouiuiuiui.wikijump.localhost:18443", storageState: () => ({ cookies: [], origins: [] }) });
  await assert.rejects(
    adapter.capturePagePair({ url, label: "S754_ANALYTICS", index: 0 }),
    /replaced the document/u,
  );
});

test("the settings adapter keeps a disabled document across a public mutation before transition capture", async () => {
  const events = [];
  const url = "https://scpaiueouiuiuiui.wikijump.localhost:18443/boundary-check";
  const page = fakePage(url, events);
  const context = { async newPage() { return page; } };
  const browserContexts = {
    async newCandidateContext() { return { context, environment: {} }; },
    async setActiveFixture(fixtureId) { events.push(`fixture:${fixtureId}`); },
    async captureCandidateObservation(options) {
      const transition = options.label === "settings-client-transition";
      events.push(`capture:${transition ? "transition" : "full"}`);
      await options.onPhase("domcontentloaded_immediate_observation");
      await options.navigate({ page, url: options.url, timeoutMs: 300_000 });
      await options.onPhase("settled");
      return {
        input_url: options.url,
        final_url: options.url,
        navigation_status: 200,
        failures: [],
        first_paint: { document: { phase: "domcontentloaded_immediate_observation" }, screenshot: { path: `${options.label}-initial.png`, sha256: "a".repeat(64) } },
        document: { phase: "settled", resource_completion: { status: "complete" } },
        settled_viewport_screenshot: { path: `${options.label}-settled.png`, sha256: "b".repeat(64) },
      };
    },
  };
  const adapter = new Open43SettingsBrowserAdapter({ browserContexts, pageOrigin: new URL(url).origin, storageState: () => ({ cookies: [], origins: [] }) });
  const pair = await adapter.capturePagePair({
    url,
    label: "S757_TOOLBAR",
    index: 4,
    navigationFromUrl: "https://scpaiueouiuiuiui.wikijump.localhost:18443/corpus%3Ascp-9506-draft",
    beforeClientNavigation: async () => events.push("public-toolbar-mutation"),
  });
  assert.ok(events.indexOf("public-toolbar-mutation") > events.indexOf("goto:/corpus%3Ascp-9506-draft"));
  assert.ok(events.indexOf("public-toolbar-mutation") < events.indexOf("capture:transition"));
  assert.ok(pair.client_transition_capture);
});

test("the settings adapter captures the visible analytics stale-error identity", async () => {
  let dialogVisible = false;
  const responses = [500, 200].map((status) => ({
    request: () => ({ method: () => "POST" }),
    url: () => "https://scpaiueouiuiuiui.wikijump.localhost:18443/_admin?/analytics",
    status: () => status,
    json: async () => ({ type: "failure", status, data: stringifyDevalue({ code: 4000, message: REVISION_CONFLICT_MESSAGE }) }),
  }));
  const page = {
    async goto() {},
    async reload() {},
    waitForResponse(predicate) { const response = responses.shift(); assert.equal(predicate(response), true); return Promise.resolve(response); },
    locator(selector) {
      return {
        async click() { if (selector === ".button-close-message") dialogVisible = false; },
        async waitFor() { dialogVisible = true; },
        async isVisible() { return dialogVisible; },
        async innerText() { assert.equal(selector, "#modal-title"); return REVISION_CONFLICT_MESSAGE; },
        async fill() {},
        async check() {},
      };
    },
    async close() {},
  };
  const browserContexts = {
    async setActiveFixture(value) { assert.equal(value, "S754_ANALYTICS_SETTLED"); },
    async newCandidateContext() { return { context: { async newPage() { return page; } }, environment: {} }; },
  };
  const adapter = new Open43SettingsBrowserAdapter({ browserContexts, pageOrigin: "https://scpaiueouiuiuiui.wikijump.localhost:18443", storageState: () => ({ cookies: [], origins: [] }) });
  const result = await adapter.exerciseAnalyticsAdmin({ profile: "UA-754-1", onLoaded: async () => undefined });
  assert.deepEqual(result, { stale_status: 500, error_visible: true, error_code: 4000, error_message_sha256: sha256Value(REVISION_CONFLICT_MESSAGE), success_status: 200, saved_profile: "UA-754-1" });
});

test("the settings adapter exercises stale error and success through the public general form", async () => {
  const events = [];
  const responses = [
    ["POST", "https://scpaiueouiuiuiui.wikijump.localhost:18443/_admin?/site", 500, 10],
    ["POST", "https://scpaiueouiuiuiui.wikijump.localhost:18443/_admin?/site", 200, 11],
    ["GET", "https://scpaiueouiuiuiui.wikijump.localhost:18443/_admin/__data.json?x-sveltekit-invalidated=1", 200, null],
    ["POST", "https://scpaiueouiuiuiui.wikijump.localhost:18443/_admin?/site", 200, 12],
    ["GET", "https://scpaiueouiuiuiui.wikijump.localhost:18443/_admin/__data.json?x-sveltekit-invalidated=1", 200, null],
  ].map(([method, url, status, revision]) => ({
    request: () => ({
      method: () => method,
      headers: () => ({ "content-type": "application/x-www-form-urlencoded" }),
      postDataBuffer: () => method === "POST" ? Buffer.from(new URLSearchParams({ __superform_json: stringifyDevalue({ expectedSettingsRevision: revision }) }).toString()) : null,
    }),
    url: () => url,
    status: () => status,
    json: async () => ({ type: "failure", status, data: stringifyDevalue({ code: 4000, message: REVISION_CONFLICT_MESSAGE }) }),
  }));
  let dialogVisible = false;
  const page = {
    on() {},
    off() {},
    async addInitScript() { events.push("probe"); },
    async goto() { events.push("goto"); },
    async reload() { events.push("reload"); },
    async waitForLoadState() {},
    locator(selector) {
      return {
        async getAttribute(name) { assert.equal(selector, "#sm-general-form"); assert.equal(name, "action"); return "?/site"; },
        async fill(value) { events.push(`fill:${value}`); },
        async click() { events.push(`click:${selector}`); if (selector === ".button-close-message") dialogVisible = false; },
        async waitFor() { dialogVisible = true; events.push("error-visible"); },
        async isVisible() { return dialogVisible; },
        async innerText() { assert.equal(selector, "#modal-title"); return REVISION_CONFLICT_MESSAGE; },
      };
    },
    waitForResponse(predicate) {
      const response = responses.shift();
      assert.equal(predicate(response), true);
      return Promise.resolve(response);
    },
    async evaluate(callback, argument) {
      if (typeof argument === "number") return { status: "complete" };
      if (callback.toString().includes("requestAnimationFrame")) return undefined;
      return structuredClone(semantic);
    },
    async close() {},
  };
  const browserContexts = {
    async setActiveFixture(value) { events.push(`fixture:${value}`); },
    async newCandidateContext() { return { context: { async newPage() { return page; } }, environment: {} }; },
  };
  const adapter = new Open43SettingsBrowserAdapter({ browserContexts, pageOrigin: "https://scpaiueouiuiuiui.wikijump.localhost:18443", storageState: () => ({ cookies: [], origins: [] }) });
  const result = await adapter.exerciseGeneralAdmin({
    description: "Open43 general marker",
    onLoaded: async () => events.push("loaded"),
    onStaleObserved: async () => events.push("stale-observed"),
  });
  assert.equal(result.form_action, "?/site");
  assert.equal(result.stale_status, 500);
  assert.equal(result.stale_error_visible, true);
  assert.equal(result.stale_error_code, 4000);
  assert.equal(result.stale_error_message_sha256, sha256Value(REVISION_CONFLICT_MESSAGE));
  assert.equal(result.success_status, 200);
  assert.equal(result.invalidation_status, 200);
  assert.equal(result.invalidation_resource_completion, "complete");
  assert.equal(result.fresh_revision_confirmation_status, 200);
  assert.equal(result.confirmation_invalidation_status, 200);
  assert.equal(result.confirmation_resource_completion, "complete");
  assert.equal(result.stale_submitted_revision, 10);
  assert.equal(result.success_submitted_revision, 11);
  assert.equal(result.confirmation_submitted_revision, 12);
  assert.equal(result.success_error_visible, false);
  assert.deepEqual(result.console_errors, []);
  assert.deepEqual(result.success_dom_values, semantic.admin.general_values);
  assert.deepEqual(events, [
    "fixture:S1046_ADMIN_SETTLED",
    "probe",
    "goto",
    "loaded",
    "fill:Open43 general marker",
    "click:#sm-general-save",
    "error-visible",
    "stale-observed",
    "click:.button-close-message",
    "reload",
    "fill:Open43 general marker",
    "click:#sm-general-save",
    "click:#sm-general-save",
  ]);
});
