import { createHash } from "node:crypto";

import { parse as parseDevalue } from "devalue";

import { waitForBrowserParitySettledResources } from "./standing-browser-parity-observation.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const CAPTURE_TIMEOUT_MS = 300_000;

async function submittedSettingsRevision(response) {
  const request = response.request();
  const contentType = request.headers()["content-type"];
  const body = request.postDataBuffer();
  if (typeof contentType !== "string" || body === null) throw new Error("settings action request body is missing");
  const formData = await new Response(body, { headers: { "content-type": contentType } }).formData();
  const payload = parseDevalue(formData.getAll("__superform_json").join(""));
  if (!Number.isSafeInteger(payload?.expectedSettingsRevision)) throw new Error("settings action request revision is missing");
  return payload.expectedSettingsRevision;
}

async function visibleFailureIdentity(response, page) {
  const result = await response.json();
  const data = typeof result?.data === "string" ? parseDevalue(result.data) : null;
  const message = (await page.locator("#modal-title").innerText()).trim();
  if (result?.type !== "failure" || !Number.isSafeInteger(data?.code) || message.length === 0) throw new Error("settings action failure identity is missing");
  return { code: data.code, message_sha256: sha256Value(message) };
}

function browserSemanticSnapshot() {
  const queue = Array.isArray(globalThis._gaq)
    ? globalThis._gaq.map((entry) => [
        String(entry[0] ?? "").replace(/^userTracker\./u, ""),
        ...entry.slice(1),
      ])
    : [];
  const styleOrder = [];
  for (const element of document.head.querySelectorAll("link[rel='stylesheet'], style")) {
    let kind = null;
    if (element.hasAttribute("data-wikidot-site-theme")) kind = "site";
    else if (
      element.hasAttribute("data-wikidot-generated-css") ||
      [...element.attributes].some(({ name }) => name.startsWith("data-wikidot-style"))
    ) kind = "page";
    else if (element.localName === "link" && new URL(element.href).pathname.startsWith("/wikidot/styles/")) kind = "base";
    if (kind !== null && styleOrder.at(-1) !== kind) styleOrder.push(kind);
  }
  const names = ["unixName", "name", "subtitle", "language", "description", "default_page", "welcome_page"];
  const generalControls = [...document.querySelectorAll("#sm-general-form [name]")]
    .map((element) => element.getAttribute("name"))
    .filter((name) => names.includes(name));
  const generalValues = Object.fromEntries(
    names.map((name) => [name, document.querySelector(`#sm-general-form [name='${name}']`)?.value ?? null]),
  );
  const nonce = document.querySelector("script[nonce]")?.nonce ?? "";
  const siteThemes = [...document.head.querySelectorAll("[data-wikidot-site-theme]")];
  const bodyStyle = getComputedStyle(document.body);
  const toolbar = document.querySelector("#navi-bar");
  const toolbarLink = toolbar?.querySelector("a");
  const toolbarBounds = toolbar?.getBoundingClientRect();
  const linkBounds = toolbarLink?.getBoundingClientRect();
  return {
    analytics: {
      profile: document.querySelector("meta[name='wikidot-site-analytics-profile']")?.content ?? null,
      queue,
      nonce,
      meta_present: document.querySelector("meta[name='wikidot-site-analytics-profile']") !== null,
      script_count: [...document.scripts].filter((script) => script.textContent.includes("userTracker._setAccount")).length,
    },
    theme: {
      marker: getComputedStyle(document.documentElement).getPropertyValue("--open43-theme-marker").trim(),
      stylesheet_order: styleOrder,
      site_theme_count: siteThemes.length,
      site_theme_css: siteThemes.length === 1 ? siteThemes[0].textContent : null,
      body_font_family: bodyStyle.fontFamily,
      body_background_color: bodyStyle.backgroundColor,
      body_color: bodyStyle.color,
    },
    toolbar: {
      top_toolbar_count: document.querySelectorAll("#navi-bar").length,
      geometry: toolbarBounds ? { width: toolbarBounds.width, height: toolbarBounds.height } : null,
      hit_target: linkBounds ? { width: linkBounds.width, height: linkBounds.height } : null,
    },
    page_content_text: document.querySelector("#page-content")?.textContent?.trim() ?? "",
    admin: {
      controls: generalControls,
      general_values: generalValues,
    },
  };
}

