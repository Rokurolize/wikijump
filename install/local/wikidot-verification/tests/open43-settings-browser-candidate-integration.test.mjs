import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_SETTINGS_ANALYTICS_CASE_IDS,
  OPEN43_SETTINGS_BROWSER_CASE_IDS,
  OPEN43_SETTINGS_THEME_CASE_IDS,
  OPEN43_SETTINGS_TOOLBAR_CASE_IDS,
  createOpen43SettingsBrowserCandidateCaseSet,
  createOpen43SettingsGroupCandidateCaseSet,
} from "../src/open43-settings-browser-candidate-case-set.mjs";
import { parityBrowserThrottleConfig } from "../src/standing-browser-parity-browser-session.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const mixedHex = (character, length) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(length / 2);
const hash = (character) => mixedHex(character, 64);
const git = (character) => mixedHex(character, 40);
const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const ADMIN_TOKEN = "private-administrator-token";
const NON_ADMIN_TOKEN = "private-non-admin-token";
const EXPIRED_TOKEN = "private-expired-token";
const RPC_TOKEN = "private-deepwell-rpc-token";
const TLS_CA = "private-candidate-tls-ca";
const PRIVATE_INPUT = { administrator_token: ADMIN_TOKEN, deepwell_rpc_token: RPC_TOKEN, tls_ca_pem: TLS_CA };
const REVISION_CONFLICT_MESSAGE = "The request is in some way malformed or incorrect";
const FIXTURE = Object.freeze({
  site_id: 6_000_003,
  cross_site_sentinel_id: 9_000_000_043,
  default_category: { category_id: 100_000_015, slug: "_default", page_id: 70, page_slug: "boundary-check" },
  transition_category: { category_id: 100_000_016, slug: "corpus", page_id: 71, page_slug: "corpus:scp-9506-draft" },
});

function candidateIdentity(host = "scpaiueouiuiuiui.wikijump.localhost") {
  const slug = host.split(".")[0];
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-settings-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-settings-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("4")}`, deepwell: `sha256:${hash("5")}` },
      config: { isolated_overlay_sha256: hash("6"), promotion_base_manifest_sha256: hash("7"), effective_runtime_services_sha256: hash("8") },
      endpoint: {
        scheme: "https",
        host,
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [`https://${slug}.wikijump.localhost:18443`, `https://${slug}.wjfiles.localhost:18443`],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("9"), seal_sha256: hash("a") },
  };
}

const clone = (value) => structuredClone(value);

