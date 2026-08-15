import { Open43SettingsBrowserAdapter } from "./open43-settings-browser-adapter.mjs";
import {
  OPEN43_PAGE_TAGS_CASE_IDS,
  verifyOpen43PageTagsCase,
  verifyOpen43PageTagsCleanup,
} from "./open43-page-tags-browser-candidate-contract.mjs";
import { Open43SettingsCandidateSession } from "./open43-settings-candidate-http.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = SITE_SLUG + ".wikijump.localhost";
const VIEWPORTS = Object.freeze([1280, 767, 479]);

function pageIdentity(page) {
  return {
    site_id: page.site_id,
    page_id: page.page_id,
    slug: page.slug,
    page_category_id: page.page_category_id,
    revision_id: page.revision_id,
    tag_count: page.tags.length,
    tags_sha256: sha256Value(page.tags),
  };
}

function temporal(pair, phase) {
  const initial = phase === "initial";
  return {
    phase: initial ? pair.capture.first_paint.document.phase : pair.capture.document.phase,
    sequence: initial ? 1 : 2,
    input_url: pair.capture.input_url,
    final_url: pair.capture.final_url,
    navigation_status: pair.capture.navigation_status,
    artifact: initial ? pair.capture.first_paint.screenshot : pair.capture.settled_viewport_screenshot,
    counterpart_artifact_path: initial ? pair.capture.settled_viewport_screenshot.path : pair.capture.first_paint.screenshot.path,
    counterpart_artifact_sha256: initial ? pair.capture.settled_viewport_screenshot.sha256 : pair.capture.first_paint.screenshot.sha256,
  };
}

function captureRow(pair, width, phase) {
  return {
    viewport: { width, height: 900 },
    temporal: temporal(pair, phase),
    page_tags: pair[phase].page_tags,
    stylesheet_assets: pair.stylesheet_assets,
    capture_failures: pair.capture.failures,
    request_gate_aborts: pair.capture.request_gate_aborts ?? [],
    failed_request_identity_sha256: failedRequestIdentity(pair),
  };
}

function failedRequestIdentity(pair) {
  return sha256Value({ failures: pair.capture.failures, request_gate_aborts: pair.capture.request_gate_aborts ?? [] });
}

class Open43PageTagsRun {
  #session;
  #browser;
  #resources;
  #siteId;
  #fixture;
  #plan = null;
  #pageBefore = null;
  #pageResource = null;

  constructor({ session, browser, resources }) {
    this.#session = session;
    this.#browser = browser;
    this.#resources = resources;
    this.#siteId = session.fixtureIdentity.site_id;
    this.#fixture = session.fixtureIdentity.transition_category;
  }

  async #readPage(cleanup = false) {
    const page = await this.#session.rpc(
      "page_get",
      { site_id: this.#siteId, page: this.#fixture.page_slug, details: { wikitext: false, compiled: false } },
      { actor: "administrator", siteId: this.#siteId, page: this.#fixture.page_slug, cleanup },
    );
    if (
      page?.site_id !== this.#siteId ||
      page.page_id !== this.#fixture.page_id ||
      page.slug !== this.#fixture.page_slug ||
      page.page_category_id !== this.#fixture.category_id ||
      !Number.isSafeInteger(page.revision_id) ||
      !Array.isArray(page.tags) ||
      page.tags.length === 0 ||
      page.tags.some((tag) => typeof tag !== "string")
    ) throw new Error("public page-tags fixture page is missing, malformed, or tagless");
    return page;
  }

