import { createHash } from "node:crypto";
import fs from "node:fs";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { requireNonEmptyString, requirePlainObject, requireSha256, sha256Value } from "./standing-browser-parity-util.mjs";

const AUDIT = JSON.parse(fs.readFileSync(new URL("../../../../docs/development/open43-m-closure-audit.json", import.meta.url), "utf8"));
// Issue 1042 has a dedicated provider case set (open43-embedvideo-browser),
// so M1042_BROWSER_LIFECYCLE is excluded here to keep one owner per case ID.
const MEDIA_ISSUES = new Set([756, 776, 806, 1039, 1043, 1062]);
const AUDIT_ROWS = AUDIT.issues
  .filter(({ issue }) => MEDIA_ISSUES.has(issue))
  .flatMap(({ subrows }) => subrows)
  .filter(({ classification, next_command_ids }) => classification === "candidate_required" && next_command_ids.includes("C_MEDIA_BROWSER_CANDIDATE"));

export const OPEN43_MEDIA_BROWSER_CASE_IDS = Object.freeze(AUDIT_ROWS.map(({ case_id }) => case_id));
if (new Set(OPEN43_MEDIA_BROWSER_CASE_IDS).size !== OPEN43_MEDIA_BROWSER_CASE_IDS.length || OPEN43_MEDIA_BROWSER_CASE_IDS.length === 0) throw new Error("Open43 media browser audit denominator is not unique and non-empty");

const SITE_SLUG = "scpaiueouiuiuiui";
const SHA256 = /^[0-9a-f]{64}$/u;
const ISSUE_806_CASE_ID = "M806_BROWSER_GEOMETRY_AND_NETWORK";
const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const MAX_CENTER_DELTA = 0.5;

function object(value, name) { return requirePlainObject(value, name); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function fixtureId(value, name) {
  const id = requireNonEmptyString(value, name);
  if (!/^[A-Z][A-Z0-9_]+$/u.test(id)) throw new Error(`${name} is invalid`);
  return id;
}

function hashes(value, name, { required = true } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0) || value.some((item) => !SHA256.test(item))) throw new Error(`${name} must contain SHA-256 values`);
  return Object.freeze([...value]);
}

function intervalExpectation(value, name) {
  const expected = object(value, name);
  const phase = (phaseName) => {
    const phaseValue = object(expected[phaseName], `${name}.${phaseName}`);
    for (const field of ["iframe_count", "focusable_iframe_count"]) if (!Number.isSafeInteger(phaseValue[field]) || phaseValue[field] < 0) throw new Error(`${name}.${phaseName}.${field} is invalid`);
    if (typeof phaseValue.active_element !== "string") throw new Error(`${name}.${phaseName}.active_element is invalid`);
    requireSha256(phaseValue.dom_signature_sha256, `${name}.${phaseName}.dom_signature_sha256`);
    return Object.freeze({ iframe_count: phaseValue.iframe_count, focusable_iframe_count: phaseValue.focusable_iframe_count, active_element: phaseValue.active_element, dom_signature_sha256: phaseValue.dom_signature_sha256 });
  };
  return Object.freeze({
    initial: phase("initial"),
    settled: phase("settled"),
    csp_header_sha256: requireSha256(expected.csp_header_sha256, `${name}.csp_header_sha256`),
    required_request_url_sha256: hashes(expected.required_request_url_sha256, `${name}.required_request_url_sha256`),
    forbidden_request_url_sha256: hashes(expected.forbidden_request_url_sha256, `${name}.forbidden_request_url_sha256`, { required: false }),
  });
}

function viewport(value, name) {
  const result = object(value, name);
  if (!Number.isSafeInteger(result.width) || result.width <= 0 || !Number.isSafeInteger(result.height) || result.height <= 0) throw new Error(`${name} is invalid`);
  return Object.freeze({ width: result.width, height: result.height });
}

function phaseHashes(value, name) {
  const hashes = object(value, name);
  return Object.freeze(Object.fromEntries(["initial", "settled", "responsive"].map((phase) => [phase, requireSha256(hashes[phase], `${name}.${phase}`)])));
}