function fakePublicBoundary(events) {
  const category = (categoryId, slug) => ({ category_id: categoryId, slug, settings_revision: categoryId, theme_kind: "built_in", theme_builtin_id: 1, theme_external_url: null, theme_custom_css: null });
  const state = {
    site: {
      site_id: FIXTURE.site_id,
      slug: "scpaiueouiuiuiui",
      name: "Editable candidate",
      tagline: "Before tagline",
      description: "Before description",
      locale: "en",
      default_page: "home",
      welcome_page: "system:welcome",
      settings_revision: 10,
      google_analytics_enabled: false,
      google_analytics_profile: null,
      show_top_toolbar: false,
      show_bottom_toolbar: true,
    },
    categories: new Map([
      ["_default", category(FIXTURE.default_category.category_id, "_default")],
      ["corpus", category(FIXTURE.transition_category.category_id, "corpus")],
    ]),
    pages: new Map([
      [FIXTURE.default_category.page_slug, { ...FIXTURE.default_category, page_category_id: FIXTURE.default_category.category_id, revision_id: 80, revision_number: 1, slug: FIXTURE.default_category.page_slug, title: "Boundary", wikitext: "fixture" }],
      [FIXTURE.transition_category.page_slug, { ...FIXTURE.transition_category, page_category_id: FIXTURE.transition_category.category_id, revision_id: 81, revision_number: 1, slug: FIXTURE.transition_category.page_slug, title: "Corpus", wikitext: "fixture" }],
    ]),
  };

  const session = {
    pageOrigin: PAGE_ORIGIN,
    fixtureIdentity: FIXTURE,
    privateInputIdentity: {
      administrator_user_id: 41,
      non_admin_user_id: 42,
      administrator_session_sha256: sha256Value(ADMIN_TOKEN),
      non_admin_session_sha256: sha256Value(NON_ADMIN_TOKEN),
      expired_session_sha256: sha256Value(EXPIRED_TOKEN),
      deepwell_rpc_token_sha256: sha256Value(RPC_TOKEN),
      tls_ca_sha256: sha256Value(TLS_CA),
      fixture_identity_sha256: sha256Value(FIXTURE),
    },
    requiredServiceBindings: [{ role: "deepwell", container_port: "2747/tcp", host_address: "127.0.0.1", host_port: 32747 }],
    storageState(actor) {
      if (actor === "anonymous") return { cookies: [], origins: [] };
      const tokens = { administrator: ADMIN_TOKEN, non_admin: NON_ADMIN_TOKEN, expired: EXPIRED_TOKEN };
      return { cookies: [{ name: "wikijump_token", value: tokens[actor], url: PAGE_ORIGIN }], origins: [] };
    },
    async rpc(method, params, options) {
      events.push({ seam: "rpc", method, target: params.site ?? params.page ?? null, cleanup: options.cleanup === true });
      if (method === "session_get") {
        if (params[0] === ADMIN_TOKEN) return { user_id: 41, session_token: "not-retained" };
        if (params[0] === NON_ADMIN_TOKEN) return { user_id: 42, session_token: "not-retained" };
        if (params[0] === EXPIRED_TOKEN) return null;
      }
      if (method === "site_get") return params.site === FIXTURE.cross_site_sentinel_id ? null : clone(state.site);
      if (method === "category_get") return clone(state.categories.get(params.category) ?? null);
      if (method === "page_get") return clone(state.pages.get(params.page) ?? null);
      throw new Error(`unexpected fake RPC method: ${method}`);
    },
    async verifyActorSessions() {
      const administrator = await this.rpc("session_get", [ADMIN_TOKEN], { actor: "anonymous", cleanup: false });
      const nonAdmin = await this.rpc("session_get", [NON_ADMIN_TOKEN], { actor: "anonymous", cleanup: false });
      const expired = await this.rpc("session_get", [EXPIRED_TOKEN], { actor: "anonymous", cleanup: false });
      return { administrator_user_id: administrator.user_id, non_admin_user_id: nonAdmin.user_id, expired_session: expired };
    },
    async action(name, fields, options = {}) {
      events.push({ seam: "action", name, siteId: fields.siteId, actor: options.actor ?? "administrator", origin: options.origin ?? PAGE_ORIGIN, cleanup: options.cleanup === true });
      let status = 200;
      if ((options.origin ?? PAGE_ORIGIN) !== PAGE_ORIGIN) status = 403;
      else if (options.actor === "anonymous" || options.actor === "expired") status = 401;
      else if (options.actor === "non_admin" || fields.siteId !== state.site.site_id) status = 403;
      const selectedCategory = [...state.categories.values()].find(({ category_id: id }) => id === fields.categoryId);
      if (status === 200 && name !== "theme" && fields.expectedSettingsRevision !== state.site.settings_revision) status = 500;
      else if (status === 200 && name === "theme" && (!selectedCategory || fields.expectedSettingsRevision !== selectedCategory.settings_revision)) status = 500;
      if (status === 200 && name === "analytics") {
        state.site.google_analytics_enabled = fields.enabled;
        state.site.google_analytics_profile = fields.profile || null;
        state.site.settings_revision += 1;
      }
      if (status === 200 && name === "toolbar") {
        state.site.show_top_toolbar = fields.top;
        state.site.show_bottom_toolbar = fields.bottom;
        state.site.settings_revision += 1;
      }
      if (status === 200 && name === "theme") {
        selectedCategory.theme_kind = fields.themeType;
        selectedCategory.theme_builtin_id = fields.themeType === "built_in" ? fields.builtinId : null;
        selectedCategory.theme_external_url = fields.themeType === "external" ? fields.externalUrl : null;
        selectedCategory.theme_custom_css = fields.themeType === "custom" ? fields.customCss : null;
        selectedCategory.settings_revision += 1;
      }
      if (status === 200 && name === "site") {
        Object.assign(state.site, {
          slug: fields.slug,
          name: fields.name,
          tagline: fields.tagline,
          description: fields.description,
          locale: fields.locale,
          default_page: fields.defaultPage,
          welcome_page: fields.welcomePage,
        });
        state.site.settings_revision += 1;
      }
      const wrongOrigin = (options.origin ?? PAGE_ORIGIN) !== PAGE_ORIGIN;
      return {
        http_status: status,
        transport_status: status,
        action_type: wrongOrigin ? "transport_rejection" : status === 200 ? "success" : "error",
        content_type: "application/json",
        response_body_sha256: sha256Value(
          wrongOrigin ? '{"message":"Cross-site POST form submissions are forbidden"}' : `${name}:${status}`,
        ),
      };
    },
  };
  return { state, session };
}

