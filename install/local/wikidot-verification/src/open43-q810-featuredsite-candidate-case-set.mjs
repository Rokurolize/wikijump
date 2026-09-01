import { createHash } from "node:crypto";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

export const OPEN43_Q810_FEATUREDSITE_CASE_IDS = Object.freeze([
  "Q810_CANDIDATE_FAIL_CLOSED_NETWORK",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const PREVIEW_SOURCE = "FEATURED_START\n[[module FeaturedSite]]\nFEATURED_END";
const EXPECTED_UNAVAILABLE =
  '[[module <em>FeaturedSite</em>]] No such module, please <a href="https://www.wikidot.com/doc:modules" target="_blank">check available modules</a> and fix this page.';
const FORBIDDEN_OUTPUT = Object.freeze([
  "featured-site-box",
  "thumbnails.wdfiles.com",
  "OZONE.dialog.hovertip",
  "scp-wiki.wikidot.com",
  "<script",
]);
const BROWSER_CONTRACT = Object.freeze({
  slug: "q810-featuredsite-fail-closed",
  theme_family: "candidate",
  first_paint_geometry_selectors: ["#page-content", ".featured-site-box"],
  geometry_selectors: ["#page-content", ".featured-site-box"],
  presence_probes: [
    { id: "page-content", selector: "#page-content" },
    { id: "featured-site-box", selector: ".featured-site-box" },
  ],
});

const SOURCE_FILES = Object.freeze([
  ...new Set([
    ...STANDING_BROWSER_EXECUTION_MODULES,
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-q810-featuredsite-candidate-case-set.mjs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]),
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireSha256(value, name) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256`);
  }
  return value;
}

function requireSlug(value, name) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new Error(`${name} must be a lower-case page slug`);
  }
  return value;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function pageFixture(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return Object.freeze({
    page_id: requirePositiveInteger(value.page_id, `${name}.page_id`),
    revision_id: requirePositiveInteger(value.revision_id, `${name}.revision_id`),
    slug: requireSlug(value.slug, `${name}.slug`),
    source_sha256: requireSha256(value.source_sha256, `${name}.source_sha256`),
  });
}

function featuredSiteFixture(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("private input featuredsite_fixture must be an object");
  }
  if (value.site?.slug !== SITE_SLUG) {
    throw new Error(`FeaturedSite candidate requires the ${SITE_SLUG} fixture site`);
  }
  return Object.freeze({
    site: Object.freeze({
      site_id: requirePositiveInteger(value.site.site_id, "fixture site_id"),
      slug: SITE_SLUG,
    }),
    saved_page: pageFixture(value.saved_page, "fixture saved_page"),
    nested_page: pageFixture(value.nested_page, "fixture nested_page"),
  });
}

class Q810CandidateSession {
  #http;
  #fixture;

  constructor({ candidateIdentity, privateInput, signal }) {
    this.#http = new CandidateHttpSession({ candidateIdentity, privateInput, signal });
    this.#fixture = featuredSiteFixture(privateInput.featuredsite_fixture);
  }

  get fixture() {
    return this.#fixture;
  }

  get pageOrigin() {
    return this.#http.pageOrigin;
  }

  get privateInputIdentity() {
    return {
      ...this.#http.privateInputIdentity,
      fixture_identity_sha256: sha256Value(this.#fixture),
      fixture_site_id: this.#fixture.site.site_id,
      saved_page_id: this.#fixture.saved_page.page_id,
      saved_page_revision_id: this.#fixture.saved_page.revision_id,
      nested_page_id: this.#fixture.nested_page.page_id,
      nested_page_revision_id: this.#fixture.nested_page.revision_id,
    };
  }

  get requiredServiceBindings() {
    return this.#http.requiredServiceBindings;
  }

  get events() {
    return this.#http.events;
  }

  async rpc(method, params, options) {
    return await this.#http.rpc(method, params, options);
  }
}

function pageSource(page, expected, name) {
  if (
    page?.page_id !== expected.page_id ||
    page.revision_id !== expected.revision_id ||
    page.slug !== expected.slug ||
    typeof page.wikitext !== "string" ||
    sha256(page.wikitext) !== expected.source_sha256
  ) {
    throw new Error(`${name} does not match the sealed candidate fixture identity`);
  }
  return page.wikitext;
}

function outputFlags(html) {
  return FORBIDDEN_OUTPUT.filter((fragment) => html.includes(fragment));
}

function forbiddenRequest(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  return parsed.protocol === "http:" ||
    parsed.hostname.endsWith(".wikidot.com") ||
    parsed.hostname === "thumbnails.wdfiles.com";
}

function browserSurface(capture, firstHtml, settledHtml, requests) {
  const content = (html) => ({
    html_sha256: sha256(html),
    unavailable_module: html.includes(EXPECTED_UNAVAILABLE),
    forbidden_output: outputFlags(html),
  });
  return {
    first_paint: {
      phase: capture.first_paint.document.phase,
      content: content(firstHtml),
    },
    settled: {
      phase: capture.document.phase,
      content: content(settledHtml),
    },
    navigation_status: capture.navigation_status,
    input_url: capture.input_url,
    final_url: capture.final_url,
    failures: capture.failures,
    request_gate_aborts: capture.request_gate_aborts,
    requests,
    forbidden_requests: requests.filter(({ url }) => forbiddenRequest(url)),
  };
}

async function pageContent(page) {
  return await page.evaluate(
    () => document.querySelector("#page-content")?.innerHTML ?? "",
  );
}

class Q810FeaturedSiteRun {
  #session;
  #browser;
  #fixture;

  constructor({ session, candidateBrowserContexts }) {
    this.#session = session;
    this.#browser = candidateBrowserContexts;
    this.#fixture = session.fixture;
  }

  async #readFixturePage(page, expected, name) {
    const result = await this.#session.rpc(
      "page_get",
      {
        site_id: this.#fixture.site.site_id,
        page: expected.slug,
        details: { wikitext: true, compiled: false },
      },
      { actor: "anonymous", siteId: this.#fixture.site.site_id, page: expected.slug },
    );
    const source = pageSource(result, expected, name);
    return {
      page_id: result.page_id,
      revision_id: result.revision_id,
      slug: result.slug,
      source_sha256: sha256(source),
      source_has_featuredsite: /\[\[module\s+FeaturedSite\b/iu.test(source),
      source_has_listpages: /\[\[module\s+ListPages\b/iu.test(source),
      source_mentions_saved_slug: source.includes(this.#fixture.saved_page.slug),
    };
  }

  async #capturePage(context, expected, label, index) {
    const url = new URL(`/${encodeURIComponent(expected.slug)}`, this.#session.pageOrigin).href;
    const page = await context.newPage();
    const requests = [];
    const onRequest = (request) => requests.push({ url: request.url(), resource_type: request.resourceType() });
    let firstHtml = "";
    let settledHtml = "";
    page.on("request", onRequest);
    try {
      const capture = await this.#browser.captureCandidateObservation({
        context,
        page,
        url,
        label,
        index,
        contract: BROWSER_CONTRACT,
        navigate: async ({ page: target, url: targetUrl, timeoutMs }) => {
          const response = await target.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          firstHtml = await pageContent(target);
          return response;
        },
      });
      settledHtml = await pageContent(page);
      return browserSurface(capture, firstHtml, settledHtml, requests);
    } finally {
      page.off("request", onRequest);
      await page.close();
    }
  }

  async execute() {
    const site = await this.#session.rpc(
      "site_get",
      { site: this.#fixture.site.slug },
      { actor: "anonymous", siteId: this.#fixture.site.site_id },
    );
    if (site?.site_id !== this.#fixture.site.site_id || site.slug !== this.#fixture.site.slug) {
      throw new Error("candidate FeaturedSite fixture site identity changed");
    }
    const savedPage = await this.#readFixturePage(this.#fixture.saved_page, this.#fixture.saved_page, "saved page");
    if (!savedPage.source_has_featuredsite) throw new Error("saved fixture page does not contain FeaturedSite");
    const nestedPage = await this.#readFixturePage(this.#fixture.nested_page, this.#fixture.nested_page, "nested page");
    if (!nestedPage.source_has_listpages || !nestedPage.source_mentions_saved_slug) {
      throw new Error("nested fixture page does not target the sealed FeaturedSite page");
    }
    const preview = await this.#session.rpc(
      "wikidot_page_preview",
      { site_id: this.#fixture.site.site_id, title: "Q810 FeaturedSite candidate", wikitext: PREVIEW_SOURCE },
      { actor: "anonymous", siteId: this.#fixture.site.site_id },
    );
    if (typeof preview?.body !== "string") throw new Error("candidate PagePreview returned no body");
    const previewFlags = outputFlags(preview.body);
    const previewObservation = {
      body_sha256: sha256(preview.body),
      unavailable_module: preview.body.includes(EXPECTED_UNAVAILABLE),
      forbidden_output: previewFlags,
      styles_count: Array.isArray(preview.styles) ? preview.styles.length : null,
    };

    this.#browser.setActiveFixture("Q810_CANDIDATE_FAIL_CLOSED_NETWORK");
    const { context } = await this.#browser.newCandidateContext({});
    const savedBrowser = await this.#capturePage(context, this.#fixture.saved_page, "Q810_SAVED", 0);
    const nestedBrowser = await this.#capturePage(context, this.#fixture.nested_page, "Q810_NESTED", 1);
    return [{
      case_id: "Q810_CANDIDATE_FAIL_CLOSED_NETWORK",
      observations: {
        site: { site_id: site.site_id, slug: site.slug },
        preview: previewObservation,
        saved_page: { identity: savedPage, browser: savedBrowser },
        nested_page: { identity: nestedPage, browser: nestedBrowser },
        rpc_events: this.#session.events,
      },
    }];
  }

  cleanup() {
    return {
      schema: "wikijump.open43_featuredsite_candidate_cleanup.v1",
      public_absence_verified: true,
      run_owned_resource_count: 0,
      mutation: "none",
    };
  }
}

function verifyBrowserSurface(surface, name) {
  if (surface.navigation_status !== 200 || surface.final_url !== surface.input_url) {
    throw new Error(`${name} candidate navigation did not settle on its requested page`);
  }
  if (surface.first_paint.phase !== "domcontentloaded_immediate_observation" || surface.settled.phase !== "settled") {
    throw new Error(`${name} candidate did not retain both browser observation phases`);
  }
  for (const phase of [surface.first_paint, surface.settled]) {
    if (phase.content.unavailable_module !== true || phase.content.forbidden_output.length !== 0) {
      throw new Error(`${name} candidate rendered a non-fail-closed FeaturedSite result`);
    }
  }
  if (surface.failures.length !== 0 || surface.request_gate_aborts.length !== 0 || surface.forbidden_requests.length !== 0) {
    throw new Error(`${name} candidate made a forbidden or failed browser request`);
  }
  return {
    verified: true,
    first_paint_html_sha256: surface.first_paint.content.html_sha256,
    settled_html_sha256: surface.settled.content.html_sha256,
    request_count: surface.requests.length,
  };
}

function verifyCase(caseId, observations) {
  if (caseId !== "Q810_CANDIDATE_FAIL_CLOSED_NETWORK") throw new Error(`unknown Q810 case: ${caseId}`);
  if (observations.preview.unavailable_module !== true || observations.preview.forbidden_output.length !== 0) {
    throw new Error("Q810 PagePreview did not fail closed");
  }
  if (observations.saved_page.identity.source_has_featuredsite !== true) throw new Error("Q810 saved fixture identity is incomplete");
  if (observations.nested_page.identity.source_has_listpages !== true || observations.nested_page.identity.source_mentions_saved_slug !== true) {
    throw new Error("Q810 nested fixture identity is incomplete");
  }
  return {
    verified: true,
    scope: ["PagePreview", "saved-page", "nested-generated"],
    preview_body_sha256: observations.preview.body_sha256,
    saved_page_source_sha256: observations.saved_page.identity.source_sha256,
    nested_page_source_sha256: observations.nested_page.identity.source_sha256,
    saved_browser: verifyBrowserSurface(observations.saved_page.browser, "saved page"),
    nested_browser: verifyBrowserSurface(observations.nested_page.browser, "nested page"),
  };
}

function verifyCleanup(proof, resources) {
  if (proof?.public_absence_verified !== true || proof.mutation !== "none" || proof.run_owned_resource_count !== 0 || resources.length !== 0) {
    throw new Error("Q810 cleanup did not prove that the read-only candidate owned no public state");
  }
  return { public_absence_verified: true, run_owned_resource_count: 0, mutation: "none" };
}

export function createOpen43FeaturedSiteCandidateCaseSet() {
  return Object.freeze({
    id: "open43-featuredsite",
    caseIds: OPEN43_Q810_FEATUREDSITE_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      if (candidateIdentity.candidate.endpoint.host !== `${SITE_SLUG}.wikijump.localhost`) {
        throw new Error(`Q810 FeaturedSite cases require the ${SITE_SLUG} candidate`);
      }
      const session = new Q810CandidateSession({ candidateIdentity, privateInput, signal });
      const execution = new Q810FeaturedSiteRun({ session, candidateBrowserContexts });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        browserCredentialPolicy: "none",
        plan: {
          schema: "wikijump.open43_featuredsite_candidate_plan.v1",
          site: session.fixture.site,
          saved_page: session.fixture.saved_page,
          nested_page: session.fixture.nested_page,
          preview_source_sha256: sha256(PREVIEW_SOURCE),
          forbidden_output: FORBIDDEN_OUTPUT,
          browser_contract_sha256: sha256Value(BROWSER_CONTRACT),
          mutation: "none",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase,
        verifyCleanup,
      });
    },
  });
}
