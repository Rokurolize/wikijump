import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  sha256Value,
} from "./standing-browser-parity-util.mjs";
import { findWikijumpIdentifiers } from "./wikijump-identifier-leak.mjs";

export const OPEN43_Q809_CASE_IDS = Object.freeze([
  "Q809_PERMISSION_BEFORE_LIMIT_CANDIDATE",
  "Q809_SERVED_MUTATION_AND_BROWSER_CANDIDATE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const CAPTURE_CONTRACT = Object.freeze({
  slug: "q809-ratedpages",
  theme_family: "wikidot",
  geometry_selectors: [],
  presence_probes: [],
});
const LIVE_EVIDENCE = Object.freeze([
  {
    path: "install/local/wikidot-verification/artifacts/ratedpages-live-basic.json",
    sha256: "f332646cec4e0ba108f1a8fe961e594adf92fb1808a5875db70d2712a2a31602",
  },
  {
    path: "install/local/wikidot-verification/artifacts/ratedpages-live-comments.json",
    sha256: "770c4f5300f7d8a9277bff3fe3d0c989d96b37aab293cee7dc540bd038c12a17",
  },
]);

const SOURCE_FILES = Object.freeze([
  "docs/development/open43-q-page-query-closure-audit.json",
  "docs/wikidot-specifications/specifications/module/module-ratedpages.md",
  ...LIVE_EVIDENCE.map(({ path }) => path),
  "install/local/wikidot-verification/src/atomic-no-replace.mjs",
  "install/local/wikidot-verification/src/browser-render-evidence.mjs",
  "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
  "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
  "install/local/wikidot-verification/src/wikijump-identifier-leak.mjs",
  "deepwell/src/services/render/runtime_modules.rs",
  "deepwell/src/services/render/runtime_page_queries.rs",
  "deepwell/src/endpoints/view.rs",
  "deepwell/src/services/view/structs.rs",
  "deepwell/tests/rated_pages.rs",
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/open43-q809-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
]);

function pageInput(value, name) {
  const page = requirePlainObject(value, name);
  if (!Number.isSafeInteger(page.page_id) || !Number.isSafeInteger(page.category_id)) throw new Error(`${name} must bind safe page and category IDs`);
  requireNonEmptyString(page.slug, `${name}.slug`);
  requireNonEmptyString(page.title, `${name}.title`);
  return page;
}

function fixtureInput(value) {
  const fixture = requirePlainObject(requirePlainObject(value, "private candidate case input").fixture, "private candidate case input.fixture");
  if (!Number.isSafeInteger(fixture.site_id)) throw new Error("Q809 fixture site_id must be a safe integer");
  const pages = {
    holder: pageInput(fixture.holder, "Q809 fixture holder"),
    private_page: pageInput(fixture.private_page, "Q809 fixture private_page"),
    public_page: pageInput(fixture.public_page, "Q809 fixture public_page"),
  };
  if (new Set(Object.values(pages).map(({ page_id }) => page_id)).size !== 3 || pages.private_page.category_id === pages.public_page.category_id) throw new Error("Q809 fixture page identities must be distinct and cross a category permission boundary");
  requireNonEmptyString(fixture.source, "Q809 fixture source");
  for (const name of ["initial_public_score", "mutated_public_score", "private_score"]) if (!Number.isSafeInteger(fixture[name])) throw new Error(`Q809 fixture ${name} must be a safe integer`);
  if (![-1, 1].includes(fixture.mutation_value)) throw new Error("Q809 fixture mutation_value must be -1 or 1");
  if (fixture.mutated_public_score === fixture.initial_public_score) throw new Error("Q809 fixture score mutation must change the public score");
  return Object.freeze({ ...fixture, ...pages });
}

function requireCandidateSite(candidateIdentity) {
  const endpoint = candidateIdentity.candidate.endpoint;
  if (endpoint.host !== `${SITE_SLUG}.wikijump.localhost` || endpoint.port === 443 || candidateIdentity.candidate.port_443_published !== false) throw new Error(`Q809 candidate requires exact non-standing ${SITE_SLUG}.wikijump.localhost`);
}

function requirePage(page, expected, name) {
  if (page?.page_id !== expected.page_id || page.slug !== expected.slug || page.title !== expected.title || page.page_category_id !== expected.category_id) throw new Error(`${name} page identity differs from the private fixture`);
}