function semantic(state, rawUrl = PAGE_ORIGIN) {
  const pathname = decodeURIComponent(new URL(rawUrl).pathname.slice(1));
  const selectedCategory = state.categories.get(pathname.startsWith("corpus:") ? "corpus" : "_default");
  const css = selectedCategory.theme_custom_css ?? "";
  const styleValue = (name, fallback = "") => css.match(new RegExp(`(?:^|[;{]\\s*)${name}:\\s*([^;]+)`, "u"))?.[1].trim() ?? fallback;
  const names = {
    unixName: state.site.slug,
    name: state.site.name,
    subtitle: state.site.tagline,
    language: state.site.locale,
    description: state.site.description,
    default_page: state.site.default_page,
    welcome_page: state.site.welcome_page,
  };
  const enabled = state.site.google_analytics_enabled;
  const profile = enabled ? state.site.google_analytics_profile : null;
  const toolbarVisible = state.site.show_top_toolbar;
  return {
    analytics: { profile, queue: enabled ? [["_setAccount", profile], ["_trackPageview"]] : [], nonce: enabled ? "fixture-csp-nonce" : "", meta_present: enabled, script_count: 1 },
    theme: { marker: styleValue("--open43-theme-marker"), stylesheet_order: ["base", "site"], site_theme_count: 1, site_theme_css: css, body_font_family: styleValue("font-family", "Times New Roman"), body_background_color: styleValue("background-color", "rgba(0, 0, 0, 0)"), body_color: styleValue("color", "rgb(0, 0, 0)") },
    toolbar: { top_toolbar_count: toolbarVisible ? 1 : 0, geometry: toolbarVisible ? { width: 500, height: 42 } : null, hit_target: toolbarVisible ? { width: 80, height: 32 } : null },
    page_content_text: state.pages.get(pathname)?.wikitext.split("\n").at(-1) ?? "",
    admin: { controls: Object.keys(names), general_values: names },
  };
}

function fakeBrowserAdapter({ browserContexts, storageState }, state, events, { directThemeFailure = false, directThemeStale = false, clientThemeStale = false } = {}) {
  const contexts = new Map();
  const ensureContext = async (actor = "administrator") => {
    if (!contexts.has(actor)) contexts.set(actor, browserContexts.newCandidateContext({ storageState: storageState(actor) }).then(({ context }) => context));
    return await contexts.get(actor);
  };
  return {
    async capturePagePair({ url, label, index, viewport = { width: 1280, height: 900 }, navigationFromUrl = null, beforeClientNavigation = null }) {
      await browserContexts.setActiveFixture(`${label}_INITIAL`);
      await browserContexts.captureCandidateObservation({ context: await ensureContext(), label, index });
      const atViewport = (value) => {
        if (value.toolbar.top_toolbar_count === 1 && viewport.width <= 767) {
          value.toolbar.geometry = { width: 0, height: 0 };
          value.toolbar.hit_target = { width: 0, height: 0 };
        }
        return value;
      };
      const initial = atViewport(semantic(state, url));
      if (directThemeStale && label === "S755_THEME" && navigationFromUrl !== null) initial.theme.marker = "stale-direct-target";
      await browserContexts.setActiveFixture(`${label}_SETTLED`);
      const settled = atViewport(semantic(state, url));
      if (directThemeStale && label === "S755_THEME" && navigationFromUrl !== null) settled.theme.marker = "stale-direct-target";
      const reload = atViewport(semantic(state, url));
      const navigationSource = navigationFromUrl === null ? null : semantic(state, navigationFromUrl);
      if (beforeClientNavigation !== null) await beforeClientNavigation();
      await browserContexts.setActiveFixture(`${label}_INITIAL`);
      const clientInitial = atViewport(semantic(state, url));
      if (clientThemeStale && label === "S755_THEME" && navigationFromUrl !== null) clientInitial.theme.marker = "stale-client-transition";
      await browserContexts.setActiveFixture(`${label}_SETTLED`);
      const artifact = (phase) => ({ path: `${label}-${index}-${phase}.png`, sha256: sha256Value(`${label}:${index}:${phase}`) });
      events.push({ seam: "browser-adapter", label, index, navigationFromUrl });
      return {
        capture: {
          input_url: url,
          final_url: url,
          navigation_status: 200,
          failures: directThemeFailure && label === "S755_THEME" && navigationFromUrl !== null ? [{ kind: "http_error", status: 500 }] : [],
          first_paint: { document: { phase: "domcontentloaded_immediate_observation" }, screenshot: artifact("initial") },
          document: { phase: "settled", resource_completion: { status: "complete" } },
          settled_viewport_screenshot: artifact("settled"),
        },
        client_transition_capture: navigationFromUrl === null && beforeClientNavigation === null ? null : {
          input_url: url,
          final_url: url,
          navigation_status: 200,
          failures: [],
          first_paint: { document: { phase: "domcontentloaded_immediate_observation" }, screenshot: artifact("client-initial") },
          document: { phase: "settled", resource_completion: { status: "complete" } },
          settled_viewport_screenshot: artifact("client-settled"),
        },
        initial,
        settled,
        reload,
        reload_url: url,
        client_initial: clientInitial,
        client: (() => {
          const value = atViewport(semantic(state, url));
          if (clientThemeStale && label === "S755_THEME" && navigationFromUrl !== null) value.theme.marker = "stale-client-transition";
          return value;
        })(),
        navigation_from_url: navigationFromUrl,
        navigation_source: navigationSource,
        console_errors: [],
        remote_analytics_request_count: 0,
        initial_navigation_csp_header_sha256: sha256Value("fixture-csp-policy"),
        csp_nonce_matches_initial_navigation_header: true,
        client_navigation_preserved_document: true,
        client_resource_completion: "complete",
        toolbar_interactions: { visible_after_scroll: true, focusable_link: true, client_navigation_preserved: true },
        viewport,
      };
    },
    async exerciseAnalyticsAdmin({ profile, onLoaded }) {
      await browserContexts.setActiveFixture("S754_ANALYTICS_SETTLED");
      await ensureContext();
      await onLoaded();
      state.site.google_analytics_enabled = true;
      state.site.google_analytics_profile = profile;
      state.site.settings_revision += 1;
      events.push({ seam: "browser-adapter", operation: "analytics-save" });
      return { stale_status: 500, error_visible: true, error_code: 4000, error_message_sha256: sha256Value(REVISION_CONFLICT_MESSAGE), success_status: 200, saved_profile: profile };
    },
    async exerciseGeneralAdmin({ description, onLoaded, onStaleObserved }) {
      await browserContexts.setActiveFixture("S1046_ADMIN_SETTLED");
      await ensureContext();
      const staleSubmittedRevision = state.site.settings_revision;
      await onLoaded();
      await onStaleObserved();
      const successSubmittedRevision = state.site.settings_revision;
      state.site.description = description;
      state.site.settings_revision += 1;
      const confirmationSubmittedRevision = state.site.settings_revision;
      state.site.settings_revision += 1;
      events.push({ seam: "browser-adapter", operation: "general-form-save" });
      return {
        form_action: "?/site",
        stale_status: 500,
        stale_error_visible: true,
        stale_error_code: 4000,
        stale_error_message_sha256: sha256Value(REVISION_CONFLICT_MESSAGE),
        success_status: 200,
        invalidation_status: 200,
        invalidation_resource_completion: "complete",
        fresh_revision_confirmation_status: 200,
        confirmation_invalidation_status: 200,
        confirmation_resource_completion: "complete",
        stale_submitted_revision: staleSubmittedRevision,
        success_submitted_revision: successSubmittedRevision,
        confirmation_submitted_revision: confirmationSubmittedRevision,
        success_error_visible: false,
        edited_description_sha256: sha256Value(description),
        success_dom_values: semantic(state, `${PAGE_ORIGIN}/_admin`).admin.general_values,
        console_errors: [],
      };
    },
    async deniedAdmin(actor) {
      await browserContexts.setActiveFixture("S1046_ADMIN_INITIAL");
      await ensureContext(actor);
      return { actor, status: 401, settings_disclosed: false };
    },
  };
}