  async execute() {
    const sessions = await this.#session.verifyActorSessions();
    const privateIdentity = this.#session.privateInputIdentity;
    if (sessions.administrator_user_id !== privateIdentity.administrator_user_id || sessions.non_admin_user_id !== privateIdentity.non_admin_user_id || sessions.expired_session !== null) throw new Error("page-tags actor session identity differs from private input");
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG }, { actor: "administrator" });
    if (site?.site_id !== this.#siteId || site.slug !== SITE_SLUG) throw new Error("page-tags candidate site identity is missing or malformed");
    const page = await this.#readPage();
    const pageUrl = new URL("/" + encodeURIComponent(page.slug), this.#session.pageOrigin).href;
    const hrefs = page.tags.map((tag) => new URL("/system:page-tags/tag/" + tag + "#pages", this.#session.pageOrigin).href);
    const identity = pageIdentity(page);
    this.#plan = {
      schema: "wikijump.open43_page_tags_browser_candidate_plan.v1",
      site_id: page.site_id,
      page_id: page.page_id,
      page_slug: page.slug,
      page_category_id: page.page_category_id,
      page_url: pageUrl,
      tag_count: page.tags.length,
      tags_sha256: identity.tags_sha256,
      hrefs_sha256: sha256Value(hrefs),
    };
    this.#pageBefore = { ...identity, hrefs_sha256: this.#plan.hrefs_sha256 };
    this.#pageResource = this.#resources.register("page-tags", { ...this.#pageBefore, before_sha256: sha256Value(this.#pageBefore) });
    const captures = { initial: [], settled: [] };
    for (const [index, width] of VIEWPORTS.entries()) {
      const pair = await this.#browser.capturePagePair({
        url: pageUrl,
        label: "B822_PAGE_TAGS",
        index,
        viewport: { width, height: 900 },
        captureStylesheetAssets: true,
      });
      captures.initial.push(captureRow(pair, width, "initial"));
      captures.settled.push(captureRow(pair, width, "settled"));
    }
    return OPEN43_PAGE_TAGS_CASE_IDS.map((caseId, index) => ({
      case_id: caseId,
      observations: {
        page_url: pageUrl,
        public_page: this.#pageBefore,
        captures: index === 0 ? captures.initial : captures.settled,
      },
    }));
  }

  async cleanup() {
    const afterPage = await this.#readPage(true).then((page) => ({ ...pageIdentity(page), hrefs_sha256: this.#plan?.hrefs_sha256 ?? null }));
    if (this.#pageResource !== null && this.#pageBefore !== null && sha256Value(this.#pageBefore) === sha256Value(afterPage)) this.#resources.release(this.#pageResource, { before_sha256: sha256Value(this.#pageBefore), after_sha256: sha256Value(afterPage) });
    return { before: this.#pageBefore, after: afterPage };
  }

  verifyCase(caseId, observations) {
    if (this.#plan === null) throw new Error("page-tags case was not executed");
    return verifyOpen43PageTagsCase(caseId, observations, this.#plan);
  }
}

const SOURCE_FILES = Object.freeze([...new Set([
  ...STANDING_BROWSER_EXECUTION_MODULES,
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
  "install/local/wikidot-verification/src/open43-page-tags-browser-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/open43-page-tags-browser-candidate-contract.mjs",
  "install/local/wikidot-verification/src/open43-settings-browser-adapter.mjs",
  "install/local/wikidot-verification/src/open43-settings-candidate-http.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "framerail/src/routes/[slug]/[...extra]/page.scss",
  "framerail/src/routes/[slug]/[...extra]/page.svelte",
  "framerail/src/routes/[slug]/[...extra]/WikidotFoundPageTags.svelte",
  "framerail/src/lib/wikidot/wikidot-page-tags.js",
  "framerail/src/routes/+layout.svelte",
  "framerail/static/wikidot/styles/wikidot-base-165bc434fd1d.css",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
])]);

export function createOpen43PageTagsBrowserCandidateCaseSet({
  sessionFactory = (options) => new Open43SettingsCandidateSession(options),
  browserAdapterFactory = (options) => new Open43SettingsBrowserAdapter(options),
} = {}) {
  return Object.freeze({
    id: "open43-settings-page-tags",
    caseIds: OPEN43_PAGE_TAGS_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      if (candidateIdentity.candidate.endpoint.host !== SITE_HOST || candidateIdentity.candidate.endpoint.port === 443 || candidateIdentity.candidate.port_443_published !== false) throw new Error("Open43 page-tags cases require exact non-standing " + SITE_HOST);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("page-tags session did not bind the sealed editable candidate origin");
      const browser = browserAdapterFactory({ browserContexts: candidateBrowserContexts, pageOrigin: session.pageOrigin, storageState: (actor) => session.storageState(actor) });
      const execution = new Open43PageTagsRun({ session, browser, resources });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        browserCredentialPolicy: { mode: "private-actor-storage-states", storage_state_count: 2, private_input_identity_sha256: sha256Value(session.privateInputIdentity) },
        plan: { schema: "wikijump.open43_page_tags_browser_candidate_plan.v1", site_id: session.fixtureIdentity.site_id, site_slug: SITE_SLUG, case_ids: OPEN43_PAGE_TAGS_CASE_IDS, fixture_category: session.fixtureIdentity.transition_category.slug, fixture_category_id: session.fixtureIdentity.transition_category.category_id, fixture_page_slug: session.fixtureIdentity.transition_category.page_slug, fixture_page_id: session.fixtureIdentity.transition_category.page_id },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup: verifyOpen43PageTagsCleanup,
      });
    },
  });
}
