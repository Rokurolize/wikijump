import { createHash } from "node:crypto";
import fs from "node:fs";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { requireNonEmptyString, requirePlainObject, requireSha256, sha256Value } from "./standing-browser-parity-util.mjs";

const AUDIT = JSON.parse(fs.readFileSync(new URL("../../../../docs/development/open43-m-closure-audit.json", import.meta.url), "utf8"));
const MEDIA_ISSUES = new Set([756, 776, 806, 1039, 1043, 1062]);
const AUDIT_ROWS = AUDIT.issues
  .filter(({ issue }) => MEDIA_ISSUES.has(issue))
  .flatMap(({ subrows }) => subrows)
  .filter(({ classification, next_command_ids }) => classification === "candidate_required" && next_command_ids.includes("C_MEDIA_BROWSER_CANDIDATE"));

export const OPEN43_MEDIA_BROWSER_CASE_IDS = Object.freeze(AUDIT_ROWS.map(({ case_id }) => case_id));
if (JSON.stringify(OPEN43_MEDIA_BROWSER_CASE_IDS) !== JSON.stringify([
  "M756_BROWSER_CACHE_TRANSITIONS",
  "M776_BROWSER_GEOMETRY_AND_NETWORK",
  "M806_BROWSER_GEOMETRY_AND_NETWORK",
  "M1043_BROWSER_RENDER_AND_VIEWER",
  "M1062_BROWSER_UPLOAD_FLOW",
])) throw new Error("Open43 media browser audit denominator drifted");