function requireFoundHtml(result, name) {
  const html = typeof result === "string" ? result : result?.type === "found" && typeof result.data?.compiled_body_html === "string" ? result.data.compiled_body_html : null;
  if (html === null) throw new Error(`${name} page_view did not return a found compiled page`);
  if (!html.includes('<div class="top-rated-pages-box"><div class="top-rated-pages-list">') || (html.match(/<div class="list-item">/gu) ?? []).length !== 1) throw new Error(`${name} RatedPages output has the wrong public wrapper or row count`);
  if (html.includes("[[module RatedPages")) throw new Error(`${name} RatedPages source leaked into the rendered page`);
  return html;
}

function requireRow(html, page, score, visible, name) {
  const expected = `<a href="/${page.slug}">${page.title}</a><span style="color: #777">(Rating: ${score})</span>`;
  if (visible ? !html.includes(expected) : html.includes(page.title) || html.includes(`href="/${page.slug}"`)) throw new Error(`${name} RatedPages visibility or score is wrong`);
}

class Open43Q809Run {
  #session;
  #fixture;
  #resources;
  #browserContexts;
  #siteId;
  #vote;
  #voteResource;

  constructor({ session, fixture, resources, browserContexts }) {
    this.#session = session;
    this.#fixture = fixture;
    this.#resources = resources;
    this.#browserContexts = browserContexts;
  }

