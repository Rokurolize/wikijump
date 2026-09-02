import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

export const OPEN43_CATEGORIES_CASE_IDS = Object.freeze([
  "Q1028_CATEGORY_LIFECYCLE_AND_CACHE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const LIVE_EVIDENCE = Object.freeze({
  path: "install/local/wikidot-verification/artifacts/navigation-list-modules-live.json",
  sha256: "07228f5618e06dba6cf90779bcd0bd2bcd834c1bc4a3a141f4528135fe4da5b1",
});
const MODULE_SOURCE = [
  "CAT_DEFAULT_START",
  "[[module Categories]]",
  "CAT_DEFAULT_END",
  "CAT_TRUE_START",
  '[[module categories includeHidden="true"]]',
  "CAT_TRUE_END",
  "CAT_FALSE_START",
  '[[module Categories includeHidden="false"]]',
  "CAT_FALSE_END",
  "CAT_UPPER_ATTR_START",
  '[[module CATEGORIES INCLUDEHIDDEN="true"]]',
  "CAT_UPPER_ATTR_END",
  "CAT_BARE_START",
  "[[module Categories includeHidden=true]]",
  "CAT_BARE_END",
].join("\n");
const MARKERS = Object.freeze([
  ["default", "CAT_DEFAULT_START", "CAT_DEFAULT_END", false],
  ["true_quoted", "CAT_TRUE_START", "CAT_TRUE_END", true],
  ["false_quoted", "CAT_FALSE_START", "CAT_FALSE_END", true],
  ["upper_attr", "CAT_UPPER_ATTR_START", "CAT_UPPER_ATTR_END", false],
  ["bare", "CAT_BARE_START", "CAT_BARE_END", false],
]);
const SOURCE_FILES = Object.freeze([
  ...STANDING_BROWSER_EXECUTION_MODULES,
  "deepwell/src/services/render/categories.rs",
  "deepwell/tests/page.rs",
  "docs/wikidot-specifications/specifications/module/module-categories.md",
  LIVE_EVIDENCE.path,
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/open43-settings-candidate-http.mjs",
  "install/local/wikidot-verification/src/open43-categories-candidate-case-set.mjs",
]);

function categorySort(left, right) {
  const leftKey = left.slug.replaceAll("-", "");
  const rightKey = right.slug.replaceAll("-", "");
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
}

function extractSections(page, markers) {
  return page.evaluate((selectedMarkers) => {
    const body = document.body.innerHTML;
    const read = (start, end) => {
      const begin = body.indexOf(start);
      const finish = body.indexOf(end, begin + start.length);
      if (begin < 0 || finish < 0) throw new Error(`category marker ${start}/${end} is missing`);
      const html = body.slice(begin, finish);
      const parsed = new DOMParser().parseFromString(html, "text/html").body;
      const children = [...parsed.children];
      return {
        html,
        headings: [...parsed.querySelectorAll("h3")].map((node) => node.textContent),
        blocks: children.filter((node) => node.tagName === "DIV").map((node) => [...node.children].map((child) => child.tagName)),
        controls: [...parsed.querySelectorAll('a[id^="category-pages-toggler-"]')].map((node) => ({
          id: node.id,
          href: node.getAttribute("href"),
          onclick: node.getAttribute("onclick"),
          text: node.textContent,
        })),
        pages: [...parsed.querySelectorAll('div[id^="category-pages-"]')]
          .filter((node) => /^category-pages-\d+$/u.test(node.id))
          .map((node) => ({ id: node.id, style: node.getAttribute("style"), text: node.textContent })),
        options: [...parsed.querySelectorAll('div[id$="-options"]')].map((node) => ({ id: node.id, style: node.getAttribute("style"), text: node.textContent })),
      };
    };
    return Object.fromEntries(selectedMarkers.map(([name, start, end]) => [name, read(start, end)]));
  }, markers);
}

function assertPage(entry, page, name) {
  if (
    !Number.isSafeInteger(page?.page_id) ||
    page.slug !== entry.slug ||
    page.title !== entry.title ||
    page.wikitext !== entry.wikitext ||
    !Number.isSafeInteger(page.page_category_id) ||
    (entry.categoryId !== null && page.page_category_id !== entry.categoryId) ||
    !Number.isSafeInteger(page.revision_id)
  ) throw new Error(`${name} did not preserve its run-owned public identity`);
}