function centeredImageContract(value, name) {
  const contract = object(value, name);
  const responsiveViewport = viewport(contract.responsive_viewport, `${name}.responsive_viewport`);
  if (responsiveViewport.width > 767) throw new Error(`${name}.responsive_viewport must exercise the narrow layout`);
  for (const field of ["rendered_width", "natural_width", "natural_height"]) if (!Number.isFinite(contract[field]) || contract[field] <= 0) throw new Error(`${name}.${field} is invalid`);
  const clickTarget = contract.click_target_url_sha256;
  if (clickTarget !== null) requireSha256(clickTarget, `${name}.click_target_url_sha256`);
  const expected = object(contract.expected_snapshot_sha256, `${name}.expected_snapshot_sha256`);
  return Object.freeze({
    responsive_viewport: responsiveViewport,
    width_attribute: requireNonEmptyString(contract.width_attribute, `${name}.width_attribute`),
    computed_width: requireNonEmptyString(contract.computed_width, `${name}.computed_width`),
    rendered_width: contract.rendered_width,
    natural_width: contract.natural_width,
    natural_height: contract.natural_height,
    source_url_sha256: requireSha256(contract.source_url_sha256, `${name}.source_url_sha256`),
    click_target_url_sha256: clickTarget,
    expected_snapshot_sha256: Object.freeze({
      positive: phaseHashes(expected.positive, `${name}.expected_snapshot_sha256.positive`),
      negative: phaseHashes(expected.negative, `${name}.expected_snapshot_sha256.negative`),
    }),
  });
}

function mediaBrowserInput(rawInput) {
  const browser = object(object(rawInput, "private candidate case input").media_browser, "private input media_browser");
  if (!Array.isArray(browser.cases) || browser.cases.length !== OPEN43_MEDIA_BROWSER_CASE_IDS.length) throw new Error("private input media_browser.cases does not match the audit denominator");
  const byId = new Map(browser.cases.map((value) => [value?.case_id, value]));
  if (JSON.stringify([...byId.keys()]) !== JSON.stringify(OPEN43_MEDIA_BROWSER_CASE_IDS)) throw new Error("private input media_browser.cases must follow the audit denominator exactly");
  return Object.freeze(OPEN43_MEDIA_BROWSER_CASE_IDS.map((caseId) => {
    const value = object(byId.get(caseId), `${caseId} private fixture`);
    return Object.freeze({
      case_id: caseId,
      positive_source: requireNonEmptyString(value.positive_source, `${caseId}.positive_source`),
      negative_source: requireNonEmptyString(value.negative_source, `${caseId}.negative_source`),
      capture_contract: object(value.capture_contract, `${caseId}.capture_contract`),
      expected: Object.freeze({ positive: intervalExpectation(value.expected?.positive, `${caseId}.expected.positive`), negative: intervalExpectation(value.expected?.negative, `${caseId}.expected.negative`) }),
      centered_image: caseId === ISSUE_806_CASE_ID ? centeredImageContract(value.centered_image, `${caseId}.centered_image`) : null,
    });
  }));
}

function focusSnapshot() {
  const frames = [...document.querySelectorAll("iframe")];
  return {
    active_element: document.activeElement?.id ? `#${document.activeElement.id}` : document.activeElement?.localName ?? "",
    iframe_count: frames.length,
    focusable_iframe_count: frames.filter((frame) => frame.tabIndex >= 0).length,
  };
}

function cspViolationProbe() {
  const target = globalThis;
  target.__open43CspViolations = [];
  addEventListener("securitypolicyviolation", (event) => {
    target.__open43CspViolations.push({ blockedURI: event.blockedURI, effectiveDirective: event.effectiveDirective, violatedDirective: event.violatedDirective, disposition: event.disposition });
  });
}

function imageLifecycleProbe() {
  globalThis.__open43ImageEvents = [];
  for (const type of ["load", "error"]) addEventListener(type, (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.closest("#page-content")) globalThis.__open43ImageEvents.push({ type, source_url: image.currentSrc || image.src });
  }, true);
}