function dependencies(events, sourceFilesSeen) {
  return {
    collectExecutionIdentity: async (_identity, sourceFiles) => {
      sourceFilesSeen.push(...sourceFiles);
      return { schema: "fixture.execution.v1", source_clean: true, module_manifest_sha256: sha256Value(sourceFiles) };
    },
    observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", identity: "stable" }),
    assertStableRuntimeIdentity(before, after) { assert.equal(before.identity, after.identity); },
    now: () => "2026-08-10T00:00:00.000Z",
    createBrowserContexts(options) {
      assert.equal(options.credentialPolicy.mode, "private-actor-storage-states");
      assert.equal(JSON.stringify(options.credentialPolicy).includes(ADMIN_TOKEN), false);
      const contexts = new WeakSet();
      let contextCount = 0;
      return {
        setActiveFixture(fixtureId) { events.push({ seam: "gate", fixtureId }); },
        async newCandidateContext({ storageState }) {
          assert.equal(storageState.cookies.length === 0 || [ADMIN_TOKEN, NON_ADMIN_TOKEN].includes(storageState.cookies[0].value), true);
          const context = {};
          contexts.add(context);
          contextCount += 1;
          events.push({ seam: "browser-owner", operation: "context" });
          return { context, environment: { engine: "fixture" } };
        },
        async captureCandidateObservation({ context, label, index }) {
          assert.equal(contexts.has(context), true);
          events.push({ seam: "browser-owner", operation: "capture", label, index });
          return {};
        },
        async close() {
          events.push({ seam: "browser-owner", operation: "close" });
          return { browser_context_count: contextCount, browser_environments: Array.from({ length: contextCount }, () => ({ engine: "fixture" })), request_gate: { status: "closed" } };
        },
      };
    },
  };
}

test("the #754 analytics group executes its cases through the shared runner", async (t) => {
  const events = [];
  const { state, session } = fakePublicBoundary(events);
  const caseSet = createOpen43SettingsGroupCandidateCaseSet({
    group: "analytics",
    sessionFactory: () => session,
    browserAdapterFactory: (options) => fakeBrowserAdapter(options, state, events),
  });
  const sourceFiles = [];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-settings-analytics-group-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const result = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: PRIVATE_INPUT,
    privateInputSha256: sha256Value(PRIVATE_INPUT),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: dependencies(events, sourceFiles),
  });

  assert.deepEqual(result.denominator.case_ids, OPEN43_SETTINGS_ANALYTICS_CASE_IDS);
  assert.deepEqual(result.cases.map(({ case_id }) => case_id), OPEN43_SETTINGS_ANALYTICS_CASE_IDS);
  assert.equal(result.cleanup.public_restoration_verified, true);
  assert.equal(events.some(({ seam, label }) => seam === "browser-adapter" && label === "S754_ANALYTICS"), true);
  assert.equal(events.some(({ seam, operation }) => seam === "browser-adapter" && operation === "analytics-save"), true);
  assert.equal(events.some(({ seam, label }) => seam === "browser-adapter" && label === "S755_THEME"), false);
});

