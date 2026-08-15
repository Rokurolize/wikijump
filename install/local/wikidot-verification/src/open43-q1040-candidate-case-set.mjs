import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";

export const OPEN43_Q1040_CASE_IDS = Object.freeze([
  "Q1040_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const LIVE_EVIDENCE = Object.freeze({
  path: "install/local/wikidot-verification/artifacts/nextpreviouspage-module-live.json",
  sha256: "1b2f88a11ef6b7af1b30fee98b72a1b3d87cd0a541c2fb86041ecf4e3563fe1d",
});
const SOURCE_FILES = Object.freeze([...new Set([
  ...STANDING_BROWSER_EXECUTION_MODULES,
  "docs/wikidot-specifications/specifications/module/module-nextpreviouspage.md",
  LIVE_EVIDENCE.path,
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/open43-q1040-candidate-case-set.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
])]);
const CAPTURE_CONTRACT = Object.freeze({
  slug: "q1040-nextpreviouspage",
  theme_family: "wikidot",
  geometry_selectors: [],
  presence_probes: [],
});

function pageSlug(runId, role) {
  return `open43-q1040-${runId.slice("candidate-case-".length)}-${role}`;
}

function requireCandidateSite(candidateIdentity) {
  if (candidateIdentity.candidate.endpoint.host !== SITE_HOST) throw new Error(`Q1040 candidate requires exact ${SITE_HOST}`);
}

class Q1040Run {
  #session;
  #browserContexts;
  #resources;
  #siteId = null;
  #pages;
  #pageResources = new Map();

