import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

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
  "deepwell/tests/page.rs",
  "docs/development/open43-q-page-query-closure-audit.json",
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
const LISTPAGES_WRAPPER = '<div class="list-pages-box">';

function pageSlug(runId, role) {
  return `open43-q1040-${runId.slice("candidate-case-".length)}-${role}`;
}

function requireCandidateSite(candidateIdentity) {
  if (candidateIdentity.candidate.endpoint.host !== SITE_HOST) throw new Error(`Q1040 candidate requires exact ${SITE_HOST}`);
}

function section(html, start, end) {
  const begin = html.indexOf(`<p>${start}</p>`);
  const finish = html.indexOf(`<p>${end}</p>`, begin);
  if (begin < 0 || finish < 0) throw new Error(`Q1040 public output is missing ${begin < 0 ? start : end}`);
  return html.slice(begin + `<p>${start}</p>`.length, finish);
}

function foundHtml(value) {
  if (value?.type !== "found" || typeof value.data?.compiled_body_html !== "string") throw new Error("Q1040 page_view did not return a found compiled body");
  return value.data.compiled_body_html;
}

class Q1040Run {
  #session;
  #browserContexts;
  #resources;
  #siteId = null;
  #pages;
  #pageResources = new Map();

  constructor({ session, browserContexts, resources, runId }) {
    const fixtureId = runId.slice("candidate-case-".length);
    this.#session = session;
    this.#browserContexts = browserContexts;
    this.#resources = resources;
    this.#pages = [
      { role: "previous", slug: pageSlug(runId, "previous"), title: `AAA Q1040 ${fixtureId} previous`, wikitext: "Q1040 previous" },
      { role: "current", slug: pageSlug(runId, "current"), title: `BBB Q1040 ${fixtureId} current`, wikitext: "Q1040_CURRENT\nQ1040_DEFAULT_START\n[[module NextPage by=\"title\"]]\nQ1040_DEFAULT_END\nQ1040_NEXT_START\n[[module NextPage by=\"title\"]]\nNEXT=%%linked_title%%|%%title%%\n[[/module]]\nQ1040_NEXT_END\n[[module PreviousPage]]\nPREVIOUS=%%linked_title%%|%%title%%\n[[/module]]" },
      { role: "next", slug: pageSlug(runId, "next"), title: `CCC Q1040 ${fixtureId} next`, wikitext: "Q1040 next" },
    ];
  }

  async #rpc(method, params = {}, { actor = "editor", page, cleanup = false } = {}) {
    return await this.#session.rpc(method, params, { actor, siteId: this.#siteId ?? undefined, page, cleanup });
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
    entry.page_id = page.page_id;
    entry.revision_id = page.revision_id;
    this.#pageResources.set(entry.slug, this.#resources.register("page", { page_id: page.page_id, revision_id: page.revision_id, slug: entry.slug }));
  }

  async #view() {
    const current = this.#pages[1];
    const next = this.#pages[2];
    const value = await this.#rpc("page_view", {
      site_id: this.#siteId,
      session_token: null,
      route: { slug: current.slug, extra: "" },
      locales: ["en-US", "en"],
    }, { actor: "anonymous", page: current.slug });
    const html = foundHtml(value);
    const defaultRow = section(html, "Q1040_DEFAULT_START", "Q1040_DEFAULT_END");
    const nextRow = section(html, "Q1040_NEXT_START", "Q1040_NEXT_END");
    return {
      default_row: defaultRow,
      next_row: nextRow,
      selected_slug: nextRow.includes(`href="/${next.slug}"`) ? next.slug : null,
      date: defaultRow.match(/<span class="odate time_[^"]+ format_[^"]+">[^<]*<\/span>/u)?.[0] ?? null,
    };
  }

  async #savedBodyHash() {
    const current = await this.#rpc("page_get", {
      site_id: this.#siteId,
      page: this.#pages[1].slug,
      details: { wikitext: true, compiled: true },
    }, { actor: "anonymous", page: this.#pages[1].slug });
    if (typeof current?.compiled_body_html !== "string") throw new Error("Q1040 saved compiled body is unavailable at the public seam");
    return sha256Value(current.compiled_body_html);
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id)) throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    this.#siteId = site.site_id;
    for (const entry of this.#pages) if (await this.#getPage(entry) !== null) throw new Error(`Q1040 run-owned page already exists: ${entry.slug}`);
    for (const entry of this.#pages) await this.#create(entry);
    const current = this.#pages[1];
    const next = this.#pages[2];
    const savedBefore = await this.#savedBodyHash();
    const initial = await this.#view();
    if (initial.selected_slug !== next.slug || !initial.next_row.includes(next.title) || initial.date === null) throw new Error("Q1040 public NextPage did not select the initial adjacent page");

    const renamedTitle = `${next.title} renamed`;
    const edited = await this.#rpc("page_edit", {
      site_id: this.#siteId,
      page: next.slug,
      last_revision_id: next.revision_id,
      revision_comments: "Open43 Q1040 NextPage rename",
      user_id: this.#session.editorUserId,
      title: renamedTitle,
      ip_address: "127.0.0.1",
    }, { page: next.slug });
    if (!Number.isSafeInteger(edited?.revision_id)) throw new Error("Q1040 NextPage rename did not return a public revision");
    next.title = renamedTitle;
    next.revision_id = edited.revision_id;
    const renamed = await this.#view();
    if (renamed.selected_slug !== next.slug || !renamed.next_row.includes(renamedTitle)) throw new Error("Q1040 public NextPage did not observe the renamed adjacent page");

    const beforeDelete = await this.#getPage(next);
    await this.#rpc("page_delete", {
      site_id: this.#siteId,
      page: beforeDelete.page_id,
      last_revision_id: beforeDelete.revision_id,
      revision_comments: "Open43 Q1040 NextPage delete",
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
    }, { page: next.slug });
    const deleted = await this.#view();
    if (deleted.selected_slug !== null || !deleted.next_row.includes(LISTPAGES_WRAPPER) || deleted.next_row.includes("list-pages-item") || deleted.next_row.includes(next.slug)) throw new Error("Q1040 public NextPage did not render the empty wrapper after deletion");

    await this.#rpc("page_restore", {
      site_id: this.#siteId,
      page_id: next.page_id,
      revision_comments: "Open43 Q1040 NextPage restore",
      user_id: this.#session.editorUserId,
      slug: next.slug,
      ip_address: "127.0.0.1",
    }, { page: next.slug });
    const restoredPage = await this.#getPage(next);
    if (!this.#matches(next, restoredPage)) throw new Error("Q1040 NextPage restore did not preserve its public page identity");
    next.revision_id = restoredPage.revision_id;
    const restored = await this.#view();
    const savedAfter = await this.#savedBodyHash();
    if (restored.selected_slug !== next.slug || !restored.next_row.includes(renamedTitle) || restored.date === null || restored.date !== initial.date || savedAfter !== savedBefore) throw new Error("Q1040 public NextPage restore did not preserve the adjacent page and current saved body");

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
      return [{
        case_id: OPEN43_Q1040_CASE_IDS[0],
        observations: {
          url,
          capture,
          ...dom,
          lifecycle: { initial, renamed, deleted, restored },
          saved_body_sha256: { before: savedBefore, after: savedAfter },
          adapter_events: this.#session.events,
          event_scope: "adapter-issued-external-requests-only",
        },
      }];
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
    const lifecycle = observations.lifecycle;
    if (
      lifecycle?.initial?.selected_slug !== next.slug ||
      lifecycle?.renamed?.selected_slug !== next.slug ||
      !lifecycle.renamed.next_row.includes(next.title) ||
      lifecycle?.deleted?.selected_slug !== null ||
      !lifecycle.deleted.next_row.includes(LISTPAGES_WRAPPER) ||
      lifecycle.deleted.next_row.includes("list-pages-item") ||
      lifecycle?.restored?.selected_slug !== next.slug ||
      !lifecycle.restored.next_row.includes(next.title)
    ) throw new Error("Q1040 mutation evidence did not bind rename, delete, restore, and no-result to public reads");
    if (observations.saved_body_sha256?.before !== observations.saved_body_sha256?.after) throw new Error("Q1040 public reads changed the saved current page body");
    if (observations.event_scope !== "adapter-issued-external-requests-only" || !Array.isArray(observations.adapter_events) || observations.adapter_events.filter((event) => event.operation === "page_view" && event.method === "POST" && event.response_status === 200).length < 4) throw new Error("Q1040 evidence does not prove public page_view execution");
    return { verified: true, served_url: observations.url, next_link: nextLink, previous_link: previousLink, mutation_next_read: true, empty_wrapper_contract: true, saved_body_unchanged: true, public_seam: "deepwell.page_view", live_evidence: LIVE_EVIDENCE };
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
        plan: { schema: "wikijump.open43_q1040_candidate_plan.v1", site_slug: SITE_SLUG, case_ids: OPEN43_Q1040_CASE_IDS, evidence: LIVE_EVIDENCE, neighbor_modes: ["title", "creation-date"], mutation_lifecycle: ["rename", "delete", "restore", "no-result"], event_scope: "adapter-issued-external-requests-only" },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup: (proof, resources) => execution.verifyCleanup(proof, resources),
      });
    },
  });
}