test("the #755 theme group changes only category themes", async (t) => {
  const events = [];
  const { state, session } = fakePublicBoundary(events);
  const caseSet = createOpen43SettingsGroupCandidateCaseSet({
    group: "theme",
    sessionFactory: () => session,
    browserAdapterFactory: (options) => fakeBrowserAdapter(options, state, events),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-settings-theme-group-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const result = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: {},
    privateInputSha256: sha256Value({}),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: dependencies(events, []),
  });

  assert.deepEqual(result.denominator.case_ids, OPEN43_SETTINGS_THEME_CASE_IDS);
  assert.equal(result.cleanup.public_restoration_verified, true);
  assert.equal(state.site.google_analytics_enabled, false);
  assert.equal(state.site.show_top_toolbar, false);
  assert.equal(state.categories.get("_default").theme_kind, "built_in");
  assert.equal(state.categories.get("corpus").theme_kind, "built_in");
  const actions = events.filter(({ seam }) => seam === "action").map(({ name }) => name);
  assert.equal(actions.includes("analytics"), false);
  assert.equal(actions.includes("toolbar"), false);
  assert.equal(actions.every((name) => name === "theme"), true);
  assert.equal(events.filter(({ seam, label }) => seam === "browser-adapter" && label === "S755_THEME").length, 2);
});