function centeredImageSnapshot() {
  const images = [...document.querySelectorAll("#page-content .image-container.aligncenter > img.image")];
  return {
    viewport: { width: innerWidth, height: innerHeight },
    images: images.map((image) => {
      const imageRect = image.getBoundingClientRect();
      const containerRect = image.parentElement.getBoundingClientRect();
      const clickTarget = image.closest("a");
      return {
        complete: image.complete,
        natural_width: image.naturalWidth,
        natural_height: image.naturalHeight,
        width_attribute: image.getAttribute("width"),
        computed_width: getComputedStyle(image).width,
        rendered_width: imageRect.width,
        rendered_height: imageRect.height,
        center_delta: Math.abs((imageRect.left + imageRect.width / 2) - (containerRect.left + containerRect.width / 2)),
        source_url: image.currentSrc || image.src,
        click_target: clickTarget?.localName ?? null,
        click_target_url: clickTarget?.href ?? null,
        click_target_target: clickTarget?.target ?? null,
      };
    }),
    events: globalThis.__open43ImageEvents ?? [],
  };
}

function publicCenteredImageSnapshot(value) {
  const snapshot = object(value, "centered image browser snapshot");
  return {
    viewport: snapshot.viewport,
    images: snapshot.images.map(({ source_url, click_target_url, ...image }) => ({
      ...image,
      source_url_sha256: sha256(source_url),
      click_target_url_sha256: click_target_url === null ? null : sha256(click_target_url),
    })),
    events: snapshot.events.map(({ type, source_url }) => ({ type, source_url_sha256: sha256(source_url) })),
  };
}

function observedUrl(value) {
  const url = new URL(value);
  return { origin: url.origin, pathname: url.pathname, url_sha256: sha256(url.href) };
}

function domSignatureHash(documentObservation) {
  return sha256Value({ dom_signatures: documentObservation.dom_signatures, attribute_signatures: documentObservation.attribute_signatures });
}

async function captureInterval({ browser, pageOrigin, fixture, page, label, index, contract, centeredImage }) {
  const network = [];
  const consoleMessages = [];
  const pageErrors = [];
  let cspHeader = null;
  let resolveDOMContentLoaded;
  let rejectDOMContentLoaded;
  const domContentLoaded = new Promise((resolve, reject) => {
    resolveDOMContentLoaded = resolve;
    rejectDOMContentLoaded = reject;
  });
  page.on("request", (request) => network.push({ event: "request", method: request.method(), resource_type: request.resourceType(), url: observedUrl(request.url()) }));
  page.on("response", (response) => network.push({ event: "response", status: response.status(), resource_type: response.request().resourceType(), url: observedUrl(response.url()) }));
  page.on("requestfailed", (request) => network.push({ event: "requestfailed", failure: request.failure()?.errorText ?? null, resource_type: request.resourceType(), url: observedUrl(request.url()) }));
  page.on("console", (message) => consoleMessages.push({ type: message.type(), text_sha256: sha256(message.text()) }));
  page.on("pageerror", (error) => pageErrors.push(sha256(error.message)));
  page.once("domcontentloaded", () => Promise.all([
    page.evaluate(focusSnapshot),
    centeredImage === null ? null : page.evaluate(centeredImageSnapshot),
  ]).then(resolveDOMContentLoaded, rejectDOMContentLoaded));
  try {
    await page.addInitScript(cspViolationProbe);
    if (centeredImage !== null) await page.addInitScript(imageLifecycleProbe);
    const url = new URL(`/${encodeURIComponent(fixture.slug)}`, pageOrigin).href;
    const capture = await browser.captureCandidateObservation({
      context: page.context(), page, url, label, index, contract, viewport: DEFAULT_VIEWPORT, timeoutMs: 300_000, settleMs: 0,
      navigate: async ({ page: targetPage, url: targetUrl, timeoutMs }) => {
        const response = await targetPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        cspHeader = response?.headers()["content-security-policy"] ?? null;
        return response;
      },
      onPhase: (phase) => browser.setActiveFixture(fixtureId(`${label.toUpperCase().replaceAll("-", "_")}_${phase === "settled" ? "SETTLED" : "INITIAL"}`, "fixture")),
    });
    if (capture.capture_error) throw new Error(`${label} did not reach a DOMContentLoaded capture`);
    const [immediateFocus, initialCenteredImages] = await domContentLoaded;
    const settledFocus = await page.evaluate(focusSnapshot);
    const cspViolations = await page.evaluate(() => globalThis.__open43CspViolations ?? []);
    let centeredImages = null;
    if (centeredImage !== null) {
      const settled = await page.evaluate(centeredImageSnapshot);
      await page.setViewportSize(centeredImage.responsive_viewport);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      centeredImages = {
        initial: publicCenteredImageSnapshot(initialCenteredImages),
        settled: publicCenteredImageSnapshot(settled),
        responsive: publicCenteredImageSnapshot(await page.evaluate(centeredImageSnapshot)),
      };
    }
    const observation = { url, capture, immediate_focus: immediateFocus, settled_focus: settledFocus, network, console: consoleMessages, page_errors: pageErrors, csp_header: cspHeader, csp_violations: cspViolations, ...(centeredImages === null ? {} : { centered_images: centeredImages }), cleanup: { page_closed: false } };
    await page.close();
    observation.cleanup.page_closed = true;
    return observation;
  } finally {
    await page.close().catch(() => undefined);
  }
}