const INITIAL_PROBE = `globalThis.__open43DocumentIdentity=crypto.randomUUID();globalThis.__open43SemanticSnapshot=${browserSemanticSnapshot.toString()};document.addEventListener("DOMContentLoaded",()=>{globalThis.__open43InitialObservation=globalThis.__open43SemanticSnapshot()},{once:true});`;

async function activateClientNavigation(page) {
  await page.evaluate(() => {
    const link = document.querySelector("#open43-client-navigation");
    if (!(link instanceof HTMLAnchorElement)) throw new Error("settings client navigation link is missing");
    link.click();
  });
}

export class Open43SettingsBrowserAdapter {
  #browserContexts;
  #pageOrigin;
  #storageState;
  #contexts = new Map();

  constructor({ browserContexts, pageOrigin, storageState }) {
    this.#browserContexts = browserContexts;
    this.#pageOrigin = pageOrigin;
    this.#storageState = storageState;
  }

  async #context(actor) {
    if (!this.#contexts.has(actor)) {
      this.#contexts.set(actor, this.#browserContexts.newCandidateContext({ storageState: this.#storageState(actor), viewport: DEFAULT_VIEWPORT }));
    }
    return (await this.#contexts.get(actor)).context;
  }

  async capturePagePair({ url, label, index, viewport = DEFAULT_VIEWPORT, contract = null, navigationFromUrl = null, beforeClientNavigation = null }) {
    const page = await (await this.#context("administrator")).newPage();
    const consoleErrors = [];
    const analyticsRequests = [];
    let initialNavigationCspHeader = null;
    const onConsole = (message) => {
      if (message.type() === "error") consoleErrors.push(sha256(message.text()));
    };
    const onPageError = (error) => consoleErrors.push(sha256(error.message));
    const onRequest = (request) => {
      if (/google-analytics|googletagmanager/u.test(new URL(request.url()).hostname)) analyticsRequests.push(sha256(request.url()));
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("request", onRequest);
    try {
      await page.setViewportSize(viewport);
      await page.addInitScript({ content: INITIAL_PROBE });
      let navigationSource = null;
      const capture = await this.#browserContexts.captureCandidateObservation({
        context: await this.#context("administrator"), page, url,
        label: "settings",
        index, contract, viewport, timeoutMs: CAPTURE_TIMEOUT_MS, settleMs: 0,
        navigate: async ({ page: targetPage, url: targetUrl, timeoutMs }) => {
          const response = await targetPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          initialNavigationCspHeader = response?.headers()["content-security-policy"] || null;
          return response;
        },
        onPhase: async (phase) => {
          await this.#browserContexts.setActiveFixture(phase === "settled" ? `${label}_SETTLED` : `${label}_INITIAL`);
        },
      });
      if (capture.capture_error || capture.navigation_status !== 200) throw new Error(`${label} browser capture failed`);
      const initial = await page.evaluate(() => globalThis.__open43InitialObservation);
      const settled = await page.evaluate(() => globalThis.__open43SemanticSnapshot());
      await page.reload({ waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
      const reload = await page.evaluate(() => globalThis.__open43SemanticSnapshot());
      const reloadUrl = page.url();
      if (navigationFromUrl !== null) {
        await this.#browserContexts.setActiveFixture(`${label}_INITIAL`);
        const sourceResponse = await page.goto(navigationFromUrl, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
        if (sourceResponse?.status() !== 200) throw new Error(`${label} navigation source failed`);
        navigationSource = await page.evaluate(() => globalThis.__open43SemanticSnapshot());
      }
      if (beforeClientNavigation !== null) await beforeClientNavigation();
      const sourceDocumentIdentity = await page.evaluate(() => globalThis.__open43DocumentIdentity);
      const clientUrl = new URL(navigationFromUrl === null ? page.url() : url);
      if (navigationFromUrl === null) clientUrl.searchParams.set("open43-client-navigation", label.toLowerCase());
      await page.evaluate((href) => {
        const link = document.createElement("a");
        link.id = "open43-client-navigation";
        link.href = href;
        document.body.append(link);
      }, clientUrl.href);
      let clientImmediate = null;
      let clientTransitionCapture = null;
      let clientResourceCompletion = null;
      if (navigationFromUrl === null && beforeClientNavigation === null) {
        await this.#browserContexts.setActiveFixture(`${label}_INITIAL`);
        await activateClientNavigation(page);
        await page.waitForURL(clientUrl.href, { timeout: CAPTURE_TIMEOUT_MS });
        clientImmediate = await page.evaluate(() => ({
          document_identity: globalThis.__open43DocumentIdentity,
          snapshot: globalThis.__open43SemanticSnapshot(),
        }));
        await this.#browserContexts.setActiveFixture(`${label}_SETTLED`);
        clientResourceCompletion = await waitForBrowserParitySettledResources(page, CAPTURE_TIMEOUT_MS);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      } else {
        clientTransitionCapture = await this.#browserContexts.captureCandidateObservation({
          context: await this.#context("administrator"), page, url,
          label: "settings-client-transition",
          index, contract, viewport, timeoutMs: CAPTURE_TIMEOUT_MS, settleMs: 0,
          navigate: async () => {
            await activateClientNavigation(page);
            await page.waitForURL(clientUrl.href, { timeout: CAPTURE_TIMEOUT_MS });
            clientImmediate = await page.evaluate(() => ({
              document_identity: globalThis.__open43DocumentIdentity,
              snapshot: globalThis.__open43SemanticSnapshot(),
            }));
            return { status: 200 };
          },
          onPhase: async (phase) => {
            await this.#browserContexts.setActiveFixture(phase === "settled" ? `${label}_SETTLED` : `${label}_INITIAL`);
          },
        });
        if (clientTransitionCapture.capture_error || clientTransitionCapture.navigation_status !== 200) throw new Error(`${label} client transition capture failed`);
        clientResourceCompletion = clientTransitionCapture.document.resource_completion;
      }
      if (typeof sourceDocumentIdentity !== "string" || sourceDocumentIdentity !== clientImmediate.document_identity) {
        throw new Error(`${label} client navigation replaced the document`);
      }
      const clientInitial = clientImmediate.snapshot;
      const client = await page.evaluate(() => globalThis.__open43SemanticSnapshot());
      const toolbarInteractions = await page.evaluate(() => {
        const toolbar = document.querySelector("#navi-bar");
        const link = toolbar?.querySelector("a");
        toolbar?.scrollIntoView();
        link?.focus();
        const bounds = toolbar?.getBoundingClientRect();
        return {
          visible_after_scroll: bounds !== undefined && bounds.width > 0 && bounds.height > 0,
          focusable_link: link !== null && document.activeElement === link,
          client_navigation_preserved: document.querySelectorAll("#navi-bar").length === 1,
        };
      });
      return {
        capture,
        initial,
        settled,
        reload,
        reload_url: reloadUrl,
        client_initial: clientInitial,
        client,
        client_transition_capture: clientTransitionCapture,
        client_navigation_preserved_document: true,
        client_resource_completion: clientResourceCompletion.status,
        navigation_from_url: navigationFromUrl,
        navigation_source: navigationSource,
        console_errors: [...new Set(consoleErrors)].sort(),
        remote_analytics_request_count: analyticsRequests.length,
        toolbar_interactions: toolbarInteractions,
        initial_navigation_csp_header_sha256:
          initialNavigationCspHeader === null ? null : sha256(initialNavigationCspHeader),
        csp_nonce_matches_initial_navigation_header:
          initial.analytics.nonce.length > 0 &&
          initialNavigationCspHeader?.includes(`'nonce-${initial.analytics.nonce}'`) === true,
      };
    } finally {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("request", onRequest);
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async exerciseAnalyticsAdmin({ profile, onLoaded }) {
    await this.#browserContexts.setActiveFixture("S754_ANALYTICS_SETTLED");
    const page = await (await this.#context("administrator")).newPage();
    try {
      await page.goto(new URL("/_admin", this.#pageOrigin).href, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
      await onLoaded();
      const staleResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("?/analytics"), { timeout: CAPTURE_TIMEOUT_MS });
      await page.locator("#sm-ganalytics-save").click();
      const stale = await staleResponse;
      const dialog = page.locator("#odialog-container");
      await dialog.waitFor({ state: "visible", timeout: CAPTURE_TIMEOUT_MS });
      const errorVisible = await dialog.isVisible();
      const errorIdentity = await visibleFailureIdentity(stale, page);
      await page.locator(".button-close-message").click();
      await page.reload({ waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
      await page.locator("#sm-ganalytics-key").fill(profile);
      await page.locator("#sm-ganalytics-use").check();
      const successResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("?/analytics"), { timeout: CAPTURE_TIMEOUT_MS });
      await page.locator("#sm-ganalytics-save").click();
      const success = await successResponse;
      return { stale_status: stale.status(), error_visible: errorVisible, error_code: errorIdentity.code, error_message_sha256: errorIdentity.message_sha256, success_status: success.status(), saved_profile: profile };
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async exerciseGeneralAdmin({ description, onLoaded, onStaleObserved }) {
    if (typeof onLoaded !== "function" || typeof onStaleObserved !== "function") throw new Error("general admin lifecycle callbacks are required");
    await this.#browserContexts.setActiveFixture("S1046_ADMIN_SETTLED");
    const page = await (await this.#context("administrator")).newPage();
    const consoleErrors = [];
    const onConsole = (message) => {
      if (message.type() === "error") consoleErrors.push(sha256(message.text()));
    };
    const onPageError = (error) => consoleErrors.push(sha256(error.message));
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    try {
      await page.addInitScript({ content: INITIAL_PROBE });
      await page.goto(new URL("/_admin", this.#pageOrigin).href, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
      const formAction = await page.locator("#sm-general-form").getAttribute("action");
      await onLoaded();
      await page.locator("#site-description-field").fill(description);
      const staleResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().includes("?/site"),
        { timeout: CAPTURE_TIMEOUT_MS },
      );
      await page.locator("#sm-general-save").click();
      const stale = await staleResponse;
      const staleSubmittedRevision = await submittedSettingsRevision(stale);
      const dialog = page.locator("#odialog-container");
      await dialog.waitFor({ state: "visible", timeout: CAPTURE_TIMEOUT_MS });
      const staleErrorVisible = await dialog.isVisible();
      const staleErrorIdentity = await visibleFailureIdentity(stale, page);
      await onStaleObserved();
      await page.locator(".button-close-message").click();
      await page.reload({ waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
      await page.locator("#site-description-field").fill(description);
      const successResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().includes("?/site"),
        { timeout: CAPTURE_TIMEOUT_MS },
      );
      const invalidationResponse = page.waitForResponse(
        (response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/_admin/__data.json",
        { timeout: CAPTURE_TIMEOUT_MS },
      );
      await page.locator("#sm-general-save").click();
      const [success, invalidation] = await Promise.all([successResponse, invalidationResponse]);
      const successSubmittedRevision = await submittedSettingsRevision(success);
      const invalidationCompletion = await waitForBrowserParitySettledResources(page, CAPTURE_TIMEOUT_MS);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const confirmationResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().includes("?/site"),
        { timeout: CAPTURE_TIMEOUT_MS },
      );
      const confirmationInvalidationResponse = page.waitForResponse(
        (response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/_admin/__data.json",
        { timeout: CAPTURE_TIMEOUT_MS },
      ).catch(() => null);
      await page.locator("#sm-general-save").click();
      const confirmation = await confirmationResponse;
      const confirmationSubmittedRevision = await submittedSettingsRevision(confirmation);
      if (confirmation.status() !== 200) throw new Error("general admin invalidation did not refresh the public form revision");
      const confirmationInvalidation = await confirmationInvalidationResponse;
      if (confirmationInvalidation === null) throw new Error("general admin confirmation invalidation was not observed");
      const confirmationCompletion = await waitForBrowserParitySettledResources(page, CAPTURE_TIMEOUT_MS);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const successDom = await page.evaluate(() => globalThis.__open43SemanticSnapshot());
      return {
        form_action: formAction,
        stale_status: stale.status(),
        stale_error_visible: staleErrorVisible,
        stale_error_code: staleErrorIdentity.code,
        stale_error_message_sha256: staleErrorIdentity.message_sha256,
        success_status: success.status(),
        invalidation_status: invalidation.status(),
        invalidation_resource_completion: invalidationCompletion.status,
        fresh_revision_confirmation_status: confirmation.status(),
        confirmation_invalidation_status: confirmationInvalidation.status(),
        confirmation_resource_completion: confirmationCompletion.status,
        stale_submitted_revision: staleSubmittedRevision,
        success_submitted_revision: successSubmittedRevision,
        confirmation_submitted_revision: confirmationSubmittedRevision,
        success_error_visible: await dialog.isVisible(),
        edited_description_sha256: sha256(description),
        success_dom_values: successDom.admin.general_values,
        console_errors: [...new Set(consoleErrors)].sort(),
      };
    } finally {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async deniedAdmin(actor) {
    await this.#browserContexts.setActiveFixture("S1046_ADMIN_INITIAL");
    const page = await (await this.#context(actor)).newPage();
    try {
      const response = await page.goto(new URL("/_admin", this.#pageOrigin).href, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      return {
        actor,
        status: response?.status() ?? 0,
        settings_disclosed: (await page.locator("#sm-general-form").count()) > 0,
      };
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }
}
