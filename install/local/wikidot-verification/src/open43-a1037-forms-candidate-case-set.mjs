import { CandidateHttpSession, requestCandidateCaseHttp } from "./candidate-case-http.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  sha256Text,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_A1037_CASE_IDS = Object.freeze([
  "A1037_NEWPAGE_EXACT_CANDIDATE",
  "A1037_REDIRECT_EXACT_CANDIDATE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const NEWPAGE_SOURCE = '[[module NewPage category="A1037_CATEGORY" button="Create page" format="/^[a-z0-9-]+$/"]]';
const REDIRECT_SOURCE = '[[module Redirect destination="A1037_REDIRECT_TARGET"]]';
const REDIRECT_MISSING_SOURCE = "[[module Redirect]]";
const REDIRECT_ERROR_BLOCK = "This is the Redirect module that redirects the browser directly to the &quot;A1037_REDIRECT_TARGET&quot; page.";
const REDIRECT_MISSING_ERROR_BLOCK = '<div class="error-block">No redirection destination specified. Please use the destination="page-name" or destination="url" attribute.</div>';
const NEWPAGE_BOX = 'class="new-page-box"';
const NEWPAGE_FORM = 'action="dummy.html"';
const NEWPAGE_ONSUBMIT = "WIKIDOT.modules.NewPageHelperModule.listeners.create(event);";
const NEWPAGE_INPUT_NAME = 'name="pageName" type="text"';
const NEWPAGE_INPUT_MAXLENGTH = 'maxlength="128"';
const NEWPAGE_BUTTON = 'value="Create page"';
const NEWPAGE_NO_NAME_MESSAGE = "You should provide a page name";
const NEWPAGE_INCORRECT_NAME_MESSAGE = "The page name is not correct: please fix it and try again";
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const TIMEOUT_MS = 300_000;

class Open43A1037CandidateSession {
  #session;
  #editorSessionToken;
  #candidateIdentity;
  #rawInput;

  constructor({ candidateIdentity, privateInput, signal }) {
    this.#session = new CandidateHttpSession({ candidateIdentity, privateInput, signal });
    this.#editorSessionToken = this.#session.editorSessionToken;
    this.#candidateIdentity = candidateIdentity;
    this.#rawInput = privateInput;
  }