const SITE_SLUG = "scpaiueouiuiuiui";
const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const RESPONSIVE_VIEWPORT = Object.freeze({ width: 479, height: 900 });
const MAX_CENTER_DELTA = 0.5;
const MEDIUM_RESIZE_LONGEST_SIDE = 500;
const INITIAL_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC", "base64");
const SECOND_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAAEAQMAAACeIXx6AAAAA1BMVEUAAP+KeNJXAAAAC0lEQVQI12NggAAAAAgAAS8g3TEAAAAASUVORK5CYII=", "base64");
const EVIDENCE_BY_CASE = Object.freeze({
  M756_BROWSER_CACHE_TRANSITIONS: "E_ICON_OBSERVATIONS",
  M776_BROWSER_GEOMETRY_AND_NETWORK: "E_G06",
  M806_BROWSER_GEOMETRY_AND_NETWORK: "E_G61",
  M1043_BROWSER_RENDER_AND_VIEWER: "E_FOCUSED_CORPUS",
  M1062_BROWSER_UPLOAD_FLOW: "E_UPLOAD_HISTORICAL_FAILURE",
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const object = (value, name) => requirePlainObject(value, name);

function evidenceRegistryEntry(evidenceId) {
  const entry = object(AUDIT.evidence_registry?.[evidenceId], `${evidenceId} audit evidence`);
  return Object.freeze({
    evidence_id: evidenceId,
    path: requireNonEmptyString(entry.path, `${evidenceId}.path`),
    sha256: requireSha256(entry.sha256, `${evidenceId}.sha256`),
  });
}

function mediaBrowserInput(rawInput) {
  const input = object(rawInput, "private candidate case input");
  const browser = object(input.media_browser, "private input media_browser");
  if (!Array.isArray(browser.cases) || browser.cases.length !== OPEN43_MEDIA_BROWSER_CASE_IDS.length) throw new Error("private input media_browser.cases does not match the audit denominator");
  const actualIds = browser.cases.map(({ case_id }) => case_id);
  if (JSON.stringify(actualIds) !== JSON.stringify(OPEN43_MEDIA_BROWSER_CASE_IDS)) throw new Error("private input media_browser.cases must follow the audit denominator exactly");
  return Object.freeze(browser.cases.map((row) => {
    const expectedEvidence = evidenceRegistryEntry(EVIDENCE_BY_CASE[row.case_id]);
    const evidence = object(row.evidence, `${row.case_id}.evidence`);
    if (evidence.evidence_id !== expectedEvidence.evidence_id || evidence.path !== expectedEvidence.path || evidence.sha256 !== expectedEvidence.sha256) throw new Error(`${row.case_id} private evidence identity does not match the audit registry`);
    const bytes = fs.readFileSync(expectedEvidence.path);
    if (sha256(bytes) !== expectedEvidence.sha256) throw new Error(`${row.case_id} frozen evidence SHA-256 does not match`);
    return Object.freeze({ case_id: row.case_id, evidence: expectedEvidence });
  }));
}

function editorStorageState(session) {
  return {
    cookies: [{
      name: "wikijump_token",
      value: session.editorSessionToken,
      url: session.pageOrigin,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    }],
    origins: [],
  };
}

function candidateUrl(origin, slug) {
  return new URL(`/${encodeURIComponent(slug)}`, origin).href;
}

function candidateOwnedUrl(value) {
  const url = new URL(value);
  return url.hostname.endsWith(".wikijump.localhost") || url.hostname.endsWith(".wjfiles.localhost");
}

function attachDiagnostics(page, phase = null) {
  const state = { requests: [], failures: [], console_errors: [], page_errors: [], csp_violations: [] };
  page.on("request", (request) => state.requests.push({ method: request.method(), resource_type: request.resourceType(), url: request.url() }));
  page.on("requestfailed", (request) => state.failures.push({
    url: request.url(),
    method: request.method(),
    resource_type: request.resourceType(),
    error: request.failure()?.errorText ?? null,
    phase: typeof phase === "function" ? phase() : null,
  }));
  page.on("console", (message) => { if (message.type() === "error") state.console_errors.push(sha256(message.text())); });
  page.on("pageerror", (error) => state.page_errors.push(sha256(error.message)));
  return state;
}

function trackRequestQuiescence(page, predicate) {
  const active = new Set();
  let lastActivity = Date.now();
  const onRequest = (request) => {
    if (!predicate(request)) return;
    active.add(request);
    lastActivity = Date.now();
  };
  const onSettled = (request) => {
    if (!active.delete(request)) return;
    lastActivity = Date.now();
  };
  page.on("request", onRequest);
  page.on("requestfinished", onSettled);
  page.on("requestfailed", onSettled);
  return Object.freeze({
    async waitForQuiet({ quietMs = 500, timeoutMs = 10_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        const now = Date.now();
        if (active.size === 0 && now - lastActivity >= quietMs) {
          return Object.freeze({ active_count: 0, quiet_ms: now - lastActivity });
        }
        if (now >= deadline) throw new Error("candidate request quiescence timed out");
        await new Promise((resolve) => setTimeout(resolve, Math.min(50, deadline - now)));
      }
    },
    close() {
      page.off("request", onRequest);
      page.off("requestfinished", onSettled);
      page.off("requestfailed", onSettled);
    },
  });
}

async function installCspProbe(page) {
  await page.addInitScript(() => {
    globalThis.__open43MediaCspViolations = [];
    addEventListener("securitypolicyviolation", (event) => globalThis.__open43MediaCspViolations.push({
      blocked_uri: event.blockedURI,
      directive: event.effectiveDirective,
      disposition: event.disposition,
    }));
  });
}

async function finishDiagnostics(page, diagnostics) {
  diagnostics.csp_violations = await page.evaluate(() => globalThis.__open43MediaCspViolations ?? []).catch(() => []);
  return {
    candidate_requests: diagnostics.requests.filter(({ url }) => candidateOwnedUrl(url)).map(({ method, resource_type, url }) => ({ method, resource_type, pathname: new URL(url).pathname, url_sha256: sha256(url) })),
    candidate_failures: diagnostics.failures.filter(({ url }) => candidateOwnedUrl(url)).map(({ url, method, error, resource_type, phase }) => ({ pathname: new URL(url).pathname, method: method ?? null, resource_type: resource_type ?? null, error, phase: phase ?? null })),
    console_errors: [...diagnostics.console_errors],
    page_errors: [...diagnostics.page_errors],
    csp_violations: diagnostics.csp_violations,
  };
}

function mediaImageSnapshot() {
  const images = [...document.querySelectorAll("#page-content img.image")];
  return {
    viewport: { width: innerWidth, height: innerHeight },
    images: images.map((image) => {
      const rect = image.getBoundingClientRect();
      const container = image.closest(".image-container");
      const containerRect = container?.getBoundingClientRect();
      const link = image.closest("a");
      return {
        container_class: container?.className ?? null,
        complete: image.complete,
        natural_width: image.naturalWidth,
        natural_height: image.naturalHeight,
        width_attribute: image.getAttribute("width"),
        computed_width: getComputedStyle(image).width,
        rendered_width: Math.round(rect.width * 100) / 100,
        rendered_height: Math.round(rect.height * 100) / 100,
        center_delta: containerRect ? Math.round(Math.abs((rect.left + rect.width / 2) - (containerRect.left + containerRect.width / 2)) * 100) / 100 : null,
        source_url: image.currentSrc || image.src,
        click_target_url: link?.href ?? null,
      };
    }),
  };
}

async function observeImagePage(browser, session, slug, expectedImageCount) {
  const owned = await browser.newCandidateContext({ viewport: DEFAULT_VIEWPORT });
  const page = await owned.context.newPage();
  const diagnostics = attachDiagnostics(page);
  await installCspProbe(page);
  const url = candidateUrl(session.pageOrigin, slug);
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 300_000 });
    if (response?.status() !== 200 || page.url() !== url) throw new Error(`${slug} browser navigation failed`);
    const initial = await page.evaluate(mediaImageSnapshot);
    if (expectedImageCount > 0) await page.waitForFunction((count) => {
      const images = [...document.querySelectorAll("#page-content img.image")];
      return images.length === count && images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    }, expectedImageCount, { timeout: 300_000 });
    const settled = await page.evaluate(mediaImageSnapshot);
    await page.setViewportSize(RESPONSIVE_VIEWPORT);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const responsive = await page.evaluate(mediaImageSnapshot);
    return { url, initial, settled, responsive, diagnostics: await finishDiagnostics(page, diagnostics) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

function lightboxSnapshot() {
  const visible = (selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const image = document.querySelector("#lightbox-image");
  return {
    overlay_count: document.querySelectorAll("#jquery-overlay").length,
    lightbox_count: document.querySelectorAll("#jquery-lightbox").length,
    loading_visible: visible("#lightbox-loading"),
    image_visible: visible("#lightbox-image"),
    previous_visible: visible("#lightbox-nav-btnPrev"),
    next_visible: visible("#lightbox-nav-btnNext"),
    current_number: document.querySelector("#lightbox-image-details-currentNumber")?.textContent?.trim() ?? "",
    image_url: image instanceof HTMLImageElement ? image.currentSrc || image.src : null,
    active_element: document.activeElement instanceof HTMLElement ? (document.activeElement.id || document.activeElement.localName) : "",
  };
}

function iconSnapshot() {
  const favicon = document.querySelector('link[rel="shortcut icon"], link[rel="icon"]');
  return {
    href: favicon instanceof HTMLLinkElement ? favicon.href : null,
    pathname: favicon instanceof HTMLLinkElement ? new URL(favicon.href).pathname : null,
    document_token: globalThis.__open43MediaDocumentToken ?? null,
  };
}

async function browserIconFetch(context, pageOrigin) {
  const probe = await context.newPage();
  try {
    const response = await probe.goto(new URL("/local--favicon/favicon.gif", pageOrigin).href, {
      waitUntil: "commit",
      timeout: 300_000,
    });
    if (!response) throw new Error("favicon browser navigation returned no response");
    const body = await probe.evaluate(async () => {
      const current = await fetch(location.href, { cache: "default" });
      const bytes = new Uint8Array(await current.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      return {
        status: current.status,
        final_url: current.url,
        body_sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      };
    });
    if (body.status !== response.status() || body.final_url !== response.url()) throw new Error("favicon browser body fetch changed the committed resource identity");
    return body;
  } finally {
    await probe.close().catch(() => undefined);
  }
}

class Open43MediaBrowserRun {
  #session;
  #browser;
  #resources;
  #runId;
  #casePlans;
  #siteId = null;
  #pages = [];
  #siteIconsBefore = null;

  constructor({ session, browser, resources, runId, casePlans }) {
    this.#session = session;
    this.#browser = browser;
    this.#resources = resources;
    this.#runId = runId;
    this.#casePlans = casePlans;
  }

  async #rpc(method, params = {}, { cleanup = false } = {}) {
    return await this.#session.rpc(method, params, { siteId: this.#siteId ?? undefined, cleanup });
  }

  async #createPage(suffix, source, { title = null } = {}) {
    const runSuffix = this.#runId.slice("candidate-run-".length);
    const slug = `open43-media-browser-${runSuffix}-${suffix}`;
    const marker = title ?? `candidate-case-owner:${slug}`;
    if (await this.#rpc("page_get", { site_id: this.#siteId, page: slug, details: { wikitext: false, compiled: false } })) throw new Error(`${slug} namespace already exists`);
    const page = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug,
      title: marker,
      alt_title: null,
      wikitext: source,
      layout: "wikidot",
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 media browser candidate fixture",
    });
    if (!Number.isSafeInteger(page?.page_id) || !Number.isSafeInteger(page?.revision_id) || page.slug !== slug) throw new Error(`${slug} page identity is missing`);
    const resource = this.#resources.register("page", { page_id: page.page_id, slug, marker });
    const owned = { page_id: page.page_id, revision_id: page.revision_id, slug, marker, resource };
    this.#pages.push(owned);
    return owned;
  }

  async #editPage(page, source) {
    const current = await this.#rpc("page_get", { site_id: this.#siteId, page: page.slug, details: { wikitext: true, compiled: false } });
    const edited = await this.#rpc("page_edit", {
      site_id: this.#siteId,
      page: page.page_id,
      last_revision_id: current.revision_id,
      revision_comments: "Open43 media browser source fixture",
      user_id: this.#session.editorUserId,
      wikitext: source,
      ip_address: "127.0.0.1",
    });
    page.revision_id = edited.revision_id;
    return edited;
  }

  async #upload(page, name, bytes) {
    const current = await this.#rpc("page_get", { site_id: this.#siteId, page: page.slug, details: { wikitext: false, compiled: false } });
    const action = await this.#session.multipartFileAction(page.slug, {
      siteId: this.#siteId,
      pageId: page.page_id,
      lastRevisionId: current.revision_id,
      name,
      comments: "Open43 media browser fixture upload",
    }, { name, mime: "image/png", bytes });
    let result;
    try { result = JSON.parse(action.response_body); } catch { throw new Error(`${name} upload returned non-JSON`); }
    if (action.http_status !== 200 || result?.type !== "success") throw new Error(`${name} candidate upload failed`);
    const inventory = await this.#rpc("page_get_files", { site_id: this.#siteId, page_id: page.page_id, deleted: false });
    const row = inventory.find((candidate) => candidate.name === name);
    if (!Number.isSafeInteger(row?.file_id) || !Number.isSafeInteger(row?.revision_id) || row.size !== bytes.length) throw new Error(`${name} public file identity is missing`);
    return row;
  }

  async #setFaviconSource(source) {
    const site = await this.#rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.settings_revision)) throw new Error("media browser site settings revision is missing");
    this.#siteIconsBefore ??= { favicon_source: site.favicon_source ?? null, ios_icon_source: site.ios_icon_source ?? null, windows_tile_source: site.windows_tile_source ?? null };
    return await this.#rpc("site_update", {
      site: this.#siteId,
      expected_settings_revision: site.settings_revision,
      user_id: this.#session.editorUserId,
      favicon_source: source,
      ios_icon_source: site.ios_icon_source ?? null,
      windows_tile_source: site.windows_tile_source ?? null,
      ip_address: "127.0.0.1",
    });
  }

  async #faviconCase() {
    const main = await this.#createPage("favicon-main", "FAVICON_BROWSER_MAIN");
    const next = await this.#createPage("favicon-next", "FAVICON_BROWSER_NEXT");
    await this.#editPage(main, `FAVICON_BROWSER_MAIN\n[[[${next.slug}|next]]]`);
    await this.#upload(main, "icon-a.png", INITIAL_BYTES);
    await this.#upload(main, "icon-b.png", SECOND_BYTES);
    const firstSource = `/local--files/${main.slug}/icon-a.png`;
    const secondSource = `/local--files/${main.slug}/icon-b.png`;
    await this.#setFaviconSource(firstSource);

    const owned = await this.#browser.newCandidateContext({ viewport: DEFAULT_VIEWPORT });
    const page = await owned.context.newPage();
    const diagnostics = attachDiagnostics(page);
    await installCspProbe(page);
    try {
      const firstUrl = candidateUrl(this.#session.pageOrigin, main.slug);
      if ((await page.goto(firstUrl, { waitUntil: "domcontentloaded", timeout: 300_000 }))?.status() !== 200) throw new Error("M756 initial navigation failed");
      await page.evaluate(() => { globalThis.__open43MediaDocumentToken = crypto.randomUUID(); });
      const first = await page.evaluate(iconSnapshot);
      const firstFetch = await browserIconFetch(owned.context, this.#session.pageOrigin);

      await this.#setFaviconSource(secondSource);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 300_000 });
      const reload = await page.evaluate(iconSnapshot);
      const reloadFetch = await browserIconFetch(owned.context, this.#session.pageOrigin);
      await page.evaluate(() => { globalThis.__open43MediaDocumentToken = crypto.randomUUID(); });
      const token = (await page.evaluate(iconSnapshot)).document_token;
      await page.locator(`#page-content a[href$="/${next.slug}"]`).click({ timeout: 300_000 });
      await page.waitForURL(candidateUrl(this.#session.pageOrigin, next.slug), { timeout: 300_000 });
      const client = await page.evaluate(iconSnapshot);
      const clientFetch = await browserIconFetch(owned.context, this.#session.pageOrigin);
      return {
        first_source: firstSource,
        second_source: secondSource,
        first,
        first_fetch: firstFetch,
        reload,
        reload_fetch: reloadFetch,
        client: { ...client, document_preserved: client.document_token === token },
        client_fetch: clientFetch,
        diagnostics: await finishDiagnostics(page, diagnostics),
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async #imageCase(centered) {
    const caseLabel = centered ? "m806" : "m776";
    const filename = centered ? "center.png" : "float.png";
    const positive = await this.#createPage(`${caseLabel}-positive`, "IMAGE_FIXTURE_PENDING");
    const negative = await this.#createPage(`${caseLabel}-negative`, "IMAGE_FIXTURE_PENDING");
    await this.#upload(positive, filename, INITIAL_BYTES);
    await this.#upload(negative, filename, INITIAL_BYTES);
    const positiveSource = centered
      ? `[[=image ${filename} width="100px"]]\n[[=image  ${filename}  width="100px"]]`
      : `[[f<image ${filename} width="100px" alt="G06_IMAGE_ALT"]]`;
    const negativeSource = centered
      ? `[[=image\u00a0${filename} width="100px"]]`
      : `[[f=image\u00a0${filename} width="100px" alt="G06_IMAGE_ALT"]]`;
    await this.#editPage(positive, positiveSource);
    await this.#editPage(negative, negativeSource);
    const positivePage = await this.#rpc("page_get", { site_id: this.#siteId, page: positive.slug, details: { wikitext: true, compiled: true } });
    if (positivePage?.wikitext !== positiveSource || typeof positivePage.compiled_body_html !== "string") throw new Error(`${caseLabel} public compiled fixture is missing`);
    const positiveObservation = await observeImagePage(this.#browser, this.#session, positive.slug, centered ? 2 : 1);
    const negativeObservation = await observeImagePage(this.#browser, this.#session, negative.slug, 0);
    return {
      source: { positive_sha256: sha256(positiveSource), negative_sha256: sha256(negativeSource), compiled_sha256: sha256(positivePage.compiled_body_html) },
      positive: positiveObservation,
      negative: negativeObservation,
      expected_file: { filename, width: MEDIUM_RESIZE_LONGEST_SIDE, height: MEDIUM_RESIZE_LONGEST_SIDE / 2, source_width: 4, source_height: 2, byte_sha256: sha256(INITIAL_BYTES) },
    };
  }

  async #galleryCase() {
    const pageFixture = await this.#createPage("gallery", "GALLERY_FIXTURE_PENDING");
    await this.#upload(pageFixture, "gallery-one.png", INITIAL_BYTES);
    await this.#upload(pageFixture, "gallery-two.png", SECOND_BYTES);
    const source = "[[gallery]]\n: gallery-one.png\n: gallery-two.png\n[[/gallery]]";
    await this.#editPage(pageFixture, source);
    const publicPage = await this.#rpc("page_get", { site_id: this.#siteId, page: pageFixture.slug, details: { wikitext: true, compiled: true } });
    if (publicPage?.wikitext !== source || !publicPage.compiled_body_html?.includes("gallery-box")) throw new Error("M1043 public Gallery fixture is missing");

    const owned = await this.#browser.newCandidateContext({ viewport: DEFAULT_VIEWPORT });
    const browserPage = await owned.context.newPage();
    const diagnostics = attachDiagnostics(browserPage);
    await installCspProbe(browserPage);
    await browserPage.route("**/-/file/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.continue();
    });
    try {
      const url = candidateUrl(this.#session.pageOrigin, pageFixture.slug);
      if ((await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: 300_000 }))?.status() !== 200) throw new Error("M1043 browser navigation failed");
      const anchors = browserPage.locator("#page-content .gallery-box a.with-lb");
      if (await anchors.count() !== 2) throw new Error("M1043 Gallery did not render two viewer anchors");
      const staticState = await anchors.evaluateAll((nodes) => nodes.map((node) => ({ href: node.href, image_src: node.querySelector("img")?.src ?? null })));
      await anchors.first().click({ timeout: 300_000 });
      const loading = await browserPage.evaluate(lightboxSnapshot);
      await browserPage.locator("#lightbox-image").waitFor({ state: "visible", timeout: 300_000 });
      const first = await browserPage.evaluate(lightboxSnapshot);
      await browserPage.keyboard.press("ArrowRight");
      await browserPage.waitForFunction(
        (expected) => document.querySelector("#lightbox-image-details-currentNumber")?.textContent?.trim() === expected,
        "image 2 of 2",
        { timeout: 300_000 },
      );
      const next = await browserPage.evaluate(lightboxSnapshot);
      await browserPage.keyboard.press("p");
      await browserPage.waitForFunction(
        (expected) => document.querySelector("#lightbox-image-details-currentNumber")?.textContent?.trim() === expected,
        "image 1 of 2",
        { timeout: 300_000 },
      );
      const previous = await browserPage.evaluate(lightboxSnapshot);
      await browserPage.keyboard.press("Escape");
      const closed = await browserPage.evaluate(lightboxSnapshot);
      return { url, source_sha256: sha256(source), static: staticState, loading, first, next, previous, closed, diagnostics: await finishDiagnostics(browserPage, diagnostics) };
    } finally {
      await browserPage.close().catch(() => undefined);
    }
  }

  async #uploadBrowserCase() {
    const pageFixture = await this.#createPage("upload", "M1062_BROWSER_UPLOAD_FLOW");
    const owned = await this.#browser.newCandidateContext({ storageState: editorStorageState(this.#session), viewport: DEFAULT_VIEWPORT });
    const page = await owned.context.newPage();
    let diagnosticPhase = "navigation";
    const diagnostics = attachDiagnostics(page, () => diagnosticPhase);
    const fileListRequests = trackRequestQuiescence(
      page,
      (request) => request.method() === "POST" && request.url().includes("?/fileList"),
    );
    await installCspProbe(page);
    const actionRequests = [];
    page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("?/fileUpload")) actionRequests.push(request.url()); });
    try {
      const url = candidateUrl(this.#session.pageOrigin, pageFixture.slug);
      if ((await page.goto(url, { waitUntil: "domcontentloaded", timeout: 300_000 }))?.status() !== 200) throw new Error("M1062 browser navigation failed");
      await page.locator("#files-button").click({ timeout: 300_000 });
      await page.locator("#action-area .buttons input.btn-primary[type=button]").waitFor({ state: "visible", timeout: 300_000 });
      await page.locator("#action-area .buttons input.btn-primary[type=button]").click();
      const form = page.locator("#file-upload");
      await form.waitFor({ state: "visible", timeout: 300_000 });
      const emptyBefore = { form_visible: await form.isVisible(), file_rows: await page.locator("#action-area .file-row").count() };
      diagnosticPhase = "empty-submit";
      const emptyResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("?/fileUpload"), { timeout: 300_000 });
      void emptyResponsePromise.catch(() => undefined);
      await form.locator('input[type="submit"]').click();
      const emptyResponse = await emptyResponsePromise;
      const errorDialog = page.locator("#odialog-container .owindow.error");
      await errorDialog.waitFor({ state: "visible", timeout: 300_000 });
      const emptyAfter = {
        form_visible: await form.isVisible(),
        file_rows: await page.locator("#action-area .file-row").count(),
        action_request_count: actionRequests.length,
        action_status: emptyResponse.status(),
        error_dialog_visible: await errorDialog.isVisible(),
      };
      await errorDialog.locator(".button-close-message").click({ timeout: 300_000 });
      await errorDialog.waitFor({ state: "hidden", timeout: 300_000 });

      await form.locator('input[type="file"]').setInputFiles({ name: "browser-upload.png", mimeType: "image/png", buffer: INITIAL_BYTES });
      const beforeSuccess = actionRequests.length;
      const pending = { request_seen: false, form_visible: false };
      diagnosticPhase = "success-submit";
      const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("?/fileUpload"), { timeout: 300_000 });
      void responsePromise.catch(() => undefined);
      await form.locator('input[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector("#file-upload") !== null, null, { timeout: 300_000 }).catch(() => undefined);
      pending.request_seen = actionRequests.length > beforeSuccess;
      pending.form_visible = await form.isVisible().catch(() => false);
      const actionResponse = await responsePromise;
      if (actionResponse.status() !== 200) throw new Error("M1062 upload action returned non-200");
      await page.locator("#action-area .file-row").filter({ hasText: "browser-upload.png" }).waitFor({ state: "visible", timeout: 300_000 });
      const fileListQuiescence = await fileListRequests.waitForQuiet();
      const success = {
        form_visible: await form.isVisible().catch(() => false),
        row_count: await page.locator("#action-area .file-row").filter({ hasText: "browser-upload.png" }).count(),
        action_request_count: actionRequests.length - beforeSuccess,
        file_list_quiescent: fileListQuiescence.active_count === 0,
        file_list_quiet_ms: fileListQuiescence.quiet_ms,
      };

      diagnosticPhase = "reload";
      await page.reload({ waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.locator("#files-button").click({ timeout: 300_000 });
      await page.locator("#action-area .file-row").filter({ hasText: "browser-upload.png" }).waitFor({ state: "visible", timeout: 300_000 });
      const downloadHref = await page.locator("#action-area .file-row").filter({ hasText: "browser-upload.png" }).locator(".file-name a").getAttribute("href");
      if (typeof downloadHref !== "string") throw new Error("M1062 browser upload row has no download link");
      const inventory = await this.#rpc("page_get_files", { site_id: this.#siteId, page_id: pageFixture.page_id, deleted: false });
      const row = inventory.find((file) => file.name === "browser-upload.png");
      if (!row) throw new Error("M1062 browser upload is absent from public inventory");
      const download = await this.#session.filesRequest(`/-/file/${pageFixture.slug}/browser-upload.png`, { actor: "editor", operation: "browser-upload-download" });

      await page.locator("#action-area .buttons input.btn-primary[type=button]").click();
      const secondForm = page.locator("#file-upload");
      await secondForm.locator('input[type="file"]').setInputFiles({ name: "browser-double.png", mimeType: "image/png", buffer: SECOND_BYTES });
      const beforeDouble = actionRequests.length;
      diagnosticPhase = "double-submit";
      const doubleResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("?/fileUpload"), { timeout: 300_000 });
      void doubleResponse.catch(() => undefined);
      await Promise.all([
        secondForm.locator('input[type="submit"]').click(),
        secondForm.locator('input[type="submit"]').click().catch(() => undefined),
      ]);
      await doubleResponse;
      await page.locator("#action-area .file-row").filter({ hasText: "browser-double.png" }).waitFor({ state: "visible", timeout: 300_000 });
      const doubleInventory = await this.#rpc("page_get_files", { site_id: this.#siteId, page_id: pageFixture.page_id, deleted: false });
      return {
        url,
        empty_submission: { before: emptyBefore, after: emptyAfter },
        pending,
        success,
        reload: { row_count: await page.locator("#action-area .file-row").filter({ hasText: "browser-upload.png" }).count(), download_href: downloadHref },
        download: { status: download.status, content_type: download.content_type, body_sha256: download.body_sha256, body_size: download.body_size },
        double_submit: { action_request_count: actionRequests.length - beforeDouble, row_count: doubleInventory.filter((file) => file.name === "browser-double.png").length },
        diagnostics: await finishDiagnostics(page, diagnostics),
      };
    } finally {
      fileListRequests.close();
      await page.close().catch(() => undefined);
    }
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id)) throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    this.#siteId = site.site_id;
    return [
      { case_id: "M756_BROWSER_CACHE_TRANSITIONS", observations: await this.#faviconCase() },
      { case_id: "M776_BROWSER_GEOMETRY_AND_NETWORK", observations: await this.#imageCase(false) },
      { case_id: "M806_BROWSER_GEOMETRY_AND_NETWORK", observations: await this.#imageCase(true) },
      { case_id: "M1043_BROWSER_RENDER_AND_VIEWER", observations: await this.#galleryCase() },
      { case_id: "M1062_BROWSER_UPLOAD_FLOW", observations: await this.#uploadBrowserCase() },
    ];
  }

  async cleanup() {
    const failures = [];
    if (this.#siteId !== null && this.#siteIconsBefore !== null) {
      try {
        const site = await this.#rpc("site_get", { site: SITE_SLUG }, { cleanup: true });
        await this.#rpc("site_update", {
          site: this.#siteId,
          expected_settings_revision: site.settings_revision,
          user_id: this.#session.editorUserId,
          ...this.#siteIconsBefore,
          ip_address: "127.0.0.1",
        }, { cleanup: true });
      } catch (error) { failures.push(error); }
    }
    const absent = [];
    for (const page of [...this.#pages].reverse()) {
      try {
        const current = await this.#rpc("page_get", { site_id: this.#siteId, page: page.slug, details: { wikitext: false, compiled: false } }, { cleanup: true });
        if (current?.page_id !== page.page_id) {
          if (current !== null) throw new Error(`${page.slug} cleanup identity changed`);
        } else {
          const files = await this.#rpc("page_get_files", { site_id: this.#siteId, page_id: page.page_id, deleted: false }, { cleanup: true });
          for (const file of files) await this.#rpc("file_delete", { site_id: this.#siteId, page_id: page.page_id, file: file.file_id, user_id: this.#session.editorUserId, last_revision_id: file.revision_id, revision_comments: "Open43 media browser cleanup" }, { cleanup: true });
          const latest = await this.#rpc("page_get", { site_id: this.#siteId, page: page.slug, details: { wikitext: false, compiled: false } }, { cleanup: true });
          await this.#rpc("page_delete", { site_id: this.#siteId, page: page.page_id, last_revision_id: latest.revision_id, revision_comments: "Open43 media browser cleanup", user_id: this.#session.editorUserId, ip_address: "127.0.0.1" }, { cleanup: true });
        }
        const after = await this.#rpc("page_get", { site_id: this.#siteId, page: page.slug, details: { wikitext: false, compiled: false } }, { cleanup: true });
        if (after !== null) throw new Error(`${page.slug} remained after cleanup`);
        this.#resources.release(page.resource, { page_get: null, slug: page.slug });
        absent.push(page.slug);
      } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "media browser cleanup failed");
    return { public_absence_verified: true, page_count: absent.length, pages: absent };
  }
}

function cleanDiagnostics(value, name, { allowCandidateFailure = null, maxAllowedCandidateFailures = 0 } = {}) {
  const source = object(value, name);
  const diagnostics = object(source.diagnostics ?? source, `${name}.diagnostics`);
  if (!Array.isArray(diagnostics.candidate_failures)) throw new Error(`${name} candidate-owned request failures are missing`);
  let allowedFailureCount = 0;
  for (const [index, rawFailure] of diagnostics.candidate_failures.entries()) {
    const failure = object(rawFailure, `${name}.diagnostics.candidate_failures[${index}]`);
    if (typeof allowCandidateFailure === "function" && allowCandidateFailure(failure) === true) {
      allowedFailureCount += 1;
      continue;
    }
    throw new Error(`${name} recorded a candidate-owned request failure: ${String(failure.resource_type ?? "unknown")} ${String(failure.pathname ?? "unknown")} ${String(failure.error ?? "unknown")} (method ${String(failure.method ?? "unknown")}, phase ${String(failure.phase ?? "unknown")})`);
  }
  if (allowedFailureCount > maxAllowedCandidateFailures) throw new Error(`${name} recorded too many tolerated candidate-owned lifecycle cancellations`);
  if (!Array.isArray(diagnostics.page_errors) || diagnostics.page_errors.length !== 0) throw new Error(`${name} emitted page errors`);
  if (!Array.isArray(diagnostics.console_errors) || diagnostics.console_errors.length !== 0) throw new Error(`${name} emitted console errors`);
  if (!Array.isArray(diagnostics.csp_violations) || diagnostics.csp_violations.some(({ blocked_uri }) => typeof blocked_uri === "string" && candidateOwnedUrl(blocked_uri))) throw new Error(`${name} violated CSP at a candidate-owned boundary`);
  return diagnostics;
}

function imagePath(caseId, value, centered) {
  const observation = object(value, `${caseId} observations`);
  cleanDiagnostics(observation.positive, `${caseId}.positive`);
  cleanDiagnostics(observation.negative, `${caseId}.negative`);
  const positive = object(observation.positive.settled, `${caseId}.positive.settled`);
  const responsive = object(observation.positive.responsive, `${caseId}.positive.responsive`);
  const negative = object(observation.negative.settled, `${caseId}.negative.settled`);
  const expectedCount = centered ? 2 : 1;
  if (!Array.isArray(positive.images) || positive.images.length !== expectedCount || !Array.isArray(responsive.images) || responsive.images.length !== expectedCount) throw new Error(`${caseId} positive image denominator is wrong`);
  if (!Array.isArray(negative.images) || negative.images.length !== 0) throw new Error(`${caseId} negative whitespace control acquired image ownership`);
  const expectedFile = object(observation.expected_file, `${caseId}.expected_file`);
  for (const [phase, snapshot] of [["settled", positive], ["responsive", responsive]]) for (const image of snapshot.images) {
    if (image.complete !== true || image.natural_width !== expectedFile.width || image.natural_height !== expectedFile.height) throw new Error(`${caseId} ${phase} image load state or natural geometry is wrong`);
    if (image.width_attribute !== "100px" || image.computed_width !== "100px" || Math.abs(image.rendered_width - 100) > 0.5) throw new Error(`${caseId} ${phase} image width is wrong`);
    if (centered ? !String(image.container_class).split(/\s+/u).includes("aligncenter") : !String(image.container_class).split(/\s+/u).includes("floatleft")) throw new Error(`${caseId} ${phase} image alignment class is wrong`);
    if (centered && (!Number.isFinite(image.center_delta) || image.center_delta > MAX_CENTER_DELTA)) throw new Error(`${caseId} ${phase} image is not centered`);
    const source = new URL(image.source_url);
    const target = new URL(image.click_target_url);
    if (!source.hostname.endsWith(".wjfiles.localhost") || source.pathname !== `/local--resized-images/${new URL(observation.positive.url).pathname.slice(1)}/${expectedFile.filename}/medium.jpg`) throw new Error(`${caseId} image source route is wrong`);
    if (!target.hostname.endsWith(".wjfiles.localhost") || target.pathname !== `/local--files/${new URL(observation.positive.url).pathname.slice(1)}/${expectedFile.filename}`) throw new Error(`${caseId} click target route is wrong`);
  }
  const requiredPath = `/local--resized-images/${new URL(observation.positive.url).pathname.slice(1)}/${expectedFile.filename}/medium.jpg`;
  if (!observation.positive.diagnostics.candidate_requests.some(({ pathname }) => pathname === requiredPath)) throw new Error(`${caseId} omitted the exact image request`);
  if (observation.negative.diagnostics.candidate_requests.some(({ pathname }) => pathname.endsWith(`/${expectedFile.filename}/medium.jpg`))) throw new Error(`${caseId} negative control requested the image`);
  return { verified: true, natural_width: expectedFile.width, natural_height: expectedFile.height, responsive_viewport: responsive.viewport, image_request_path: requiredPath, negative_boundary_verified: true };
}

export function verifyOpen43MediaBrowserCase(caseId, observations) {
  const value = object(observations, `${caseId} observations`);
  if (caseId === "M756_BROWSER_CACHE_TRANSITIONS") {
    cleanDiagnostics(value, caseId);
    for (const field of ["first", "reload", "client"]) if (object(value[field], `${caseId}.${field}`).pathname !== "/local--favicon/favicon.gif") throw new Error(`${caseId} favicon declaration route drifted`);
    if (value.first_fetch?.status !== 200 || value.reload_fetch?.status !== 200 || value.client_fetch?.status !== 200) throw new Error(`${caseId} favicon browser fetch failed`);
    if (value.first_fetch.body_sha256 !== sha256(INITIAL_BYTES) || value.reload_fetch.body_sha256 !== sha256(SECOND_BYTES) || value.client_fetch.body_sha256 !== sha256(SECOND_BYTES)) throw new Error(`${caseId} stale favicon bytes survived the setting transition`);
    if (new URL(value.first_fetch.final_url).pathname !== value.first_source || new URL(value.reload_fetch.final_url).pathname !== value.second_source || new URL(value.client_fetch.final_url).pathname !== value.second_source) throw new Error(`${caseId} favicon redirect did not follow the active setting`);
    return {
      verified: true,
      initial_icon_sha256: value.first_fetch.body_sha256,
      transitioned_icon_sha256: value.reload_fetch.body_sha256,
      client_navigation_observed: true,
      client_navigation_preserved_document: value.client.document_preserved === true,
    };
  }
  if (caseId === "M776_BROWSER_GEOMETRY_AND_NETWORK") return imagePath(caseId, value, false);
  if (caseId === "M806_BROWSER_GEOMETRY_AND_NETWORK") return imagePath(caseId, value, true);
  if (caseId === "M1043_BROWSER_RENDER_AND_VIEWER") {
    cleanDiagnostics(value, caseId);
    if (!Array.isArray(value.static) || value.static.length !== 2 || value.static.some(({ href, image_src }) => !new URL(href).hostname.endsWith(".wjfiles.localhost") || !new URL(image_src).hostname.endsWith(".wjfiles.localhost"))) throw new Error(`${caseId} static Gallery file identity is wrong`);
    if (value.loading?.overlay_count !== 1 || value.loading.lightbox_count !== 1 || value.loading.loading_visible !== true || value.loading.image_visible !== false) throw new Error(`${caseId} loading interval is wrong`);
    if (value.first?.image_visible !== true || value.first.loading_visible !== false || value.first.current_number !== "image 1 of 2" || value.first.previous_visible !== false || value.first.next_visible !== true) throw new Error(`${caseId} first viewer state is wrong`);
    if (value.next?.current_number !== "image 2 of 2" || value.next.previous_visible !== true || value.next.next_visible !== false || value.next.image_url === value.first.image_url) throw new Error(`${caseId} next navigation state is wrong`);
    if (value.previous?.current_number !== "image 1 of 2" || value.previous.image_url !== value.first.image_url) throw new Error(`${caseId} previous keyboard state is wrong`);
    if (value.closed?.overlay_count !== 0 || value.closed.lightbox_count !== 0) throw new Error(`${caseId} viewer did not close`);
    return { verified: true, viewer_loading_verified: true, navigation_verified: true, keyboard_verified: true, close_verified: true, static_anchor_count: 2 };
  }
  if (caseId === "M1062_BROWSER_UPLOAD_FLOW") {
    const uploadPage = typeof value.url === "string" ? new URL(value.url) : null;
    cleanDiagnostics(value, caseId, {
      allowCandidateFailure: (failure) => uploadPage !== null
        && ["success-submit", "double-submit"].includes(failure.phase)
        && failure.method === "GET"
        && failure.resource_type === "fetch"
        && failure.pathname === `${uploadPage.pathname}/__data.json`
        && failure.error === "net::ERR_ABORTED",
      maxAllowedCandidateFailures: 1,
    });
    if (value.empty_submission?.before?.form_visible !== true || value.empty_submission.after?.form_visible !== true || value.empty_submission.after?.file_rows !== value.empty_submission.before.file_rows || value.empty_submission.after?.action_request_count !== 1 || value.empty_submission.after?.action_status !== 200 || value.empty_submission.after?.error_dialog_visible !== true) throw new Error(`${caseId} empty upload did not expose the exact failed action interval`);
    if (value.pending?.request_seen !== true || value.pending.form_visible !== true) throw new Error(`${caseId} did not expose the in-flight upload interval`);
    if (value.success?.form_visible !== false || value.success.row_count !== 1 || value.success.action_request_count !== 1 || value.success.file_list_quiescent !== true || !Number.isFinite(value.success.file_list_quiet_ms) || value.success.file_list_quiet_ms < 500) throw new Error(`${caseId} successful upload did not reach a settled file-list refresh`);
    if (value.reload?.row_count !== 1 || typeof value.reload.download_href !== "string" || !value.reload.download_href.includes("/-/file/")) throw new Error(`${caseId} upload did not survive reload with a download route`);
    if (value.download?.status !== 200 || value.download.body_size !== INITIAL_BYTES.length || value.download.body_sha256 !== sha256(INITIAL_BYTES)) throw new Error(`${caseId} download bytes are wrong`);
    if (value.double_submit?.action_request_count !== 1 || value.double_submit.row_count !== 1) throw new Error(`${caseId} double submit committed or dispatched more than once`);
    return { verified: true, empty_failure_verified: true, loading_verified: true, success_refresh_verified: true, reload_verified: true, exact_download_verified: true, double_submit_verified: true };
  }
  throw new Error(`unsupported Open43 media browser case: ${caseId}`);
}

function verifyCleanup(proof, resources) {
  const value = object(proof, "media browser cleanup proof");
  if (value.public_absence_verified !== true || !Number.isSafeInteger(value.page_count) || value.page_count < 1 || resources.some((resource) => resource.released !== true)) throw new Error("media browser cleanup did not prove run-owned public absence");
  return { verified: true, public_absence_verified: true, page_count: value.page_count };
}

export function createOpen43MediaBrowserCandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  return Object.freeze({
    id: "open43-media-browser",
    caseIds: OPEN43_MEDIA_BROWSER_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      if (candidateIdentity.candidate.endpoint.host !== `${SITE_SLUG}.wikijump.localhost` || candidateIdentity.candidate.endpoint.port === 443) throw new Error(`Open43 media browser cases require the exact non-standing ${SITE_SLUG} candidate`);
      const casePlans = mediaBrowserInput(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      const execution = new Open43MediaBrowserRun({ session, browser: candidateBrowserContexts, resources, runId, casePlans });
      return Object.freeze({
        sourceFiles: Object.freeze([...new Set([...STANDING_BROWSER_EXECUTION_MODULES, "docs/development/open43-m-closure-audit.json", "framerail/src/lib/wikidot/wikidot-gallery-lightbox.js", "framerail/src/routes/[slug]/[...extra]/FileUploadPanel.svelte", "wws/src/handler/resized_image.rs", "install/local/wikidot-verification/src/open43-media-browser-candidate.mjs"])]),
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: { ...session.privateInputIdentity, media_browser_evidence_sha256: sha256Value(casePlans) },
        browserCredentialPolicy: { mode: "private-actor-storage-states", storage_state_count: 1, private_input_identity_sha256: sha256Value(session.privateInputIdentity) },
        plan: { schema: "wikijump.open43_media_browser_candidate_plan.v3", site_slug: SITE_SLUG, case_ids: OPEN43_MEDIA_BROWSER_CASE_IDS, evidence: casePlans },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyOpen43MediaBrowserCase(caseId, observations),
        verifyCleanup,
      });
    },
  });
}