function verifyInterval(value, expected, name) {
  const observation = object(value, name);
  const capture = object(observation.capture, `${name}.capture`);
  if (capture.navigation_status !== 200 || capture.final_url !== observation.url) throw new Error(`${name} navigation was not a successful exact candidate navigation`);
  const initial = object(capture.first_paint?.document, `${name}.capture.first_paint.document`);
  const settled = object(capture.document, `${name}.capture.document`);
  if (initial.phase !== "domcontentloaded_immediate_observation" || settled.phase !== "settled" || settled.resource_completion?.status !== "complete") throw new Error(`${name} did not record the required initial and settled intervals`);
  for (const [actual, plan, phase] of [[initial, expected.initial, "initial"], [settled, expected.settled, "settled"]]) {
    const focus = object(phase === "initial" ? observation.immediate_focus : observation.settled_focus, `${name}.${phase}_focus`);
    if (focus.iframe_count !== plan.iframe_count || focus.focusable_iframe_count !== plan.focusable_iframe_count || focus.active_element !== plan.active_element || domSignatureHash(actual) !== plan.dom_signature_sha256) throw new Error(`${name} ${phase} DOM or focus contract did not match the sealed expectation`);
  }
  if (sha256(String(observation.csp_header ?? "")) !== expected.csp_header_sha256 || !Array.isArray(observation.csp_violations) || observation.csp_violations.length !== 0) throw new Error(`${name} CSP header or violation contract did not match`);
  if (!Array.isArray(observation.console) || observation.console.length !== 0 || !Array.isArray(observation.page_errors) || observation.page_errors.length !== 0) throw new Error(`${name} emitted console or page errors`);
  if (!Array.isArray(capture.failures) || capture.failures.length !== 0 || !Array.isArray(capture.request_gate_aborts) || capture.request_gate_aborts.length !== 0) throw new Error(`${name} recorded failed or gate-aborted network requests`);
  const requestHashes = new Set(observation.network.map((event) => event?.url?.url_sha256).filter((value) => typeof value === "string"));
  for (const required of expected.required_request_url_sha256) if (!requestHashes.has(required)) throw new Error(`${name} omitted a required network request`);
  for (const forbidden of expected.forbidden_request_url_sha256) if (requestHashes.has(forbidden)) throw new Error(`${name} made a forbidden boundary request`);
  if (observation.cleanup?.page_closed !== true) throw new Error(`${name} cleanup did not close the page`);
  return { navigation_status: capture.navigation_status, initial_dom_signature_sha256: domSignatureHash(initial), settled_dom_signature_sha256: domSignatureHash(settled), csp_header_sha256: expected.csp_header_sha256, required_request_url_sha256: expected.required_request_url_sha256, forbidden_request_url_sha256: expected.forbidden_request_url_sha256 };
}