test("the real Settings CandidateCaseSet runs all nine configured cases exactly once through the shared runner", async (t) => {
  const events = [];
  const { state, session } = fakePublicBoundary(events);
  const caseSet = createOpen43SettingsBrowserCandidateCaseSet({
    sessionFactory: () => session,
    browserAdapterFactory: (options) => fakeBrowserAdapter(options, state, events),
  });
  const sourceFiles = [];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-settings-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const result = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: PRIVATE_INPUT,
    privateInputSha256: sha256Value(PRIVATE_INPUT),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: dependencies(events, sourceFiles),
  });

  assert.deepEqual(result.denominator.case_ids, OPEN43_SETTINGS_BROWSER_CASE_IDS);
  assert.deepEqual(result.cases.map(({ case_id }) => case_id), OPEN43_SETTINGS_BROWSER_CASE_IDS);
  assert.equal(new Set(result.cases.map(({ case_id }) => case_id)).size, 9);
  assert.equal(result.cleanup.public_restoration_verified, true);
  assert.equal(result.browser_cleanup.browser_context_count, 3);
  assert.deepEqual([...state.pages.keys()].sort(), [FIXTURE.default_category.page_slug, FIXTURE.transition_category.page_slug].sort());
  assert.equal(state.site.description, "Before description");
  assert.equal(state.site.google_analytics_enabled, false);
  assert.equal(state.site.show_top_toolbar, false);
  assert.equal(state.categories.get("_default").theme_kind, "built_in");
  assert.equal(state.categories.get("corpus").theme_kind, "built_in");
  assert.equal(events.some(({ seam, name }) => seam === "action" && name === "autonumber"), false);
  assert.equal(events.some(({ seam, method }) => seam === "rpc" && method === "page_delete"), false);

  const firstCleanup = events.findIndex((event) => event.cleanup === true);
  const browserClose = events.findIndex((event) => event.seam === "browser-owner" && event.operation === "close");
  assert.ok(firstCleanup > 0);
  assert.ok(browserClose > 0 && browserClose < firstCleanup);
  assert.equal(events.slice(firstCleanup).some((event) => event.seam === "browser-adapter" || event.seam === "gate"), false);
  assert.equal(events.slice(firstCleanup).every((event) => ["rpc", "action"].includes(event.seam)), true);
  const fixtures = events.filter(({ seam }) => seam === "gate").map(({ fixtureId }) => fixtureId);
  for (const fixtureId of OPEN43_SETTINGS_BROWSER_CASE_IDS.filter((id) => !id.endsWith("MATRIX"))) assert.equal(fixtures.includes(fixtureId), true, `${fixtureId} lacks runner-owned gate attribution`);
  assert.equal(events.some(({ seam, method, target }) => seam === "rpc" && method === "site_get" && target === FIXTURE.cross_site_sentinel_id), true);
  assert.equal(events.some(({ seam, name, siteId }) => seam === "action" && name === "site" && siteId === FIXTURE.cross_site_sentinel_id), true);
  assert.equal(events.some(({ seam, operation }) => seam === "browser-adapter" && operation === "general-form-save"), true);
  assert.equal(events.some(({ seam, label, navigationFromUrl }) => seam === "browser-adapter" && label === "S755_THEME" && navigationFromUrl === `${PAGE_ORIGIN}/${FIXTURE.default_category.page_slug}`), true);
  const firstMutation = events.findIndex(({ seam }) => seam === "action");
  const firstSettingsRead = events.findIndex(({ seam, method }) => seam === "rpc" && method !== "session_get");
  const actorSessionReads = events.filter(({ seam, method }) => seam === "rpc" && method === "session_get");
  assert.equal(actorSessionReads.length, 3);
  assert.equal(events.indexOf(actorSessionReads.at(-1)) < firstSettingsRead, true);
  assert.equal(events.indexOf(actorSessionReads.at(-1)) < firstMutation, true);
  const firstVisualCapture = events.findIndex(
    ({ seam, label }) => seam === "browser-adapter" && label !== undefined,
  );
  const nonAdminPermissionProbe = events.findIndex(
    ({ seam, name, actor }) =>
      seam === "action" && name === "site" && actor === "non_admin",
  );
  const deniedAdminProbe = events.findIndex(
    ({ seam, fixtureId }) =>
      seam === "gate" && fixtureId === "S1046_ADMIN_INITIAL",
  );
  assert.ok(nonAdminPermissionProbe > 0 && nonAdminPermissionProbe < firstVisualCapture);
  assert.ok(deniedAdminProbe > 0 && deniedAdminProbe < firstVisualCapture);

  const requiredSources = [
    "candidate-browser-contexts.mjs",
    "standing-browser-parity-observation.mjs",
    "standing-browser-parity-browser-session.mjs",
    "browser-request-gate.mjs",
    "capture-egress-proxy.mjs",
    "standing-browser-parity-receipt.mjs",
    "standing-browser-parity-util.mjs",
    "candidate-case-command.mjs",
    "candidate-case-http.mjs",
    "open43-settings-browser-candidate-case-set.mjs",
    "open43-settings-browser-candidate-contract.mjs",
    "open43-settings-candidate-http.mjs",
    "package.json",
    "pnpm-lock.yaml",
  ];
  for (const name of requiredSources) assert.equal(sourceFiles.some((file) => file.endsWith(name)), true, `${name} missing from source identity`);

  const outputFiles = await fs.readdir(path.join(root, "evidence"), { recursive: true });
  const published = (await Promise.all(outputFiles.filter((file) => file.endsWith(".json")).map((file) => fs.readFile(path.join(root, "evidence", file), "utf8")))).join("\n");
  for (const secret of [ADMIN_TOKEN, NON_ADMIN_TOKEN, EXPIRED_TOKEN, RPC_TOKEN, TLS_CA]) assert.equal(published.includes(secret), false);
  assert.equal(published.includes("fixture-csp-nonce"), false);
  assert.equal(published.includes("wikijump_token"), false);
  assert.equal(published.includes("expired_user_id"), false);
  for (const caseId of OPEN43_SETTINGS_BROWSER_CASE_IDS.slice(0, 8)) {
    const row = JSON.parse(await fs.readFile(path.join(root, "evidence", "cases", `${caseId}.json`), "utf8"));
    const temporalValues = [...(row.observations.disabled_captures ?? []), ...(row.observations.captures ?? [])].map(({ temporal }) => temporal);
    if (row.observations.disabled_temporal) temporalValues.push(row.observations.disabled_temporal, row.observations.enabled_temporal);
    else if (row.observations.default_temporal) temporalValues.push(row.observations.default_temporal, row.observations.transition_temporal, row.observations.category_transition_temporal);
    else if (row.observations.temporal) temporalValues.push(row.observations.temporal);
    for (const value of temporalValues) assert.ok(value.artifact.path && value.artifact.sha256);
  }
  const analyticsInitial = JSON.parse(await fs.readFile(path.join(root, "evidence", "cases", "S754_ANALYTICS_INITIAL.json"), "utf8"));
  const analyticsSettled = JSON.parse(await fs.readFile(path.join(root, "evidence", "cases", "S754_ANALYTICS_SETTLED.json"), "utf8"));
  assert.notEqual(analyticsInitial.observations.enabled_temporal.artifact.path, analyticsSettled.observations.temporal.artifact.path);
  assert.equal(analyticsSettled.observations.analytics.client_navigation_preserved_document, true);
  assert.equal(analyticsInitial.observations.enabled.initial_navigation_csp_header_sha256, sha256Value("fixture-csp-policy"));
  const themeInitial = JSON.parse(await fs.readFile(path.join(root, "evidence", "cases", "S755_THEME_INITIAL.json"), "utf8"));
  assert.equal(themeInitial.observations.transition_theme.computed_marker, "open43-corpus-0123456789ab");
  assert.equal(themeInitial.observations.category_transition_theme.computed_marker, "open43-corpus-0123456789ab");
  assert.deepEqual(themeInitial.observations.transition_theme.capture_failures, []);
  assert.deepEqual(themeInitial.observations.category_transition_theme.capture_failures, []);
  const adminSettled = JSON.parse(await fs.readFile(path.join(root, "evidence", "cases", "S1046_ADMIN_SETTLED.json"), "utf8"));
  assert.equal(adminSettled.observations.lifecycle.invalidation_status, 200);
  assert.equal(adminSettled.observations.lifecycle.fresh_revision_confirmation_status, 200);
  assert.equal(adminSettled.observations.lifecycle.client_resource_completion, "complete");
  const toolbarInitial = JSON.parse(await fs.readFile(path.join(root, "evidence", "cases", "S757_TOOLBAR_INITIAL.json"), "utf8"));
  assert.equal(toolbarInitial.observations.disabled_captures[0].top_toolbar_count, 0);
  assert.equal(toolbarInitial.observations.captures[0].top_toolbar_count, 1);
  const toolbarSettled = JSON.parse(await fs.readFile(path.join(root, "evidence", "cases", "S757_TOOLBAR_SETTLED.json"), "utf8"));
  assert.equal(toolbarSettled.observations.setting_transition.before_top_toolbar_count, 0);
  assert.equal(toolbarSettled.observations.setting_transition.client_immediate_top_toolbar_count, 1);
  assert.equal(toolbarSettled.observations.setting_transition.client_settled_top_toolbar_count, 1);
  assert.notEqual(toolbarSettled.observations.setting_transition.initial_temporal.artifact.path, toolbarSettled.observations.setting_transition.settled_temporal.artifact.path);
});

