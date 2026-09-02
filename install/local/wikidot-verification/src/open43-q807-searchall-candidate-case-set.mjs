import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requirePlainObject,
  requireSha256,
} from "./standing-browser-parity-util.mjs";

const CASE_ID = "Q807_EXACT_CANDIDATE_FORM_ROUTE_BROWSER";
const SITE_HOST = "scpaiueouiuiuiui.wikijump.localhost";
const FIXTURE_PATH = "install/local/wikidot-verification/artifacts/searchall-live-preview-routes-20260809.json";
const FIXTURE_URL = new URL("../artifacts/searchall-live-preview-routes-20260809.json", import.meta.url);
const FIXTURE_BYTES = readFileSync(FIXTURE_URL);
const FIXTURE_SHA256 = createHash("sha256").update(FIXTURE_BYTES).digest("hex");
const SEALED_FIXTURE_SHA256 = "378ddb0e93d5d20709f857d17dc7cb538f6e393f68c0f68016bb370ff60c4c67";
if (FIXTURE_SHA256 !== SEALED_FIXTURE_SHA256) throw new Error("Q807 SearchAll live evidence artifact changed");
const FIXTURE = freeze(JSON.parse(FIXTURE_BYTES));
const ROUTE_CASE_IDS = Object.freeze([
  "searchall-browser-pf-spaced-query",
  "searchall-browser-p-query",
  "searchall-browser-f-query",
]);
const ERROR_CASE = fixtureCase("searchall-route-pf-query");
const NEGATIVE_CASE = fixtureCase("searchall-route-unknown-area-query");
const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const CAPTURE_TIMEOUT_MS = 300_000;

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function fixtureCase(caseId) {
  const value = FIXTURE.cases.find((candidate) => candidate.case_id === caseId);
  if (!value) throw new Error(`SearchAll fixture case is missing: ${caseId}`);
  return value;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function structuralHtml(value) {
  return value.replace(/>\s+</gu, "><").replace(/\s+\/>/gu, "/>").trim();
}

function structuralHash(value) {
  return hash(structuralHtml(value));
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

function object(value, label) {
  return requirePlainObject(value, label);
}

function expectedRoute(caseId) {
  const value = fixtureCase(caseId);
  return {
    case_id: caseId,
    area: nonEmpty(value.area, `${caseId}.area`),
    query: nonEmpty(value.query, `${caseId}.query`),
    path: nonEmpty(value.path, `${caseId}.path`),
    expected_fragment_sha256: structuralHash(ERROR_CASE.raw_html),
  };
}

const EXPECTED_ROUTES = Object.freeze(ROUTE_CASE_IDS.map(expectedRoute));

function planFor({ runId, pageOrigin, candidateIdentitySha256 }) {
  return freeze({
    schema: "wikijump.open43_q807_searchall_candidate_plan.v1",
    issue: 807,
    case_id: CASE_ID,
    run_id: runId,
    page_origin: pageOrigin,
    saved_page_slug: "search:all",
    saved_page_source: "[[module SearchAll]]",
    fixture_path: FIXTURE_PATH,
    fixture_sha256: FIXTURE_SHA256,
    candidate_identity_sha256: candidateIdentitySha256,
    form_fragment_sha256: structuralHash(FIXTURE.form_raw_html),
    unavailable_fragment_sha256: structuralHash(ERROR_CASE.raw_html),
    routes: EXPECTED_ROUTES,
    negative_boundary: {
      case_id: NEGATIVE_CASE.case_id,
      path: NEGATIVE_CASE.path,
      expected_fragment_sha256: structuralHash(ERROR_CASE.raw_html),
      reason: "unknown-area-route-fails-closed-to-observed-unavailable-output",
    },
  });
}

async function exactFragment(page, expectedFragment, label) {
  const response = await page.evaluate(async () => {
    const result = await fetch(location.href, { cache: "no-store" });
    return { status: result.status, body: await result.text() };
  });
  const normalizedBody = structuralHtml(response.body);
  const normalizedFragment = structuralHtml(expectedFragment);
  const start = normalizedBody.indexOf(normalizedFragment);
  if (start < 0) throw new Error(`${label} did not contain the structural fixture fragment`);
  return {
    status: response.status,
    response_body_sha256: hash(response.body),
    fragment_sha256: hash(normalizedBody.slice(start, start + normalizedFragment.length)),
    fragment_present: true,
  };
}

async function formState(page) {
  const state = await page.evaluate(() => {
    const form = document.querySelector("#search-form-all");
    const query = document.querySelector("#search-form-all-input");
    const areas = [...document.querySelectorAll("input[name='area']")];
    const labels = [...document.querySelectorAll("label[for^='search-all-']")].map((label) => label.textContent ?? "");
    return {
      form_present: form !== null,
      id: form?.id ?? null,
      action: form?.getAttribute("action") ?? null,
      query_name: query?.getAttribute("name") ?? null,
      query_value: query?.value ?? null,
      default_area: areas.find((area) => area.checked)?.value ?? null,
      area_values: areas.map((area) => area.value),
      labels,
      result_count: document.querySelectorAll(".search-results").length,
    };
  });
  if (!state.form_present) throw new Error("SearchAll form is missing from the saved fixture");
  await page.locator("#search-form-all-input").focus();
  return {
    ...state,
    focused_query: await page.evaluate(() => document.activeElement?.id === "search-form-all-input"),
  };
}

export class Open43Q807SearchAllBrowserAdapter {
  #browserContexts;
  #pageOrigin;

  constructor({ browserContexts, pageOrigin }) {
    if (typeof browserContexts?.newCandidateContext !== "function" || typeof browserContexts?.setActiveFixture !== "function") throw new Error("Q807 browser contexts are required");
    this.#browserContexts = browserContexts;
    this.#pageOrigin = pageOrigin;
  }

  async captureSearchAll() {
    const owned = await this.#browserContexts.newCandidateContext({ viewport: DEFAULT_VIEWPORT });
    const page = await owned.context.newPage();
    const requestMethods = [];
    const failedRequests = [];
    const navigationUrls = [];
    const onRequest = (request) => requestMethods.push(request.method());
    const onFailed = (request) => failedRequests.push({ url: request.url(), method: request.method(), failure: request.failure()?.errorText ?? null });
    const onNavigation = (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (navigationUrls.at(-1) !== url) navigationUrls.push(url);
    };
    page.on("request", onRequest);
    page.on("requestfailed", onFailed);
    page.on("framenavigated", onNavigation);
    const baseUrl = new URL("/search:all", this.#pageOrigin).href;
    try {
      this.#browserContexts.setActiveFixture(CASE_ID);
      const initialNavigation = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
      const initialForm = await formState(page);
      const initialFragment = await exactFragment(page, FIXTURE.form_raw_html, "Q807 initial form");
      const routes = [];
      for (const expected of EXPECTED_ROUTES) {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
        const defaults = await formState(page);
        const query = page.locator("#search-form-all-input");
        await query.fill(expected.query);
        if (expected.area !== "pf") await page.locator(`#search-all-${expected.area}`).check();
        const selectedArea = await page.locator("input[name='area']:checked").inputValue();
        const expectedUrl = new URL(expected.path, this.#pageOrigin).href;
        const beforeNavigationCount = navigationUrls.length;
        await Promise.all([
          page.waitForURL(expectedUrl, { timeout: CAPTURE_TIMEOUT_MS }),
          page.locator("#search-form-all input[type='submit']").click(),
        ]);
        const result = await exactFragment(page, ERROR_CASE.raw_html, `${expected.case_id} unavailable result`);
        routes.push({
          ...expected,
          input_url: baseUrl,
          final_url: page.url(),
          navigation_delta: navigationUrls.length - beforeNavigationCount,
          selected_area: selectedArea,
          defaults,
          result,
          form_present: await page.locator("#search-form-all").count() > 0,
          error_text: await page.locator(".error-block").textContent(),
        });
      }
      const negativeUrl = new URL(NEGATIVE_CASE.path, this.#pageOrigin).href;
      await page.goto(negativeUrl, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
      const negativeResult = await exactFragment(page, ERROR_CASE.raw_html, "Q807 unknown-area negative boundary");
      return {
        saved_page: { slug: "search:all", url: baseUrl, status: initialNavigation?.status() ?? 0, source: "[[module SearchAll]]" },
        initial: { form: initialForm, result: initialFragment, final_url: baseUrl },
        routes,
        negative_boundary: {
          path: NEGATIVE_CASE.path,
          final_url: page.url(),
          result: negativeResult,
          form_present: await page.locator("#search-form-all").count() > 0,
          error_text: await page.locator(".error-block").textContent(),
        },
        request_methods: requestMethods,
        failed_requests: failedRequests,
        navigation_urls: navigationUrls,
        mutation_detected: requestMethods.some((method) => !["GET", "HEAD", "OPTIONS"].includes(method)),
      };
    } finally {
      page.off("request", onRequest);
      page.off("requestfailed", onFailed);
      page.off("framenavigated", onNavigation);
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }
}

function verifyForm(value, plan) {
  const form = object(value, "Q807 form");
  if (form.form_present !== true || form.id !== "search-form-all" || form.action !== "dummy" || form.query_name !== "query" || form.query_value !== "" || form.default_area !== "pf" || JSON.stringify(form.area_values) !== JSON.stringify(["pf", "p", "f"]) || JSON.stringify(form.labels) !== JSON.stringify(["pages and forums", "pages only", "forums only"]) || form.result_count !== 1 || form.focused_query !== true) throw new Error("Q807 SearchAll form defaults or focus are wrong");
  return form;
}

function verifyResult(value, expectedHash, label) {
  const result = object(value, label);
  if (result.status !== 200 || result.fragment_present !== true) throw new Error(`${label} did not return the expected public output`);
  requireSha256(result.fragment_sha256, `${label}.fragment_sha256`);
  if (result.fragment_sha256 !== expectedHash) throw new Error(`${label} output differs from the saved fixture`);
  requireSha256(result.response_body_sha256, `${label}.response_body_sha256`);
  return result;
}

export function verifyOpen43Q807SearchAllCase(rawObservations, plan) {
  const observations = object(rawObservations, "Q807 observations");
  const fixedPlan = object(plan, "Q807 plan");
  requireSha256(fixedPlan.fixture_sha256, "Q807 fixture SHA-256");
  if (fixedPlan.fixture_sha256 !== SEALED_FIXTURE_SHA256) throw new Error("Q807 fixture digest differs from sealed live evidence");
  requireSha256(fixedPlan.candidate_identity_sha256, "Q807 candidate identity SHA-256");
  const saved = object(observations.saved_page, "Q807 saved page");
  if (saved.slug !== fixedPlan.saved_page_slug || saved.source !== fixedPlan.saved_page_source || saved.status !== 200 || saved.url !== new URL("/search:all", fixedPlan.page_origin).href) throw new Error("Q807 saved SearchAll fixture identity is wrong");
  const initial = object(observations.initial, "Q807 initial observation");
  if (initial.final_url !== saved.url) throw new Error("Q807 initial navigation changed the saved fixture URL");
  verifyForm(initial.form, fixedPlan);
  verifyResult(initial.result, fixedPlan.form_fragment_sha256, "Q807 initial form");
  if (!Array.isArray(observations.routes) || observations.routes.length !== fixedPlan.routes.length) throw new Error("Q807 route denominator is incomplete");
  for (const [index, expected] of fixedPlan.routes.entries()) {
    const route = object(observations.routes[index], `Q807 route ${index}`);
    if (route.case_id !== expected.case_id || route.input_url !== saved.url || route.final_url !== new URL(expected.path, fixedPlan.page_origin).href || route.selected_area !== expected.area || route.navigation_delta !== 1 || route.form_present !== false || route.error_text?.trim() !== "Couldnt connect to host, ElasticSearch down?") throw new Error(`Q807 ${expected.case_id} navigation contract is wrong`);
    verifyForm(route.defaults, fixedPlan);
    verifyResult(route.result, expected.expected_fragment_sha256, `Q807 ${expected.case_id}`);
  }
  const negative = object(observations.negative_boundary, "Q807 negative boundary");
  if (negative.final_url !== new URL(fixedPlan.negative_boundary.path, fixedPlan.page_origin).href || negative.form_present !== false || negative.error_text?.trim() !== "Couldnt connect to host, ElasticSearch down?") throw new Error("Q807 unknown-area boundary did not fail closed");
  verifyResult(negative.result, fixedPlan.negative_boundary.expected_fragment_sha256, "Q807 negative boundary");
  if (!Array.isArray(observations.request_methods) || observations.request_methods.some((method) => !["GET", "HEAD", "OPTIONS"].includes(method)) || !Array.isArray(observations.failed_requests) || observations.failed_requests.length !== 0 || observations.mutation_detected !== false) throw new Error("Q807 candidate route issued a failed or mutating request");
  return { verified: true, case_id: CASE_ID, route_case_ids: fixedPlan.routes.map((route) => route.case_id), negative_boundary: fixedPlan.negative_boundary.case_id, fixture_sha256: fixedPlan.fixture_sha256 };
}

function verifyCleanup(proof, resources) {
  const cleanup = object(proof, "Q807 cleanup proof");
  if (cleanup.public_absence_verified !== true || cleanup.run_owned_state_absent !== true || cleanup.mutation_detected !== false || cleanup.cleanup_required !== false) throw new Error("Q807 read-only candidate cleanup proof is invalid");
  if (!Array.isArray(resources) || resources.length !== 0) throw new Error("Q807 candidate unexpectedly retained run-owned resources");
  return { verified: true, public_absence_verified: true, run_owned_state_absent: true, mutation_detected: false };
}

class Open43Q807SearchAllRun {
  #browser;
  #plan;
  #observations = null;

  constructor({ browser, plan }) {
    this.#browser = browser;
    this.#plan = plan;
  }

  async execute() {
    this.#observations = await this.#browser.captureSearchAll();
    return [{
      case_id: CASE_ID,
      observations: {
        ...this.#observations,
        result_identity: {
          case_id: CASE_ID,
          saved_page_slug: this.#plan.saved_page_slug,
          candidate_identity_sha256: this.#plan.candidate_identity_sha256,
          fixture_sha256: this.#plan.fixture_sha256,
        },
      },
    }];
  }

  async cleanup() {
    if (this.#observations?.mutation_detected === true) throw new Error("Q807 candidate observed a mutating request without a run-owned cleanup operation");
    return { public_absence_verified: true, run_owned_state_absent: true, mutation_detected: false, cleanup_required: false };
  }

  verifyCase(caseId, observations) {
    if (caseId !== CASE_ID) throw new Error(`unknown Q807 case: ${caseId}`);
    const identity = object(observations.result_identity, "Q807 result identity");
    if (identity.case_id !== CASE_ID || identity.saved_page_slug !== this.#plan.saved_page_slug || identity.candidate_identity_sha256 !== this.#plan.candidate_identity_sha256 || identity.fixture_sha256 !== this.#plan.fixture_sha256) throw new Error("Q807 result is not identity-bound");
    return verifyOpen43Q807SearchAllCase(observations, this.#plan);
  }
}

const SOURCE_FILES = Object.freeze([
  "install/local/wikidot-verification/artifacts/searchall-live-preview-routes-20260809.json",
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/open43-q807-searchall-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-observation.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "deepwell/src/services/render/search_feed.rs",
  "deepwell/tests/page.rs",
  "framerail/src/lib/wikidot/wikidot-search.js",
  "framerail/src/routes/+layout.svelte",
  "framerail/tests/wikidot-search.test.js",
]);

export const OPEN43_Q807_SEARCHALL_CASE_IDS = Object.freeze([CASE_ID]);

export function createOpen43Q807SearchAllCandidateCaseSet() {
  return Object.freeze({
    id: "open43-searchall",
    caseIds: OPEN43_Q807_SEARCHALL_CASE_IDS,
    prepareRun({ runId, candidateIdentity, candidateIdentitySha256, candidateBrowserContexts }) {
      if (candidateIdentity.candidate.endpoint.host !== SITE_HOST || candidateIdentity.candidate.endpoint.port === 443 || candidateIdentity.candidate.port_443_published !== false) throw new Error(`Q807 requires exact non-standing ${SITE_HOST}`);
      const pageOrigin = candidatePageOrigin(candidateIdentity);
      const plan = planFor({ runId, pageOrigin, candidateIdentitySha256 });
      const browser = new Open43Q807SearchAllBrowserAdapter({ browserContexts: candidateBrowserContexts, pageOrigin });
      const execution = new Open43Q807SearchAllRun({ browser, plan });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: [],
        privateInputIdentity: { mode: "anonymous-read-only", fixture_sha256: FIXTURE_SHA256 },
        browserCredentialPolicy: "none",
        plan,
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup,
      });
    },
  });
}