class Open43CategoriesRun {
  #session;
  #browser;
  #resources;
  #runId;
  #siteId = null;
  #pages = [];
  #categories = null;

  constructor({ session, browser, resources, runId }) {
    this.#session = session;
    this.#browser = browser;
    this.#resources = resources;
    this.#runId = runId;
  }

  async #rpc(method, params = {}, { cleanup = false } = {}) {
    return await this.#session.rpc(method, params, { actor: "administrator", siteId: this.#siteId ?? undefined, cleanup });
  }

  async #page(entry, { cleanup = false } = {}) {
    return await this.#rpc("page_get", { site_id: this.#siteId, page: entry.slug, details: { wikitext: true, compiled: false } }, { cleanup });
  }

  #entry(role, slug, title, wikitext, categoryId) {
    return { role, slug, title, wikitext, categoryId, token: null, pageId: null, revisionId: null };
  }

  async #create(entry) {
    if (await this.#page(entry) !== null) throw new Error(`Q1028 run-owned page already exists: ${entry.slug}`);
    let created;
    try {
      created = await this.#rpc("page_create", {
        site_id: this.#siteId,
        slug: entry.slug,
        title: entry.title,
        alt_title: null,
        wikitext: entry.wikitext,
        layout: "wikidot",
        revision_comments: "Open43 Q1028 Categories candidate fixture",
        user_id: this.#session.privateInputIdentity.administrator_user_id,
        ip_address: "127.0.0.1",
        tags: [],
      });
    } catch (error) {
      const recovered = await this.#page(entry, { cleanup: true });
      if (recovered !== null) {
        assertPage(entry, recovered, `recovered ${entry.role}`);
        entry.categoryId ??= recovered.page_category_id;
        this.#adopt(entry, recovered);
      }
      throw error;
    }
    if (!Number.isSafeInteger(created?.page_id) || !Number.isSafeInteger(created.revision_id) || created.slug !== entry.slug) {
      throw new Error(`created ${entry.role} did not return the public page_create identity`);
    }
    const observed = await this.#page(entry);
    assertPage(entry, observed, `read-back ${entry.role}`);
    if (observed.page_id !== created.page_id || observed.revision_id !== created.revision_id) {
      throw new Error(`created ${entry.role} did not round-trip the public page_create identity`);
    }
    entry.categoryId ??= observed.page_category_id;
    this.#adopt(entry, observed);
  }

  #adopt(entry, page) {
    if (entry.token !== null) return;
    entry.pageId = page.page_id;
    entry.revisionId = page.revision_id;
    entry.token = this.#resources.register("page", { site_id: this.#siteId, page_id: page.page_id, slug: entry.slug, owner: `candidate-case:${this.#runId}` });
    this.#pages.push(entry);
  }

  async #category(slug) {
    const category = await this.#rpc("category_get", { site: this.#siteId, category: slug });
    if (!Number.isSafeInteger(category?.category_id) || category.slug !== slug) throw new Error(`Q1028 category ${slug} is missing or malformed`);
    return { id: category.category_id, slug: category.slug };
  }

  async execute() {
    const actorSessions = await this.#session.verifyActorSessions();
    const site = await this.#rpc("site_get", { site: SITE_SLUG });
    if (site?.site_id !== this.#session.fixtureIdentity.site_id || site.slug !== SITE_SLUG) throw new Error("Q1028 candidate site identity did not match the private fixture");
    this.#siteId = site.site_id;
    const defaultCategory = await this.#category(this.#session.fixtureIdentity.default_category.slug);
    const visibleCategory = await this.#category(this.#session.fixtureIdentity.transition_category.slug);
    const hiddenSlug = `_open43-q1028-${this.#runId.slice("candidate-run-".length)}-hidden`;
    const holderSlug = `open43-q1028-${this.#runId.slice("candidate-run-".length)}-holder`;
    const hiddenPage = this.#entry("hidden", `${hiddenSlug}:page`, "Open43 Q1028 hidden category page", "Q1028 hidden category page", null);
    const holderPage = this.#entry("holder", holderSlug, "Open43 Q1028 Categories holder", MODULE_SOURCE, defaultCategory.id);
    await this.#create(hiddenPage);
    const hiddenCategory = await this.#category(hiddenSlug);
    hiddenPage.categoryId = hiddenCategory.id;
    const hiddenReadback = await this.#page(hiddenPage);
    assertPage(hiddenPage, hiddenReadback, "hidden category read-back");
    await this.#create(holderPage);
    this.#categories = {
      all: (await this.#rpc("category_get_all_active", { site: this.#siteId })).map((category) => ({ id: category.category_id, slug: category.slug })).sort(categorySort),
      default: defaultCategory,
      visible: visibleCategory,
      hidden: hiddenCategory,
    };

    const views = {};
    for (const [actor, storageState] of [["anonymous", this.#session.storageState("anonymous")], ["administrator", this.#session.storageState("administrator")]]) {
      this.#browser.setActiveFixture(OPEN43_CATEGORIES_CASE_IDS[0]);
      const owned = await this.#browser.newCandidateContext({ storageState });
      const page = await owned.context.newPage();
      const url = new URL(`/${encodeURIComponent(holderPage.slug)}`, this.#session.pageOrigin).href;
      try {
        const capture = await this.#browser.captureCandidateObservation({
          context: owned.context,
          page,
          url,
          label: "Q1028_CATEGORIES",
          index: actor === "anonymous" ? 0 : 1,
          contract: { slug: "q1028-categories", theme_family: "wikidot", geometry_selectors: [], presence_probes: [] },
          viewport: { width: 1280, height: 900 },
          timeoutMs: 300_000,
          settleMs: 0,
          navigate: ({ page: targetPage, url: targetUrl, timeoutMs }) => targetPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs }),
        });
        views[actor] = { capture, sections: await extractSections(page, MARKERS) };
      } finally {
        await page.close();
      }
    }

    return [{
      case_id: OPEN43_CATEGORIES_CASE_IDS[0],
      observations: {
        source: { module_source: MODULE_SOURCE, live_evidence: LIVE_EVIDENCE },
        fixture: { site_id: this.#siteId, holder: holderPage, hidden: hiddenPage, categories: this.#categories },
        actor_sessions: actorSessions,
        views,
        event_scope: "candidate-rpc-and-runner-owned-browser-only",
      },
    }];
  }

  async cleanup() {
    const pages = [];
    if (this.#siteId === null) return { pages, hidden_category_active: false };
    const failures = [];
    for (const entry of [...this.#pages].reverse()) {
      try {
        const current = await this.#page(entry, { cleanup: true });
        if (current !== null) {
          assertPage(entry, current, `cleanup ${entry.role}`);
          await this.#rpc("page_delete", {
            site_id: this.#siteId,
            page: entry.slug,
            last_revision_id: current.revision_id,
            revision_comments: "Open43 Q1028 Categories candidate cleanup",
            user_id: this.#session.privateInputIdentity.administrator_user_id,
            ip_address: "127.0.0.1",
          }, { cleanup: true });
        }
        const absent = await this.#page(entry, { cleanup: true });
        if (absent !== null) throw new Error(`Q1028 cleanup did not prove page absence: ${entry.slug}`);
        this.#resources.release(entry.token, { page_get: null, slug: entry.slug });
        pages.push({ role: entry.role, page_get: null });
      } catch (error) {
        failures.push(error);
      }
    }
    const active = await this.#rpc("category_get_all_active", { site: this.#siteId }, { cleanup: true });
    if (this.#categories?.hidden && active.some((category) => category.category_id === this.#categories.hidden.id)) failures.push(new Error("Q1028 cleanup left the run-owned hidden category active"));
    if (failures.length > 0) throw new AggregateError(failures, "Q1028 public cleanup failed");
    return { pages: pages.reverse(), hidden_category_active: false };
  }

  verifyCase(_caseId, observations) {
    const categories = observations.fixture?.categories;
    if (observations.event_scope !== "candidate-rpc-and-runner-owned-browser-only" || !categories || !observations.views) throw new Error("Q1028 candidate evidence is incomplete");
    const expectedAll = categories.all;
    const restricted = new Set(this.#session.fixtureIdentity.view_restricted_categories);
    const expectedIds = new Map(expectedAll.map(({ slug, id }) => [slug, id]));
    for (const [actor, view] of Object.entries(observations.views)) {
      if (view.capture?.navigation_status !== 200 || view.capture?.failures?.length !== 0 || view.capture?.capture_error) throw new Error(`Q1028 ${actor} capture was not a clean HTTP 200`);
      const expectedActorAll = actor === "administrator" ? expectedAll : expectedAll.filter(({ slug }) => !restricted.has(slug));
      for (const [name, section] of Object.entries(view.sections)) {
        const includeHidden = name === "true_quoted";
        const expected = includeHidden ? expectedActorAll : expectedActorAll.filter(({ slug }) => slug === "_default" || !slug.startsWith("_"));
        if (JSON.stringify(section.headings) !== JSON.stringify(expected.map(({ slug }) => slug))) throw new Error(`Q1028 ${actor} ${name} category order or visibility is wrong`);
        if (section.blocks.length !== expected.length || section.blocks.some((children) => JSON.stringify(children) !== JSON.stringify(["H3", "A", "DIV", "DIV"]))) throw new Error(`Q1028 ${actor} ${name} wrapper shape is wrong`);
        if (section.controls.length !== expected.length || section.pages.length !== expected.length || section.options.length !== expected.length) throw new Error(`Q1028 ${actor} ${name} category controls are incomplete`);
        expected.forEach(({ slug }) => {
          const id = expectedIds.get(slug);
          const control = section.controls.find(({ id: controlId }) => controlId === `category-pages-toggler-${id}`);
          if (!control || control.href !== "javascript:;" || control.onclick !== `WIKIDOT.modules.WikiCategoriesModule.listeners.toggleListPages(event, ${id})` || control.text !== "+ list pages") throw new Error(`Q1028 ${actor} ${name} toggler is wrong for ${slug}`);
          const pageBox = section.pages.find(({ id: boxId }) => boxId === `category-pages-${id}`);
          const options = section.options.find(({ id: optionsId }) => optionsId === `category-pages-${id}-options`);
          if (!pageBox || pageBox.style !== "display: none" || pageBox.text !== "" || !options || options.style !== "display: none" || options.text !== (includeHidden ? "1" : "")) throw new Error(`Q1028 ${actor} ${name} hidden DOM is wrong for ${slug}`);
        });
        if (section.html.includes("[[module")) throw new Error(`Q1028 ${actor} ${name} leaked raw module source`);
      }
    }
    return { verified: true, actors: Object.keys(observations.views).sort(), exact_initial_dom: true, include_hidden_argument_matrix: true, public_seam: "framerail.browser-with-deepwell-rpc-fixture", live_evidence: LIVE_EVIDENCE };
  }

  verifyCleanup(proof, resources) {
    if (!proof || proof.hidden_category_active !== false || proof.pages?.length !== this.#pages.length || proof.pages.some(({ page_get }) => page_get !== null) || resources.some((resource) => resource.released !== true)) throw new Error("Q1028 cleanup proof is incomplete");
    return { public_absence_verified: true, page_count: proof.pages.length, hidden_category_inactive: true };
  }
}

function requireCandidateSite(candidateIdentity) {
  const expected = `${SITE_SLUG}.wikijump.localhost`;
  if (candidateIdentity?.candidate?.endpoint?.host !== expected) throw new Error(`Q1028 candidate requires exact ${expected}`);
}

async function defaultSessionFactory(options) {
  const { Open43SettingsCandidateSession } = await import("./open43-settings-candidate-http.mjs");
  return new Open43SettingsCandidateSession(options);
}

export function createOpen43CategoriesCandidateCaseSet({ sessionFactory = defaultSessionFactory } = {}) {
  return Object.freeze({
    id: "open43-categories",
    caseIds: OPEN43_CATEGORIES_CASE_IDS,
    async prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      requireCandidateSite(candidateIdentity);
      const session = await sessionFactory({ candidateIdentity, privateInput, signal });
      const execution = new Open43CategoriesRun({ session, browser: candidateBrowserContexts, resources, runId });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        browserCredentialPolicy: { mode: "private-actor-storage-states", storage_state_count: 2, private_input_identity_sha256: sha256Value(session.privateInputIdentity) },
        plan: { schema: "wikijump.open43_categories_candidate_plan.v1", site_slug: SITE_SLUG, case_ids: OPEN43_CATEGORIES_CASE_IDS, module_source: MODULE_SOURCE, live_evidence: LIVE_EVIDENCE },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup: (proof, resourcesSnapshot) => execution.verifyCleanup(proof, resourcesSnapshot),
      });
    },
  });
}