function verifyIssue806CenteredImages(observations, contract, positive, negative) {
  const expected = centeredImageContract(contract, `${ISSUE_806_CASE_ID}.centered_image`);
  const phases = ["initial", "settled", "responsive"];
  const snapshots = Object.fromEntries(["positive", "negative"].map((side) => {
    const centered = object(object(observations[side], `${ISSUE_806_CASE_ID}.${side}`).centered_images, `${ISSUE_806_CASE_ID}.${side}.centered_images`);
    return [side, Object.fromEntries(phases.map((phase) => {
      const snapshot = object(centered[phase], `${ISSUE_806_CASE_ID}.${side}.${phase}`);
      if (sha256Value(snapshot) !== expected.expected_snapshot_sha256[side][phase]) throw new Error(`${ISSUE_806_CASE_ID} ${side} ${phase} centered-image snapshot differs from its sealed expectation`);
      return [phase, snapshot];
    }))];
  }));

  for (const side of ["positive", "negative"]) for (const phase of phases) {
    const snapshot = snapshots[side][phase];
    const plannedViewport = phase === "responsive" ? expected.responsive_viewport : DEFAULT_VIEWPORT;
    if (snapshot.viewport?.width !== plannedViewport.width || snapshot.viewport?.height !== plannedViewport.height || !Array.isArray(snapshot.images) || !Array.isArray(snapshot.events)) throw new Error(`${ISSUE_806_CASE_ID} ${side} ${phase} viewport or image observation is invalid`);
    if (snapshot.events.some(({ type, source_url_sha256 }) => !["load", "error"].includes(type) || !SHA256.test(source_url_sha256))) throw new Error(`${ISSUE_806_CASE_ID} ${side} ${phase} image lifecycle observation is invalid`);
    if (snapshot.events.some(({ type }) => type === "error")) throw new Error(`${ISSUE_806_CASE_ID} ${side} ${phase} observed an image load error`);
  }

  for (const phase of phases) {
    const snapshot = snapshots.positive[phase];
    if (snapshot.images.length !== 2) throw new Error(`${ISSUE_806_CASE_ID} ${phase} did not render both centered whitespace variants`);
    for (const image of snapshot.images) {
      if (typeof image.complete !== "boolean" || !Number.isSafeInteger(image.natural_width) || image.natural_width < 0 || !Number.isSafeInteger(image.natural_height) || image.natural_height < 0) throw new Error(`${ISSUE_806_CASE_ID} ${phase} centered image load state is invalid`);
      if (image.width_attribute !== expected.width_attribute || image.computed_width !== expected.computed_width || image.rendered_width !== expected.rendered_width) throw new Error(`${ISSUE_806_CASE_ID} ${phase} centered image width is wrong`);
      if (!Number.isFinite(image.center_delta) || image.center_delta > MAX_CENTER_DELTA) throw new Error(`${ISSUE_806_CASE_ID} ${phase} centered image is not centered`);
      if (image.source_url_sha256 !== expected.source_url_sha256) throw new Error(`${ISSUE_806_CASE_ID} ${phase} centered image source identity is wrong`);
      if (image.click_target_url_sha256 !== expected.click_target_url_sha256 || (expected.click_target_url_sha256 === null ? image.click_target !== null : image.click_target !== "a")) throw new Error(`${ISSUE_806_CASE_ID} ${phase} centered image click target is wrong`);
      if (phase !== "initial" && (image.complete !== true || image.natural_width !== expected.natural_width || image.natural_height !== expected.natural_height)) throw new Error(`${ISSUE_806_CASE_ID} ${phase} centered image load state or natural dimensions are wrong`);
    }
  }
  for (const phase of phases) if (snapshots.negative[phase].images.length !== 0) throw new Error(`${ISSUE_806_CASE_ID} ${phase} negative whitespace control acquired image ownership`);

  const requested = observations.positive.network.some(({ event, resource_type, url }) => event === "request" && resource_type === "image" && url?.url_sha256 === expected.source_url_sha256);
  const forbidden = observations.negative.network.some(({ event, url }) => event === "request" && url?.url_sha256 === expected.source_url_sha256);
  if (!requested || forbidden || !positive.required_request_url_sha256.includes(expected.source_url_sha256) || !negative.forbidden_request_url_sha256.includes(expected.source_url_sha256)) throw new Error(`${ISSUE_806_CASE_ID} exact image request boundary is wrong`);

  return {
    responsive_viewport: expected.responsive_viewport,
    positive_snapshot_sha256: Object.fromEntries(phases.map((phase) => [phase, sha256Value(snapshots.positive[phase])])),
    negative_snapshot_sha256: Object.fromEntries(phases.map((phase) => [phase, sha256Value(snapshots.negative[phase])])),
  };
}