test("the real toolbar candidate group runs through the canonical runner with an identity-bound no-replace receipt", async (t) => {
  const events = [];
  const { state, session } = fakePublicBoundary(events);
  const caseSet = createOpen43SettingsGroupCandidateCaseSet({
    group: "toolbar",
    sessionFactory: () => session,
    browserAdapterFactory: (options) => fakeBrowserAdapter(options, state, events),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-settings-toolbar-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, "evidence");
  const identity = candidateIdentity();
  const options = {
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: PRIVATE_INPUT,
    privateInputSha256: sha256Value(PRIVATE_INPUT),
    outputDir,
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: dependencies(events, []),
  };
  const result = await runCandidateCaseSet(options);

  assert.equal(result.status, "pass");
  assert.deepEqual(result.denominator.case_ids, OPEN43_SETTINGS_TOOLBAR_CASE_IDS);
  assert.deepEqual(result.cases.map(({ case_id }) => case_id), OPEN43_SETTINGS_TOOLBAR_CASE_IDS);
  assert.equal(result.cleanup.public_restoration_verified, true);
  assert.equal(state.site.show_top_toolbar, false);
  assert.equal(state.site.show_bottom_toolbar, true);
  assert.equal(events.filter(({ seam, label }) => seam === "browser-adapter" && label === "S757_TOOLBAR").length, 6);
  assert.equal(events.some(({ seam, name, cleanup }) => seam === "action" && name === "toolbar" && cleanup === true), true);

  const initial = JSON.parse(await fs.readFile(path.join(outputDir, "cases", "S757_TOOLBAR_INITIAL.json"), "utf8"));
  const settled = JSON.parse(await fs.readFile(path.join(outputDir, "cases", "S757_TOOLBAR_SETTLED.json"), "utf8"));
  assert.deepEqual(initial.observations.disabled_captures.map(({ top_toolbar_count }) => top_toolbar_count), [0, 0, 0]);
  assert.deepEqual(initial.observations.captures.map(({ top_toolbar_count }) => top_toolbar_count), [1, 1, 1]);
  assert.deepEqual(settled.observations.captures.map(({ geometry }) => geometry), [{ width: 500, height: 42 }, { width: 0, height: 0 }, { width: 0, height: 0 }]);
  assert.equal(settled.observations.setting_transition.before_top_toolbar_count, 0);
  assert.equal(settled.observations.setting_transition.client_immediate_top_toolbar_count, 1);
  assert.equal(settled.observations.setting_transition.client_settled_top_toolbar_count, 1);
  const failedRequestIdentity = sha256Value({ failures: [], request_gate_aborts: [], client_failures: [], client_request_gate_aborts: [] });
  for (const row of [...initial.observations.disabled_captures, ...initial.observations.captures]) assert.equal(row.failed_request_identity_sha256, failedRequestIdentity);
  assert.equal(settled.observations.setting_transition.failed_request_identity_sha256, failedRequestIdentity);
  for (const receipt of [initial, settled]) {
    assert.equal(receipt.status, "pass");
    assert.equal(receipt.candidate_identity_sha256, sha256Value(identity));
    assert.equal(receipt.private_input_sha256, sha256Value(PRIVATE_INPUT));
    assert.equal(receipt.evidence_identity.fixture_sha256, sha256Value(FIXTURE));
    assert.match(receipt.evidence_identity.source_sha256, /^[0-9a-f]{64}$/u);
    assert.match(receipt.evidence_identity.cleanup_sha256, /^[0-9a-f]{64}$/u);
  }
  await assert.rejects(runCandidateCaseSet(options), /output directory already exists/u);
  assert.deepEqual((await fs.readdir(path.join(outputDir, "cases"))).sort(), ["S757_TOOLBAR_INITIAL.json", "S757_TOOLBAR_SETTLED.json"]);
});

test("#1046 runs its three public cases without changing unrelated settings", async (t) => {
  const expectedCaseIds = [
    "S1046_ADMIN_INITIAL",
    "S1046_ADMIN_SETTLED",
    "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX",
  ];
  assert.deepEqual((await candidateCaseSet("open43-settings-admin")).caseIds, expectedCaseIds);

  const events = [];
  const { state, session } = fakePublicBoundary(events);
  const caseSet = createOpen43SettingsGroupCandidateCaseSet({
    group: "admin",
    sessionFactory: () => session,
    browserAdapterFactory: (options) => fakeBrowserAdapter(options, state, events),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-settings-admin-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const result = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: {},
    privateInputSha256: sha256Value({}),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: dependencies(events, []),
  });

  assert.deepEqual(result.denominator.case_ids, expectedCaseIds);
  assert.deepEqual(result.cases.map(({ case_id: caseId }) => caseId), expectedCaseIds);
  assert.equal(result.cleanup.public_restoration_verified, true);
  assert.equal(state.site.description, "Before description");
  assert.equal(state.site.google_analytics_enabled, false);
  assert.equal(state.site.show_top_toolbar, false);
  assert.equal(state.categories.get("_default").theme_kind, "built_in");
  assert.equal(state.categories.get("corpus").theme_kind, "built_in");
  const actions = events.filter(({ seam }) => seam === "action").map(({ name }) => name);
  assert.equal(actions.includes("theme"), false);
  assert.equal(actions.includes("toolbar"), false);
  assert.equal(actions.filter((name) => name === "analytics").length, 1);
  assert.deepEqual(events.filter(({ seam, label }) => seam === "browser-adapter" && label !== undefined).map(({ label }) => label), ["S1046_ADMIN", "S1046_ADMIN"]);
});

test("the real Settings CaseSet verifies direct and client theme evidence independently", async (t) => {
  for (const [fault, pattern] of [
    [{ directThemeFailure: true }, /direct target theme capture/u],
    [{ directThemeStale: true }, /theme observation is stale/u],
    [{ clientThemeStale: true }, /client transition theme/u],
  ]) {
    const events = [];
    const { state, session } = fakePublicBoundary(events);
    const caseSet = createOpen43SettingsBrowserCandidateCaseSet({
      sessionFactory: () => session,
      browserAdapterFactory: (options) => fakeBrowserAdapter(options, state, events, fault),
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-settings-theme-failure-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const identity = candidateIdentity();
    await assert.rejects(
      runCandidateCaseSet({ candidateIdentity: identity, candidateIdentitySha256: sha256Value(identity), privateInput: {}, privateInputSha256: sha256Value({}), outputDir: path.join(root, "evidence"), caseSet, runId: "candidate-run-0123456789ab", dependencies: dependencies(events, []) }),
      pattern,
    );
  }
});

test("Settings rejects any sealed candidate identity outside the exact editable origin", async (t) => {
  const caseSet = createOpen43SettingsBrowserCandidateCaseSet({ sessionFactory: () => { throw new Error("session must not be constructed"); } });
  const identity = candidateIdentity("scp-wiki.wikijump.localhost");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wrong-open43-settings-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    runCandidateCaseSet({ candidateIdentity: identity, candidateIdentitySha256: sha256Value(identity), privateInput: {}, privateInputSha256: sha256Value({}), outputDir: path.join(root, "evidence"), caseSet, runId: "candidate-run-0123456789ab", dependencies: dependencies([], []) }),
    /exact non-standing scpaiueouiuiuiui\.wikijump\.localhost/u,
  );
});

test("the sealed browser throttle statement binds private actor storage without persisting a credential", () => {
  const policy = { mode: "private-actor-storage-states", storage_state_count: 2, private_input_identity_sha256: sha256Value({ administrator_session_sha256: sha256Value(ADMIN_TOKEN) }) };
  const config = parityBrowserThrottleConfig({
    args: { mode: "candidate-case" },
    runId: "fixture-run",
    lock: { path: "/private/lock", owner: "fixture" },
    policy: { sha256: hash("c"), value: { policy_version: "fixture-v1" } },
    localOrigins: [PAGE_ORIGIN],
    candidate: candidateIdentity().candidate.endpoint,
    credentialPolicy: policy,
  });
  assert.notEqual(config.credentials, "none");
  assert.equal(config.credentials.private_input_identity_sha256, policy.private_input_identity_sha256);
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes(ADMIN_TOKEN), false);
  assert.equal(serialized.includes("wikijump_token"), false);
  assert.equal(serialized.includes("cookie"), false);
});