  constructor({ session, browserContexts, resources, runId }) {
    this.#session = session;
    this.#browserContexts = browserContexts;
    this.#resources = resources;
    this.#pages = [
      { role: "previous", slug: pageSlug(runId, "previous"), title: `Q1040 ${runId.slice("candidate-case-".length)} previous`, wikitext: "Q1040 previous" },
      { role: "current", slug: pageSlug(runId, "current"), title: `Q1040 ${runId.slice("candidate-case-".length)} current`, wikitext: "Q1040_CURRENT\nQ1040_DEFAULT_START\n[[module NextPage by=\"title\"]]\nQ1040_DEFAULT_END\n[[module NextPage by=\"title\"]]\nNEXT=%%linked_title%%|%%title%%\n[[/module]]\n[[module PreviousPage]]\nPREVIOUS=%%linked_title%%|%%title%%\n[[/module]]" },
      { role: "next", slug: pageSlug(runId, "next"), title: `Q1040 ${runId.slice("candidate-case-".length)} next`, wikitext: "Q1040 next" },
    ];
  }

  async #rpc(method, params = {}, { cleanup = false } = {}) {
    return await this.#session.rpc(method, params, { actor: "editor", siteId: this.#siteId ?? undefined, cleanup });
  }

  async #getPage(entry, { cleanup = false } = {}) {
    return await this.#rpc("page_get", { site_id: this.#siteId, page: entry.slug }, { cleanup });
  }

  #matches(entry, page) {
    return page?.page_id !== undefined && page.slug === entry.slug && page.title === entry.title && page.wikitext === entry.wikitext;
  }

  async #create(entry) {
    const page = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug: entry.slug,
      title: entry.title,
      alt_title: null,
      wikitext: entry.wikitext,
      layout: "wikidot",
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 Q1040 candidate fixture",
    });
    if (!this.#matches(entry, page) || !Number.isSafeInteger(page.revision_id)) throw new Error(`Q1040 ${entry.role} page_create did not return its exact public identity`);
    if (!this.#matches(entry, await this.#getPage(entry))) throw new Error(`Q1040 ${entry.role} page_get did not confirm its exact public identity`);
    this.#pageResources.set(entry.slug, this.#resources.register("page", { page_id: page.page_id, revision_id: page.revision_id, slug: entry.slug }));
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id)) throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    this.#siteId = site.site_id;
    for (const entry of this.#pages) if (await this.#getPage(entry) !== null) throw new Error(`Q1040 run-owned page already exists: ${entry.slug}`);
    for (const entry of this.#pages) await this.#create(entry);
    const current = this.#pages[1];
    const browser = await this.#browserContexts.newCandidateContext();
    const page = await browser.context.newPage();
    const url = new URL(`/${encodeURIComponent(current.slug)}`, this.#session.pageOrigin).href;
    try {
      const capture = await this.#browserContexts.captureCandidateObservation({
        context: browser.context,
        page,
        url,
        label: "q1040-nextpreviouspage",
        index: 1,
        contract: CAPTURE_CONTRACT,
        viewport: { width: 1280, height: 900 },
        timeoutMs: 300_000,
        settleMs: 0,
        navigate: ({ page: targetPage, url: targetUrl, timeoutMs }) => targetPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs }),
      });
      const dom = await page.evaluate(() => {
        const content = document.querySelector("#page-content");
        const markers = [...content.querySelectorAll("p")];
        const start = markers.find((node) => node.textContent.trim() === "Q1040_DEFAULT_START");
        const end = markers.find((node) => node.textContent.trim() === "Q1040_DEFAULT_END");
        const wrappers = [];
        for (let node = start?.nextElementSibling; node && node !== end; node = node.nextElementSibling) if (node.matches("div.list-pages-box")) wrappers.push(node);
        return {
          links: [...content.querySelectorAll("a")].map((link) => ({ href: new URL(link.href).pathname, text: link.textContent.trim() })),
          default_row: wrappers.length === 1 ? wrappers[0].outerHTML : null,
        };
      });
      return [{ case_id: OPEN43_Q1040_CASE_IDS[0], observations: { url, capture, ...dom } }];
    } finally {
      await page.close();
    }
  }

  async cleanup() {
    const pages = [];
    const failures = [];
    for (const entry of [...this.#pages].reverse()) {
      try {
        const page = await this.#getPage(entry, { cleanup: true });
        if (page !== null && !this.#matches(entry, page)) throw new Error(`Q1040 cleanup refused an unowned page: ${entry.slug}`);
        if (page !== null) await this.#rpc("page_delete", { site_id: this.#siteId, page: page.page_id, last_revision_id: page.revision_id, revision_comments: "Open43 Q1040 candidate cleanup", user_id: this.#session.editorUserId, ip_address: "127.0.0.1" }, { cleanup: true });
        const pageAfter = await this.#getPage(entry, { cleanup: true });
        const publicAfter = await this.#session.pageRequest(entry.slug, { cleanup: true, operation: `q1040-cleanup-${entry.role}` });
        if (pageAfter !== null || publicAfter.status !== 404) throw new Error(`Q1040 cleanup did not prove public absence: ${entry.slug}`);
        const token = this.#pageResources.get(entry.slug);
        if (token) this.#resources.release(token, { page_get: null, public_status: publicAfter.status });
        pages.push({ role: entry.role, page_get: null, public_status: publicAfter.status });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Q1040 public cleanup failed");
    return { pages: pages.reverse() };
  }

  verifyCase(_caseId, observations) {
    const next = this.#pages[2];
    const previous = this.#pages[0];
    if (observations.capture?.navigation_status !== 200 || observations.capture?.failures?.length !== 0 || observations.capture?.capture_error) throw new Error("Q1040 served capture was not a clean HTTP 200");
    const defaultRow = observations.default_row;
    if (
      typeof defaultRow !== "string" ||
      !defaultRow.startsWith('<div class="list-pages-box">') ||
      !defaultRow.includes('<div class="list-pages-item">') ||
      !defaultRow.includes(`<h1><span><a href="/${next.slug}">${next.title}</a></span></h1>`) ||
      !defaultRow.includes('<p>by <span class="printuser avatarhover">') ||
      !/<span class="odate time_-?\d+ format_[^"]+">[^<]+<\/span>/u.test(defaultRow) ||
      !defaultRow.includes("<p>Q1040 next</p>") ||
      defaultRow.includes("data-wikijump-compat-")
    ) throw new Error("Q1040 served page did not expose the exact default NextPage row");
    const links = observations.links ?? [];
    const nextLink = links.find((link) => link.href === `/${next.slug}` && link.text === next.title);
    const previousLink = links.find((link) => link.href === `/${previous.slug}` && link.text === previous.title);
    if (!nextLink || !previousLink) throw new Error("Q1040 served page did not expose exact title and default-date neighbors");
    return { verified: true, served_url: observations.url, next_link: nextLink, previous_link: previousLink, live_evidence: LIVE_EVIDENCE };
  }

  verifyCleanup(proof, resources) {
    if (!proof || proof.pages?.length !== this.#pages.length || proof.pages.some((page) => page.page_get !== null || page.public_status !== 404) || resources.some((resource) => resource.released !== true)) throw new Error("Q1040 cleanup proof is incomplete");
    return { public_absence_verified: true, page_count: proof.pages.length };
  }
}

export function createOpen43Q1040CandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  return Object.freeze({
    id: "open43-q1040",
    caseIds: OPEN43_Q1040_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      requireCandidateSite(candidateIdentity);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("Q1040 session did not bind the sealed candidate origin");
      const execution = new Q1040Run({ session, browserContexts: candidateBrowserContexts, resources, runId });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        browserCredentialPolicy: "none",
        plan: { schema: "wikijump.open43_q1040_candidate_plan.v1", site_slug: SITE_SLUG, case_ids: OPEN43_Q1040_CASE_IDS, evidence: LIVE_EVIDENCE, neighbor_modes: ["title", "creation-date"] },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup: (proof, resources) => execution.verifyCleanup(proof, resources),
      });
    },
  });
}