export function verifyOpen43MediaBrowserCase(caseId, observations, plan) {
  const value = object(observations, `${caseId} observations`);
  const expected = object(plan.expected, `${caseId} plan.expected`);
  const positive = verifyInterval(value.positive, expected.positive, `${caseId}.positive`);
  const negative = verifyInterval(value.negative, expected.negative, `${caseId}.negative`);
  if (negative.forbidden_request_url_sha256.length === 0) throw new Error(`${caseId} has no negative boundary request set`);
  const centeredImage = caseId === ISSUE_806_CASE_ID ? verifyIssue806CenteredImages(value, plan.centered_image, positive, negative) : null;
  return { verified: true, positive, negative, ...(centeredImage === null ? {} : { centered_image: centeredImage }), negative_boundary_verified: true };
}

class Open43MediaBrowserRun {
  #session;
  #browser;
  #resources;
  #casePlans;
  #runId;
  #siteId = null;
  #pages = [];

  constructor({ session, browser, resources, casePlans, runId }) {
    this.#session = session;
    this.#browser = browser;
    this.#resources = resources;
    this.#casePlans = casePlans;
    this.#runId = runId;
  }

  async #pageCreate(casePlan, side, index) {
    const suffix = this.#runId.slice("candidate-run-".length);
    const slug = `open43-media-browser-${suffix}-${index}-${side}`;
    const marker = `candidate-case-owner:${slug}`;
    const page = await this.#session.rpc("page_create", { site_id: this.#siteId, slug, title: marker, alt_title: null, wikitext: side === "positive" ? casePlan.positive_source : casePlan.negative_source, layout: "wikidot", user_id: this.#session.editorUserId, ip_address: "127.0.0.1", tags: [], revision_comments: "Open43 media browser candidate fixture" });
    if (!Number.isSafeInteger(page?.page_id) || page.slug !== slug) throw new Error(`${casePlan.case_id} ${side} fixture page identity is missing`);
    const publicPage = await this.#session.rpc("page_get", { site_id: this.#siteId, page: slug, details: { wikitext: true, compiled: false } });
    if (publicPage?.page_id !== page.page_id || publicPage.slug !== slug || publicPage.title !== marker) throw new Error(`${casePlan.case_id} ${side} fixture page is not publicly readable`);
    const resource = this.#resources.register("page", { page_id: page.page_id, slug, marker });
    const fixture = { page_id: page.page_id, revision_id: page.revision_id, slug, marker, resource };
    this.#pages.push(fixture);
    return fixture;
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id)) throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    this.#siteId = site.site_id;
    const fixtures = await Promise.all(this.#casePlans.map(async (casePlan, index) => ({ casePlan, positive: await this.#pageCreate(casePlan, "positive", index), negative: await this.#pageCreate(casePlan, "negative", index) })));
    const results = [];
    for (const { casePlan, positive, negative } of fixtures) {
      const positiveContext = await this.#browser.newCandidateContext();
      const negativeContext = await this.#browser.newCandidateContext();
      const positiveObservation = await captureInterval({ browser: this.#browser, pageOrigin: this.#session.pageOrigin, fixture: positive, page: await positiveContext.context.newPage(), label: `${casePlan.case_id.toLowerCase()}-positive`, index: results.length * 2, contract: casePlan.capture_contract, centeredImage: casePlan.centered_image });
      const negativeObservation = await captureInterval({ browser: this.#browser, pageOrigin: this.#session.pageOrigin, fixture: negative, page: await negativeContext.context.newPage(), label: `${casePlan.case_id.toLowerCase()}-negative`, index: results.length * 2 + 1, contract: casePlan.capture_contract, centeredImage: casePlan.centered_image });
      results.push({ case_id: casePlan.case_id, observations: { positive: positiveObservation, negative: negativeObservation } });
    }
    return results;
  }

  async cleanup() {
    const failures = [];
    const pages = [];
    for (const fixture of [...this.#pages].reverse()) {
      try {
        const current = await this.#session.rpc("page_get", { site_id: this.#siteId, page: fixture.slug, details: { wikitext: true, compiled: false } }, { cleanup: true });
        if (current !== null && current?.page_id === fixture.page_id && current.title === fixture.marker) await this.#session.rpc("page_delete", { site_id: this.#siteId, page: fixture.page_id, last_revision_id: current.revision_id, revision_comments: "Open43 media browser candidate cleanup", user_id: this.#session.editorUserId, ip_address: "127.0.0.1" }, { cleanup: true });
        else if (current !== null) throw new Error(`${fixture.slug} cleanup identity changed`);
        const after = await this.#session.rpc("page_get", { site_id: this.#siteId, page: fixture.slug, details: { wikitext: false, compiled: false } }, { cleanup: true });
        if (after !== null) throw new Error(`${fixture.slug} remained publicly visible after cleanup`);
        this.#resources.release(fixture.resource, { page_get: null, page_slug: fixture.slug });
        pages.push({ slug: fixture.slug, page_get: null });
      } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "media browser public cleanup failed");
    return { pages, public_absence_verified: true };
  }
}

function verifyCleanup(proof, resources) {
  if (!object(proof, "media browser cleanup proof").public_absence_verified || !Array.isArray(proof.pages) || proof.pages.length !== OPEN43_MEDIA_BROWSER_CASE_IDS.length * 2 || proof.pages.some(({ page_get }) => page_get !== null) || resources.some((resource) => resource.released !== true)) throw new Error("media browser cleanup did not prove every fixture page absent");
  return { public_absence_verified: true, page_count: proof.pages.length, resource_count: resources.length };
}

export function createOpen43MediaBrowserCandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  return Object.freeze({
    id: "open43-media-browser",
    caseIds: OPEN43_MEDIA_BROWSER_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      if (candidateIdentity.candidate.endpoint.host !== `${SITE_SLUG}.wikijump.localhost` || candidateIdentity.candidate.endpoint.port === 443) throw new Error(`Open43 media browser cases require the exact non-standing ${SITE_SLUG} candidate`);
      const casePlans = mediaBrowserInput(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      const publicPlan = casePlans.map(({ case_id, positive_source, negative_source, capture_contract, expected, centered_image }) => ({ case_id, positive_source_sha256: sha256(positive_source), negative_source_sha256: sha256(negative_source), capture_contract, expected, ...(centered_image === null ? {} : { centered_image }) }));
      const execution = new Open43MediaBrowserRun({ session, browser: candidateBrowserContexts, resources, casePlans, runId });
      return Object.freeze({
        sourceFiles: Object.freeze([...new Set([...STANDING_BROWSER_EXECUTION_MODULES, "docs/development/open43-m-closure-audit.json", "install/local/wikidot-verification/scripts/run-candidate-cases.mjs", "install/local/wikidot-verification/src/candidate-case-command.mjs", "install/local/wikidot-verification/src/candidate-case-http.mjs", "install/local/wikidot-verification/src/candidate-case-runner.mjs", "install/local/wikidot-verification/src/candidate-browser-contexts.mjs", "install/local/wikidot-verification/src/open43-media-browser-candidate.mjs", "install/local/wikidot-verification/package.json", "install/local/wikidot-verification/pnpm-lock.yaml"])]),
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: { ...session.privateInputIdentity, media_browser_cases_sha256: sha256Value(publicPlan) },
        browserCredentialPolicy: "none",
        plan: { schema: "wikijump.open43_media_browser_candidate_plan.v2", site_slug: SITE_SLUG, case_ids: OPEN43_MEDIA_BROWSER_CASE_IDS, case_plans: publicPlan },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyOpen43MediaBrowserCase(caseId, observations, casePlans.find(({ case_id: candidateCaseId }) => candidateCaseId === caseId)),
        verifyCleanup,
      });
    },
  });
}