  async #rpc(method, params = {}, options = {}) {
    return await this.#session.rpc(method, params, { siteId: this.#siteId, ...options });
  }

  async #view(actor, cleanup = false) {
    return await this.#session.rpc("page_view", {
      site_id: this.#siteId,
      session_token: actor === "anonymous" ? null : this.#session.editorSessionToken,
      route: { slug: this.#fixture.holder.slug, extra: "" },
      locales: ["en-US", "en"],
    }, {
      actor,
      siteId: this.#siteId,
      page: this.#fixture.holder.slug,
      cleanup,
    });
  }

  async #servedObservation(anonymousBefore, anonymousAfter) {
    const browser = await this.#browserContexts.newCandidateContext();
    const page = await browser.context.newPage();
    const url = new URL(`/${encodeURIComponent(this.#fixture.holder.slug)}`, this.#session.pageOrigin).href;
    try {
      const capture = await this.#browserContexts.captureCandidateObservation({
        context: browser.context,
        page,
        url,
        label: CAPTURE_CONTRACT.slug,
        index: 1,
        contract: CAPTURE_CONTRACT,
        viewport: { width: 1280, height: 900 },
        timeoutMs: 300_000,
        settleMs: 0,
      });
      const served = await page.evaluate(() => {
        const box = document.querySelector("#page-content div.top-rated-pages-box");
        const html = box?.outerHTML ?? "";
        return {
          url: location.href,
          box_html: html,
          list_item_count: (html.match(/<div class="list-item">/gu) ?? []).length,
          compat_markers: html.match(/data-wikijump-compat-[^= ]+/gu) ?? [],
        };
      });
      return {
        url,
        capture,
        served,
        anonymous_before: anonymousBefore,
        anonymous_after: anonymousAfter,
        actor: { editor_user_id: this.#session.editorUserId, rendered_viewer: "anonymous" },
        adapter_events: this.#session.events,
        event_scope: "adapter-issued-external-requests-only",
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (site?.site_id !== this.#fixture.site_id || site.slug !== SITE_SLUG) throw new Error("Q809 candidate site identity differs from the private fixture");
    this.#siteId = site.site_id;
    const pages = await Promise.all([
      this.#rpc("page_get", { site_id: this.#siteId, page: this.#fixture.holder.slug, details: { wikitext: true, compiled: false } }),
      this.#rpc("page_get", { site_id: this.#siteId, page: this.#fixture.private_page.slug, details: { wikitext: false, compiled: false } }),
      this.#rpc("page_get", { site_id: this.#siteId, page: this.#fixture.public_page.slug, details: { wikitext: false, compiled: false } }),
    ]);
    requirePage(pages[0], this.#fixture.holder, "Q809 holder");
    if (pages[0].wikitext !== this.#fixture.source) throw new Error("Q809 holder source differs from the private fixture");
    requirePage(pages[1], this.#fixture.private_page, "Q809 private");
    requirePage(pages[2], this.#fixture.public_page, "Q809 public");

    const anonymousBefore = requireFoundHtml(await this.#view("anonymous"), "Q809 anonymous before");
    const editorBefore = requireFoundHtml(await this.#view("editor"), "Q809 editor before");
    requireRow(anonymousBefore, this.#fixture.public_page, this.#fixture.initial_public_score, true, "Q809 anonymous before public row");
    requireRow(anonymousBefore, this.#fixture.private_page, this.#fixture.private_score, false, "Q809 anonymous before private row");
    requireRow(editorBefore, this.#fixture.private_page, this.#fixture.private_score, true, "Q809 editor before private row");
    requireRow(editorBefore, this.#fixture.public_page, this.#fixture.initial_public_score, false, "Q809 editor before public row");

    this.#vote = await this.#rpc("vote_get", { page_id: this.#fixture.public_page.page_id, user_id: this.#session.editorUserId }, { page: this.#fixture.public_page.slug });
    if (this.#vote !== null && (this.#vote.page_id !== this.#fixture.public_page.page_id || this.#vote.user_id !== this.#session.editorUserId || !Number.isSafeInteger(this.#vote.value))) throw new Error("Q809 editor vote identity is malformed");
    this.#voteResource = this.#resources.register("vote", { page_id: this.#fixture.public_page.page_id, user_id: this.#session.editorUserId, before: this.#vote });
    await this.#rpc("vote_set", { page_id: this.#fixture.public_page.page_id, value: this.#fixture.mutation_value }, { page: this.#fixture.public_page.slug });
    const anonymousAfter = requireFoundHtml(await this.#view("anonymous"), "Q809 anonymous after");
    requireRow(anonymousAfter, this.#fixture.public_page, this.#fixture.mutated_public_score, true, "Q809 anonymous after public row");
    requireRow(anonymousAfter, this.#fixture.private_page, this.#fixture.private_score, false, "Q809 anonymous after private row");
    const served = await this.#servedObservation(anonymousBefore, anonymousAfter);
    return [
      { case_id: OPEN43_Q809_CASE_IDS[0], observations: { anonymous_before: anonymousBefore, editor_before: editorBefore, anonymous_after: anonymousAfter } },
      { case_id: OPEN43_Q809_CASE_IDS[1], observations: served },
    ];
  }

  async cleanup() {
    if (this.#voteResource === undefined) return { restored_vote: null };
    if (this.#vote === null) await this.#rpc("vote_remove", { page_id: this.#fixture.public_page.page_id }, { page: this.#fixture.public_page.slug, cleanup: true });
    else await this.#rpc("vote_set", { page_id: this.#fixture.public_page.page_id, value: this.#vote.value }, { page: this.#fixture.public_page.slug, cleanup: true });
    const restored = await this.#rpc("vote_get", { page_id: this.#fixture.public_page.page_id, user_id: this.#session.editorUserId }, { page: this.#fixture.public_page.slug, cleanup: true });
    if (sha256Value(restored) !== sha256Value(this.#vote)) throw new Error("Q809 candidate vote cleanup did not restore the original value");
    this.#resources.release(this.#voteResource, { before: this.#vote, after: restored });
    return { restored_vote: restored };
  }
}

function verifyCase(caseId, observations, fixture) {
  if (caseId === OPEN43_Q809_CASE_IDS[0]) {
    for (const name of ["anonymous_before", "editor_before", "anonymous_after"]) requireFoundHtml(observations[name], `Q809 ${name} verification`);
    requireRow(observations.anonymous_before, fixture.public_page, fixture.initial_public_score, true, "Q809 verified anonymous before public row");
    requireRow(observations.anonymous_before, fixture.private_page, fixture.private_score, false, "Q809 verified anonymous before private row");
    requireRow(observations.editor_before, fixture.private_page, fixture.private_score, true, "Q809 verified editor private row");
    requireRow(observations.editor_before, fixture.public_page, fixture.initial_public_score, false, "Q809 verified editor public row");
    requireRow(observations.anonymous_after, fixture.public_page, fixture.mutated_public_score, true, "Q809 verified anonymous after public row");
    requireRow(observations.anonymous_after, fixture.private_page, fixture.private_score, false, "Q809 verified anonymous after private row");
    return { verified: true, permission_before_limit: true, current_score_visible: true, live_evidence: LIVE_EVIDENCE };
  }
  if (caseId === OPEN43_Q809_CASE_IDS[1]) {
    const capture = requirePlainObject(observations.capture, "Q809 served capture");
    if (
      capture.navigation_status !== 200 ||
      capture.input_url !== observations.url ||
      capture.final_url !== observations.url ||
      !Array.isArray(capture.failures) ||
      capture.failures.length !== 0 ||
      Object.hasOwn(capture, "capture_error")
    ) throw new Error("Q809 served capture was not a clean HTTP 200");
    const served = requirePlainObject(observations.served, "Q809 served DOM");
    if (served.list_item_count !== 1 || served.compat_markers.length !== 0) throw new Error("Q809 served DOM drifted or leaked internal markers");
    requireRow(served.box_html, fixture.public_page, fixture.mutated_public_score, true, "Q809 served public row");
    requireRow(served.box_html, fixture.private_page, fixture.private_score, false, "Q809 served private row");
    if (served.box_html.includes(`(Rating: ${fixture.initial_public_score})`)) throw new Error("Q809 served DOM kept a stale cached score");
    if (findWikijumpIdentifiers(served.box_html).length !== 0) throw new Error("Q809 served DOM leaked Wikijump identifiers");
    requireFoundHtml(observations.anonymous_before, "Q809 served anonymous before");
    requireFoundHtml(observations.anonymous_after, "Q809 served anonymous after");
    requireRow(observations.anonymous_before, fixture.public_page, fixture.initial_public_score, true, "Q809 served anonymous before row");
    requireRow(observations.anonymous_after, fixture.public_page, fixture.mutated_public_score, true, "Q809 served anonymous after row");
    requireRow(observations.anonymous_after, fixture.private_page, fixture.private_score, false, "Q809 served anonymous after private row");
    if (
      observations.event_scope !== "adapter-issued-external-requests-only" ||
      !Array.isArray(observations.adapter_events) ||
      observations.adapter_events.filter((event) => event.operation === "page_view" && event.method === "POST" && event.response_status === 200).length < 1
    ) throw new Error("Q809 served evidence does not prove public page_view execution");
    return { verified: true, served_mutation_visible: true, stale_cache_absent: true, private_leak_absent: true, internal_identifiers_absent: true, public_seam: "deepwell.page_view and served candidate page" };
  }
  throw new Error(`unknown Q809 case: ${caseId}`);
}

function verifyCleanup(proof, resources) {
  if (proof?.restored_vote !== null && proof?.restored_vote?.value === undefined) throw new Error("Q809 cleanup proof is missing the restored vote state");
  if (!Array.isArray(resources) || resources.length > 1 || resources.some((resource) => resource.released !== true)) throw new Error("Q809 cleanup did not release the vote resource");
  return { public_absence_verified: true, vote_restored: resources.length === 1, resource_count: resources.length };
}

export function createOpen43Q809CandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  return Object.freeze({
    id: "open43-q809",
    caseIds: OPEN43_Q809_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      requireCandidateSite(candidateIdentity);
      const fixture = fixtureInput(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("Q809 session did not bind the sealed candidate origin");
      const fixtureIdentitySha256 = sha256Value(fixture);
      if (session.privateInputIdentity.fixture_identity_sha256 !== undefined && session.privateInputIdentity.fixture_identity_sha256 !== fixtureIdentitySha256) throw new Error("Q809 session fixture identity differs from private input");
      const privateInputIdentity = { ...session.privateInputIdentity, fixture_identity_sha256: fixtureIdentitySha256 };
      const execution = new Open43Q809Run({ session, fixture, resources, browserContexts: candidateBrowserContexts });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity,
        plan: { schema: "wikijump.open43_q809_candidate_plan.v1", case_ids: OPEN43_Q809_CASE_IDS, site_slug: SITE_SLUG, page_origin: session.pageOrigin, holder_slug: fixture.holder.slug, source_sha256: sha256Value(fixture.source), fixture_identity_sha256: fixtureIdentitySha256, live_evidence: LIVE_EVIDENCE, public_seam: "Deepwell page_view JSON-RPC", capture_contract: CAPTURE_CONTRACT },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyCase(caseId, observations, fixture),
        verifyCleanup,
      });
    },
  });
}