  get editorUserId() { return this.#session.editorUserId; }
  get editorSessionToken() { return this.#session.editorSessionToken; }
  get pageOrigin() { return this.#session.pageOrigin; }
  get privateInputIdentity() { return this.#session.privateInputIdentity; }
  get requiredServiceBindings() { return this.#session.requiredServiceBindings; }
  get events() { return this.#session.events; }

  async rpc(method, params = {}, options = {}) {
    return await this.#session.rpc(method, params, options);
  }

  async ajaxModuleConnector(fields, options = {}) {
    return await this.#session.ajaxModuleConnector(fields, options);
  }

  async pageRouteRequest(pathname, options = {}) {
    return await this.#session.pageRouteRequest(pathname, options);
  }

  async redirectProbe(pathname) {
    const candidate = this.#candidateIdentity.candidate;
    const tlsCa = requireNonEmptyString(this.#rawInput.tls_ca_pem, "A1037 private input tls_ca_pem");
    const response = await requestCandidateCaseHttp({
      url: new URL(pathname, this.pageOrigin),
      method: "GET",
      connectAddress: candidate.endpoint.local_connect_address,
      tlsCa,
    });
    return {
      status: response.status,
      location: typeof response.headers.location === "string" ? response.headers.location : null,
      body_sha256: sha256Text(response.body),
    };
  }

  storageState() {
    return {
      cookies: [{ name: "wikijump_token", value: this.#editorSessionToken, url: this.pageOrigin, httpOnly: true, secure: true, sameSite: "Lax" }],
      origins: [],
    };
  }
}

function newpageSource(category) {
  return NEWPAGE_SOURCE.replace("A1037_CATEGORY", category);
}

function redirectSource(target) {
  return REDIRECT_SOURCE.replace("A1037_REDIRECT_TARGET", target);
}

function redirectErrorBlock(target) {
  return REDIRECT_ERROR_BLOCK.replaceAll("A1037_REDIRECT_TARGET", target);
}

function redirectFixture(value) {
  const fixture = requirePlainObject(value?.a1037_redirect_fixture, "A1037 imported redirect fixture");
  const sourcePage = requirePlainObject(fixture.source_page, "A1037 imported redirect source page");
  const targetPage = requirePlainObject(fixture.target_page, "A1037 imported redirect target page");
  for (const [name, page] of [["source", sourcePage], ["target", targetPage]]) {
    if (!Number.isSafeInteger(page.page_id) || page.page_id <= 0 || !Number.isSafeInteger(page.revision_id) || page.revision_id <= 0) {
      throw new Error(`A1037 imported redirect ${name} page identity is invalid`);
    }
    requireNonEmptyString(page.slug, `A1037 imported redirect ${name} slug`);
  }
  const source = redirectSource(targetPage.slug);
  const sourceSha256 = sha256Text(source);
  if (sourcePage.source_sha256 !== sourceSha256) throw new Error("A1037 imported redirect source hash is not the fixed fixture");
  return Object.freeze({
    sourcePage: Object.freeze({ page_id: sourcePage.page_id, revision_id: sourcePage.revision_id, slug: sourcePage.slug, source_sha256: sourceSha256 }),
    targetPage: Object.freeze({ page_id: targetPage.page_id, revision_id: targetPage.revision_id, slug: targetPage.slug }),
    source,
  });
}

function pageSlug(runId, kind) {
  return `${kind}-a1037-${runId.slice("candidate-run-".length)}`;
}

function requireEnvelope(value, name) {
  const envelope = requirePlainObject(value, `${name} envelope`);
  if (envelope.http_status !== 200 || envelope.content_type !== "text/plain; charset=UTF-8") {
    throw new Error(`${name} envelope drifted`);
  }
  return requirePlainObject(envelope.json, `${name} JSON`);
}

function verifyNewPageCase(caseId, observations) {
  const value = requirePlainObject(observations, `${caseId} observations`);
  const render = requirePlainObject(value.render, `${caseId} render`);
  if (render.status !== 200 || typeof render.body !== "string") throw new Error(`${caseId} served render drifted`);
  for (const marker of [NEWPAGE_BOX, NEWPAGE_FORM, NEWPAGE_ONSUBMIT, NEWPAGE_INPUT_NAME, NEWPAGE_INPUT_MAXLENGTH, NEWPAGE_BUTTON]) {
    if (!render.body.includes(marker)) throw new Error(`${caseId} render is missing ${marker}`);
  }
  if (!render.body.includes(`name="categoryName" value="${value.category}"`)) throw new Error(`${caseId} render category hidden field drifted`);

  const anonymousEdit = requireEnvelope(value.anonymous_edit, `${caseId} anonymous edit`);
  if (anonymousEdit.status !== "ok" || anonymousEdit.unixName !== value.edit_unix_name || anonymousEdit.pageTitle !== value.edit_page_name) {
    throw new Error(`${caseId} anonymous edit routing drifted`);
  }
  const noName = requireEnvelope(value.no_name, `${caseId} no_name`);
  if (noName.status !== "no_name" || noName.message !== NEWPAGE_NO_NAME_MESSAGE) throw new Error(`${caseId} no_name envelope drifted`);
  const incorrect = requireEnvelope(value.incorrect_name, `${caseId} incorrect_name`);
  if (incorrect.status !== "incorrect_name" || incorrect.message !== NEWPAGE_INCORRECT_NAME_MESSAGE) throw new Error(`${caseId} incorrect_name envelope drifted`);
  const anonymousAutosave = requireEnvelope(value.anonymous_autosave, `${caseId} anonymous autosave`);
  if (anonymousAutosave.status !== "no_permission") throw new Error(`${caseId} anonymous autosave denial drifted`);

  const autosave = requireEnvelope(value.autosave, `${caseId} autosave`);
  if (autosave.status !== "ok" || autosave.goToUrl !== value.autosave_unix_name) throw new Error(`${caseId} authenticated autosave drifted`);
  const pageExists = requireEnvelope(value.page_exists, `${caseId} page_exists`);
  if (pageExists.status !== "page_exists" || !pageExists.message.includes(`The page <em>${value.autosave_unix_name}</em> already exists.`)) {
    throw new Error(`${caseId} page_exists envelope drifted`);
  }

  const browser = requirePlainObject(value.browser, `${caseId} browser`);
  if (browser.edit_route !== value.browser_unix_name || browser.browser_mutation_count !== 1 || browser.navigation_count < 1) {
    throw new Error(`${caseId} browser helper navigation drifted`);
  }
  if (browser.error_popup_visible === true || browser.source_disclosure === true) throw new Error(`${caseId} browser helper leaked state`);

  return {
    verified: true,
    render_shell_verified: true,
    anonymous_edit_routing_verified: true,
    autosave_creation_verified: true,
    page_exists_verified: true,
    browser_helper_navigation_verified: true,
  };
}

function verifyRedirectCase(caseId, observations, plan) {
  const value = requirePlainObject(observations, `${caseId} observations`);
  const bare = requirePlainObject(value.bare, `${caseId} bare`);
  if (bare.status !== 301 || typeof bare.location !== "string" || !bare.location.endsWith(plan.target_slug)) {
    throw new Error(`${caseId} bare redirect drifted`);
  }
  const noredirect = requirePlainObject(value.noredirect, `${caseId} noredirect`);
  if (noredirect.status !== 200 || typeof noredirect.body !== "string" || !noredirect.body.includes(plan.error_block)) {
    throw new Error(`${caseId} noredirect notice drifted`);
  }
  const missing = requirePlainObject(value.missing, `${caseId} missing destination`);
  if (missing.status !== 200 || typeof missing.body !== "string" || !missing.body.includes(REDIRECT_MISSING_ERROR_BLOCK)) {
    throw new Error(`${caseId} missing-destination error drifted`);
  }
  return {
    verified: true,
    bare_301_verified: true,
    noredirect_notice_verified: true,
    missing_destination_frozen_error_verified: true,
  };
}

function verifyCleanup(proof, resources) {
  const value = requirePlainObject(proof, "A1037 cleanup proof");
  if (
    value.public_absence_verified !== true ||
    value.pages_absent !== true ||
    !Array.isArray(resources) ||
    resources.length !== 3 ||
    resources.some((resource) => resource.released !== true)
  ) {
    throw new Error("A1037 cleanup did not prove public absence and resource release");
  }
  return { verified: true, public_absence_verified: true, pages_absent: true };
}

class Open43A1037Run {
  #sessions;
  #browserContexts;
  #resources;
  #runId;
  #pageOrigin;
  #siteId = null;
  #newpageSlug = null;
  #redirectSlug = null;
  #redirectTargetSlug = null;
  #redirectMissingSlug = null;
  #pageResources = [];
  #plans = new Map();

  constructor({ sessions, browserContexts, resources, runId, pageOrigin, importedRedirectFixture }) {
    this.#sessions = sessions;
    this.#browserContexts = browserContexts;
    this.#resources = resources;
    this.#runId = runId;
    this.#pageOrigin = pageOrigin;
    const suffix = runId.slice("candidate-run-".length);
    this.#newpageSlug = pageSlug(runId, "newpage");
    this.#redirectSlug = importedRedirectFixture.sourcePage.slug;
    this.#redirectTargetSlug = importedRedirectFixture.targetPage.slug;
    this.#redirectMissingSlug = pageSlug(runId, "redirect-missing");
    this.#category = `a1037-newpage-${suffix}`;
    this.#importedRedirectFixture = importedRedirectFixture;
  }

  #category;
  #newpageEditName = null;
  #autosaveName = null;
  #importedRedirectFixture;

  async #rpc(actor, method, params = {}, { siteId = this.#siteId, cleanup = false } = {}) {
    return await this.#sessions[actor].rpc(method, params, { actor: "editor", siteId: siteId ?? undefined, cleanup });
  }

  async #page(slug, { cleanup = false } = {}) {
    return await this.#rpc("administrator", "page_get", {
      site_id: this.#siteId,
      page: slug,
      details: { wikitext: true, compiled: false },
    }, { cleanup });
  }

  async #deletePage(slug, { cleanup = false } = {}) {
    const page = await this.#page(slug, { cleanup });
    if (page === null) return;
    await this.#rpc("administrator", "page_delete", {
      site_id: this.#siteId,
      page: page.page_id,
      last_revision_id: page.revision_id,
      revision_comments: "Open43 A1037 candidate cleanup",
      user_id: this.#sessions.administrator.editorUserId,
      ip_address: "127.0.0.1",
    }, { cleanup });
    if ((await this.#page(slug, { cleanup })) !== null) throw new Error(`A1037 page removal did not clear ${slug}`);
  }

  async #createPage(slug, wikitext, title) {
    const created = await this.#rpc("administrator", "page_create", {
      site_id: this.#siteId,
      slug,
      title: title ?? `candidate-case-owner:${slug}`,
      alt_title: null,
      wikitext,
      layout: "wikidot",
      user_id: this.#sessions.administrator.editorUserId,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 A1037 forms fixture",
    });
    if (!Number.isSafeInteger(created?.page_id) || !Number.isSafeInteger(created.revision_id) || created.slug !== slug) {
      throw new Error(`A1037 page_create did not return a public fixture identity for ${slug}`);
    }
    this.#pageResources.push({ slug, token: this.#resources.register("page", {
      page_id: created.page_id,
      site_id: this.#siteId,
      slug,
      source_sha256: sha256Text(wikitext),
    }) });
    return created;
  }

  async #executeNewPageCase() {
    const suffix = this.#runId.slice("candidate-run-".length);
    this.#newpageEditName = `created-${suffix}`;
    this.#autosaveName = `autosaved-${suffix}`;
    const render = await this.#sessions.anonymous.pageRouteRequest(`/${encodeURIComponent(this.#newpageSlug)}`, { actor: "anonymous" });
    if (render?.status !== 200 || typeof render.body_sha256 !== "string") throw new Error("A1037 NewPage served render drifted");
    const renderText = await this.#pageBody(render);
    const amc = (fields) => this.#sessions.anonymous.ajaxModuleConnector(fields, { actor: "anonymous" });
    const editForm = {
      action: "misc/NewPageHelperAction",
      event: "createNewPage",
      moduleName: "Empty",
      pageName: this.#newpageEditName,
      categoryName: this.#category,
      callbackIndex: "1",
    };
    const anonymousEdit = await amc({ ...editForm });
    const noName = await amc({ ...editForm, pageName: "" });
    const incorrect = await amc({ ...editForm, pageName: "BAD_NAME", format: "/^[a-z]+$/" });
    const anonymousAutosave = await amc({ ...editForm, pageName: this.#autosaveName, mode: "save-and-go" });
    const editorAutosave = await this.#sessions.editor.ajaxModuleConnector({ ...editForm, pageName: this.#autosaveName, mode: "save-and-go" }, { actor: "editor" });
    const pageExists = await this.#sessions.editor.ajaxModuleConnector({ ...editForm, pageName: this.#autosaveName, mode: "save-and-go" }, { actor: "editor" });
    const autosaveSlug = `${this.#category}:${this.#autosaveName}`;
    const autosavePage = await this.#page(autosaveSlug);
    if (autosavePage === null) throw new Error("A1037 autosave did not create the empty page");
    this.#pageResources.push({ slug: autosaveSlug, token: this.#resources.register("page", {
      page_id: autosavePage.page_id,
      site_id: this.#siteId,
      slug: autosaveSlug,
      source_sha256: sha256Text(""),
    }) });

    await this.#browserContexts.setActiveFixture("A1037_NEWPAGE_EXACT_CANDIDATE");
    const { context } = await this.#browserContexts.newCandidateContext({ storageState: this.#sessions.editor.storageState(), viewport: VIEWPORT });
    const page = await context.newPage();
    let browserMutationCount = 0;
    let navigationCount = 0;
    const onRequest = (request) => {
      if (request.method() === "POST" && request.url().includes("ajax-module-connector.php")) browserMutationCount += 1;
    };
    const onNavigation = () => { navigationCount += 1; };
    page.on("request", onRequest);
    page.on("framenavigated", onNavigation);
    let browser;
    try {
      const url = `${this.#pageOrigin}/${encodeURIComponent(this.#newpageSlug)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.locator('input.text[name="pageName"]').waitFor({ state: "visible", timeout: TIMEOUT_MS });
      const browserName = `browser-${suffix}`;
      await page.locator('input.text[name="pageName"]').fill(browserName);
      await page.locator('form:has(input.text[name="pageName"]) input[type="submit"]').click();
      const expectedRoute = `/${this.#category}:${browserName}/edit/true/title/${browserName}`;
      await page.waitForURL((candidateUrl) => candidateUrl.pathname === expectedRoute, { timeout: TIMEOUT_MS });
      browser = {
        edit_route: `${this.#category}:${browserName}`,
        browser_mutation_count: browserMutationCount,
        navigation_count: navigationCount,
        error_popup_visible: await page.evaluate(() => document.querySelectorAll("#odialog-container").length > 0),
        source_disclosure: await page.evaluate(() => document.body?.innerText.includes("[[module NewPage") === true),
      };
    } finally {
      page.off("request", onRequest);
      page.off("framenavigated", onNavigation);
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
    this.#plans.set(OPEN43_A1037_CASE_IDS[0], {});
    return [{
      case_id: OPEN43_A1037_CASE_IDS[0],
      observations: {
        category: this.#category,
        edit_unix_name: `${this.#category}:${this.#newpageEditName}`,
        edit_page_name: this.#newpageEditName,
        autosave_unix_name: `${this.#category}:${this.#autosaveName}`,
        browser_unix_name: browser.edit_route,
        render: { status: render.status, body: renderText },
        anonymous_edit: anonymousEdit,
        no_name: noName,
        incorrect_name: incorrect,
        anonymous_autosave: anonymousAutosave,
        autosave: editorAutosave,
        page_exists: pageExists,
        browser,
      },
    }];
  }

  async #pageBody(response) {
    if (typeof response.body_sha256 === "string" && typeof response.body_base64 === "string") {
      return Buffer.from(response.body_base64, "base64").toString("utf8");
    }
    if (typeof response.body === "string") return response.body;
    throw new Error("A1037 served response carried no body");
  }

  async #executeRedirectCase() {
    const target = this.#redirectTargetSlug;
    const fixture = this.#importedRedirectFixture;
    const sourcePage = await this.#page(this.#redirectSlug);
    const targetPage = await this.#page(target);
    if (
      sourcePage?.page_id !== fixture.sourcePage.page_id ||
      sourcePage.revision_id !== fixture.sourcePage.revision_id ||
      sourcePage.slug !== fixture.sourcePage.slug ||
      sourcePage.wikitext !== fixture.source
    ) {
      throw new Error("A1037 imported Redirect source fixture identity drifted");
    }
    if (
      targetPage?.page_id !== fixture.targetPage.page_id ||
      targetPage.revision_id !== fixture.targetPage.revision_id ||
      targetPage.slug !== fixture.targetPage.slug
    ) {
      throw new Error("A1037 imported Redirect target fixture identity drifted");
    }
    const bare = await this.#sessions.anonymous.redirectProbe(`/${encodeURIComponent(this.#redirectSlug)}`);
    const noredirect = await this.#sessions.anonymous.pageRouteRequest(`/${encodeURIComponent(this.#redirectSlug)}/noredirect/true`, { actor: "anonymous" });
    const missing = await this.#sessions.anonymous.pageRouteRequest(`/${encodeURIComponent(this.#redirectMissingSlug)}`, { actor: "anonymous" });
    this.#plans.set(OPEN43_A1037_CASE_IDS[1], {
      target_slug: target,
      error_block: redirectErrorBlock(target),
    });
    return [{
      case_id: OPEN43_A1037_CASE_IDS[1],
      observations: {
        bare: { status: bare?.status, location: bare?.location ?? null, body_sha256: bare?.body_sha256 ?? null },
        noredirect: { status: noredirect?.status, body: await this.#pageBody(noredirect) },
        missing: { status: missing?.status, body: await this.#pageBody(missing) },
      },
    }];
  }

  async execute() {
    const adminSession = await this.#rpc("administrator", "session_get", [this.#sessions.administrator.editorSessionToken], { siteId: null });
    const editorSession = await this.#rpc("editor", "session_get", [this.#sessions.editor.editorSessionToken], { siteId: null });
    if (adminSession?.user_id !== this.#sessions.administrator.editorUserId || editorSession?.user_id !== this.#sessions.editor.editorUserId || adminSession.user_id === editorSession.user_id) {
      throw new Error("A1037 actor session identity drifted");
    }
    const site = await this.#rpc("administrator", "site_get", { site: SITE_SLUG }, { siteId: null });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) throw new Error("A1037 editable candidate site is missing");
    this.#siteId = site.site_id;
    await this.#createPage(this.#newpageSlug, newpageSource(this.#category));
    await this.#createPage(this.#redirectMissingSlug, REDIRECT_MISSING_SOURCE);
    const rows = [
      ...(await this.#executeNewPageCase()),
      ...(await this.#executeRedirectCase()),
    ];
    return rows;
  }

  async cleanup() {
    const failures = [];
    let pagesAfter = true;
    try {
      if (this.#siteId !== null) {
        const slugs = [this.#newpageSlug, this.#redirectMissingSlug];
        if (this.#autosaveName !== null) slugs.push(`${this.#category}:${this.#autosaveName}`);
        for (const slug of slugs) await this.#deletePage(slug, { cleanup: true });
      }    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "A1037 public cleanup failed");
    if (this.#siteId !== null) {
      for (const resource of this.#pageResources) {
        if ((await this.#page(resource.slug, { cleanup: true })) !== null) pagesAfter = false;
        else this.#resources.release(resource.token, { page_get: null });
      }
    }
    return { public_absence_verified: pagesAfter, pages_absent: pagesAfter };
  }

  verifyCase(caseId, observations) {
    if (!this.#plans.has(caseId)) throw new Error("A1037 case was not executed");
    const plan = this.#plans.get(caseId);
    if (caseId === OPEN43_A1037_CASE_IDS[0]) return verifyNewPageCase(caseId, observations);
    return verifyRedirectCase(caseId, observations, plan);
  }
}

const SOURCE_FILES = Object.freeze([
  ...new Set([
    ...STANDING_BROWSER_EXECUTION_MODULES,
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/open43-a1037-forms-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    "framerail/src/lib/server/ajax-module-connector.js",
    "framerail/src/lib/wikidot/wikidot-new-page-helper.js",
    "framerail/src/routes/ajax-module-connector.php/+server.ts",
    "framerail/src/routes/+layout.svelte",
    "deepwell/src/services/view/redirect.rs",
    "deepwell/src/services/view/service.rs",
    "deepwell/src/endpoints/page.rs",
    "deepwell/tests/page.rs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]),
]);

export function createOpen43A1037FormsCandidateCaseSet({
  sessionFactory = (options) => new Open43A1037CandidateSession(options),
} = {}) {
  return Object.freeze({
    id: "open43-a1037-forms",
    caseIds: OPEN43_A1037_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      const candidate = requirePlainObject(candidateIdentity?.candidate, "A1037 candidate identity");
      const endpoint = requirePlainObject(candidate.endpoint, "A1037 candidate endpoint");
      if (endpoint.host !== SITE_HOST || endpoint.port === 443 || candidate.port_443_published !== false) {
        throw new Error(`A1037 requires an exact non-standing ${SITE_HOST} candidate`);
      }
      const baseInput = requirePlainObject(privateInput, "private A1037 candidate input");
      const importedRedirectFixture = redirectFixture(baseInput);
      const administrator = sessionFactory({ candidateIdentity, privateInput: { ...baseInput, actors: { editor: requirePlainObject(baseInput.actors?.administrator, "A1037 administrator actor") } }, signal });
      const editor = sessionFactory({ candidateIdentity, privateInput: { ...baseInput, actors: { editor: requirePlainObject(baseInput.actors?.editor, "A1037 editor actor") } }, signal });
      const anonymous = sessionFactory({ candidateIdentity, privateInput: baseInput, signal });
      if (!Number.isSafeInteger(editor.editorUserId) || !Number.isSafeInteger(administrator.editorUserId) || editor.editorUserId === administrator.editorUserId) {
        throw new Error("A1037 private actors must have distinct safe user IDs");
      }
      const pageOrigin = administrator.pageOrigin;
      if (pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("A1037 session did not bind the candidate origin");
      const sessions = { administrator, editor, anonymous };
      const execution = new Open43A1037Run({
        sessions,
        browserContexts: candidateBrowserContexts,
        resources,
        runId,
        pageOrigin,
        importedRedirectFixture,
      });
      const privateInputIdentity = {
        editor_user_id: editor.editorUserId,
        administrator_user_id: administrator.editorUserId,
        editor_session_sha256: sha256Value(editor.privateInputIdentity),
        imported_redirect_fixture_sha256: sha256Value(importedRedirectFixture),
      };
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: [...new Map([...administrator.requiredServiceBindings, ...editor.requiredServiceBindings].map((binding) => [JSON.stringify(binding), binding])).values()],
        privateInputIdentity,
        browserCredentialPolicy: { mode: "private-actor-storage-states", storage_state_count: 1, private_input_identity_sha256: sha256Value(privateInputIdentity) },
        plan: {
          schema: "wikijump.open43_a1037_forms_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_origin: pageOrigin,
          actor_user_ids: { editor: editor.editorUserId, administrator: administrator.editorUserId },
          imported_redirect_fixture: {
            source_page: importedRedirectFixture.sourcePage,
            target_page: importedRedirectFixture.targetPage,
          },
          case_ids: OPEN43_A1037_CASE_IDS,
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup,
      });
    },
  });
}
