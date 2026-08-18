import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

export const OPEN43_NEXT_PREVIOUS_CASE_IDS = Object.freeze([
  "Q811_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const LIVE_FIXTURE_PATH = "install/local/wikidot-verification/artifacts/nextpreviouspage-module-live.json";
const SOURCE_FIXTURE_PATH = "deepwell/tests/page.rs";
const LIVE_FIXTURE_SHA256 = "1b2f88a11ef6b7af1b30fee98b72a1b3d87cd0a541c2fb86041ecf4e3563fe1d";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const LIVE_FIXTURE = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, LIVE_FIXTURE_PATH), "utf8"));
const LIVE_CAPTURE = LIVE_FIXTURE.captures.find(({ case_id }) => case_id === "middle-documented-body-category-title-date-tags");
if (!LIVE_CAPTURE) throw new Error("source-owned NextPreviousPage live fixture is missing its middle case");
const LISTPAGES_WRAPPER = '<div class="list-pages-box">';
if (!LIVE_CAPTURE.page_content_html.includes(LISTPAGES_WRAPPER)) throw new Error("source-owned NextPreviousPage live fixture is missing the ListPages wrapper");

const PAGE_NAMES = Object.freeze({ older: "older", holder: "holder", newer: "newer" });

function pageSlug(prefix, name) {
  return `${prefix}:${name}`;
}

function pageTitle(prefix, name) {
  return {
    older: `AAA ${prefix} Previous Candidate`,
    holder: `BBB ${prefix} Holder`,
    newer: `CCC ${prefix} Next Candidate`,
  }[name];
}

function holderSource(category) {
  return [
    "PREVIOUS_START",
    `[[module PreviousPage category="${category}"]]`,
    "PREVIOUS_END",
    "INLINE_START",
    "start-[[module PreviousPage]]-middle",
    "INLINE_END",
  ].join("\n");
}

function section(html, start, end) {
  const begin = html.indexOf(start);
  if (begin < 0) throw new Error(`NextPreviousPage output is missing ${start}`);
  let contentStart = begin + start.length;
  for (const boundary of ["</p>", "<br>\n", "<br>"]) {
    if (html.startsWith(boundary, contentStart)) {
      contentStart += boundary.length;
      break;
    }
  }
  const finish = html.indexOf(end, contentStart);
  if (finish < 0) throw new Error(`NextPreviousPage output is missing ${end}`);
  let contentEnd = finish;
  if (html.slice(contentStart, contentEnd).endsWith("<p>")) contentEnd -= 3;
  return html.slice(contentStart, contentEnd);
}

function foundHtml(value) {
  if (value?.type !== "found" || typeof value.data?.compiled_body_html !== "string") throw new Error("page_view did not return a found compiled body at the public seam");
  return value.data.compiled_body_html;
}

function pageCreateParams(siteId, page, userId) {
  return {
    site_id: siteId,
    wikitext: page.wikitext,
    title: page.title,
    alt_title: null,
    slug: page.slug,
    layout: "wikidot",
    revision_comments: "Open43 Q811 NextPreviousPage candidate fixture",
    user_id: userId,
    ip_address: "127.0.0.1",
    tags: [],
  };
}

function requirePage(value, expected, name) {
  if (value?.page_id !== expected.page_id || value.slug !== expected.slug || value.title !== expected.title || value.wikitext !== expected.wikitext) throw new Error(`${name} did not preserve the run-owned public page identity`);
}

function exactPrintuser(printuser, expectedUserId) {
  const match = printuser?.match(/^<span class="printuser avatarhover"><a href="(http:\/\/www\.wikidot\.com\/user:info\/[^"]+)" onclick="WIKIDOT\.page\.listeners\.userInfo\((-?\d+)\); return false;"><img class="small" src="http:\/\/www\.wikidot\.com\/avatar\.php\?userid=(-?\d+)&amp;amp;size=small&amp;amp;timestamp=-?\d+" alt="([^"]+)" style="background-image:url\(http:\/\/www\.wikidot\.com\/userkarma\.php\?u=(-?\d+)\)" \/><\/a><a href="([^"]+)" onclick="WIKIDOT\.page\.listeners\.userInfo\((-?\d+)\); return false;">([^<]+)<\/a><\/span>$/u);
  if (!match) return false;
  const [, profile, firstListenerId, avatarId, alt, karmaId, secondProfile, secondListenerId, name] = match;
  const expected = String(expectedUserId);
  return profile === secondProfile && alt === name && [firstListenerId, avatarId, karmaId, secondListenerId].every((value) => value === expected);
}

function defaultRowEvidence(html, page, expectedUserId) {
  const author = html.match(/<p>by ([\s\S]*?)<\/p>/u)?.[1] ?? null;
  const printuserHtml = author?.match(/^(<span class="printuser avatarhover">[\s\S]*?<\/span>) <span class="odate /u)?.[1] ?? null;
  const date = html.match(/<span class="odate time_[^"]+ format_[^"]+">[^<]*<\/span>/u)?.[0] ?? null;
  return {
    wrapper: html.includes(LISTPAGES_WRAPPER),
    row: html.includes('<div class="list-pages-item">'),
    title: html.includes(`<h1><span><a href="/${page.slug}">${page.title}</a></span></h1>`),
    author,
    printuser: exactPrintuser(printuserHtml, expectedUserId),
    date,
    body: html.includes("Previous candidate body."),
    compat_markers: html.match(/data-wikijump-compat-[^= ]+/gu) ?? [],
  };
}

class Open43NextPreviousRun {
  #session;
  #resources;
  #prefix;
  #siteId = null;
  #pages = new Map();

  constructor({ session, resources, prefix }) {
    this.#session = session;
    this.#resources = resources;
    this.#prefix = prefix;
  }

  #page(name) {
    return this.#pages.get(name);
  }

  async #rpc(method, params = {}, { actor = "editor", page = null, cleanup = false } = {}) {
    return await this.#session.rpc(method, params, {
      actor,
      siteId: this.#siteId ?? undefined,
      page: page ?? this.#pages.get(PAGE_NAMES.holder)?.slug,
      cleanup,
    });
  }

  async #getPage(name, { actor = "editor", cleanup = false, compiled = false, pageOverride = null } = {}) {
    const page = this.#page(name) ?? pageOverride;
    if (!page || this.#siteId === null) return null;
    return await this.#rpc("page_get", {
      site_id: this.#siteId,
      page: page.slug,
      details: { wikitext: true, compiled },
    }, { actor, page: page.slug, cleanup });
  }

  async #createPage(name) {
    const page = {
      slug: pageSlug(this.#prefix, name),
      title: pageTitle(this.#prefix, name),
      wikitext: name === PAGE_NAMES.holder ? holderSource(this.#prefix) : `${name === PAGE_NAMES.older ? "Previous" : "Next"} candidate body.`,
    };
    if (await this.#getPage(name, { pageOverride: page })) throw new Error(`run-owned NextPreviousPage page already exists: ${page.slug}`);
    let created;
    try {
      created = await this.#rpc("page_create", pageCreateParams(this.#siteId, page, this.#session.editorUserId), { page: page.slug });
    } catch (error) {
      const recovered = await this.#getPage(name, { cleanup: true, pageOverride: page });
      if (recovered) {
        requirePage(recovered, { ...page, page_id: recovered.page_id }, `recovered ${name}`);
        const token = this.#resources.register("page", { site_id: this.#siteId, page_id: recovered.page_id, slug: page.slug, owner: `candidate-case:${this.#prefix}` });
        this.#pages.set(name, { ...page, page_id: recovered.page_id, revision_id: recovered.revision_id, token });
      }
      throw error;
    }
    if (!Number.isSafeInteger(created?.page_id) || !Number.isSafeInteger(created.revision_id) || created.slug !== page.slug) throw new Error(`page_create did not return the public ${name} identity`);
    const owned = { ...page, page_id: created.page_id, revision_id: created.revision_id };
    const token = this.#resources.register("page", { site_id: this.#siteId, page_id: owned.page_id, slug: owned.slug, owner: `candidate-case:${this.#prefix}` });
    this.#pages.set(name, { ...owned, token });
    const observed = await this.#getPage(name, { actor: "anonymous" });
    if (!observed) throw new Error(`created NextPreviousPage page is not publicly readable: ${page.slug}`);
    requirePage(observed, owned, `created ${name}`);
  }

  async #view() {
    const holder = this.#page(PAGE_NAMES.holder);
    const value = await this.#rpc("page_view", {
      site_id: this.#siteId,
      session_token: null,
      route: { slug: holder.slug, extra: "" },
      locales: ["en-US", "en"],
    }, { actor: "anonymous", page: holder.slug });
    const html = foundHtml(value);
    const previous = section(html, "PREVIOUS_START", "PREVIOUS_END");
    const inline = section(html, "INLINE_START", "INLINE_END");
    const selected = [...this.#pages.entries()].find(([, page]) => previous.includes(`href="/${page.slug}"`))?.[0] ?? null;
    const page = selected === null ? null : this.#page(selected);
    return {
      previous,
      previous_sha256: sha256Value(previous),
      inline,
      inline_sha256: sha256Value(inline),
      selected,
      selected_slug: page?.slug ?? null,
      row: page === null ? null : defaultRowEvidence(previous, page, this.#session.editorUserId),
      page_view: true,
    };
  }

  async #savedBodyHash() {
    const holder = await this.#getPage(PAGE_NAMES.holder, { actor: "anonymous", compiled: true });
    if (typeof holder?.compiled_body_html !== "string") throw new Error("holder saved compiled body is unavailable at the public seam");
    return sha256Value(holder.compiled_body_html);
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id)) throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    this.#siteId = site.site_id;
    await this.#createPage(PAGE_NAMES.older);
    await this.#createPage(PAGE_NAMES.holder);
    await this.#createPage(PAGE_NAMES.newer);

    const savedBefore = await this.#savedBodyHash();
    const initial = await this.#view();
    const older = this.#page(PAGE_NAMES.older);
    if (initial.selected !== PAGE_NAMES.older || !initial.row?.wrapper || !initial.row.row || !initial.row.title || !initial.row.printuser || !initial.row.date || !initial.row.body || initial.row.compat_markers.length !== 0) throw new Error("public PreviousPage default output did not preserve the exact title/printuser/date/body contract");
    if (initial.inline !== "\nstart-[[module PreviousPage]]-middle\n" || initial.inline.includes("list-pages-box")) throw new Error("inline PreviousPage crossed its public literal boundary");

    const currentOlder = await this.#getPage(PAGE_NAMES.older);
    const renamedTitle = `${older.title} renamed`;
    const edited = await this.#rpc("page_edit", {
      site_id: this.#siteId,
      page: older.slug,
      last_revision_id: currentOlder.revision_id,
      revision_comments: "Open43 Q811 NextPreviousPage rename",
      user_id: this.#session.editorUserId,
      title: renamedTitle,
      ip_address: "127.0.0.1",
    }, { page: older.slug });
    if (!Number.isSafeInteger(edited?.revision_id)) throw new Error("PreviousPage rename did not return a public revision");
    older.title = renamedTitle;
    older.revision_id = edited.revision_id;
    const renamed = await this.#view();
    if (renamed.selected !== PAGE_NAMES.older || !renamed.row?.title || !renamed.previous.includes(renamedTitle)) throw new Error("public PreviousPage did not observe the renamed adjacent page");

    const beforeDelete = await this.#getPage(PAGE_NAMES.older);
    await this.#rpc("page_delete", {
      site_id: this.#siteId,
      page: older.slug,
      last_revision_id: beforeDelete.revision_id,
      revision_comments: "Open43 Q811 NextPreviousPage delete",
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
    }, { page: older.slug });
    const deleted = await this.#view();
    if (deleted.selected !== null || !deleted.previous.includes(LISTPAGES_WRAPPER) || deleted.previous.includes("list-pages-item") || deleted.previous.includes(older.slug)) throw new Error("public PreviousPage did not fail closed to the empty wrapper after deletion");

    await this.#rpc("page_restore", {
      site_id: this.#siteId,
      page_id: older.page_id,
      revision_comments: "Open43 Q811 NextPreviousPage restore",
      user_id: this.#session.editorUserId,
      slug: older.slug,
      ip_address: "127.0.0.1",
    }, { page: older.slug });
    const restoredPage = await this.#getPage(PAGE_NAMES.older);
    if (!restoredPage) throw new Error("PreviousPage restore did not make the adjacent page publicly readable");
    older.revision_id = restoredPage.revision_id;
    const restored = await this.#view();
    const savedAfter = await this.#savedBodyHash();
    if (restored.selected !== PAGE_NAMES.older || !restored.row?.title || !restored.previous.includes(renamedTitle) || restored.row.date !== initial.row.date || savedAfter !== savedBefore) throw new Error("public PreviousPage restore did not preserve the current saved-page identity and date");

    return [{
      case_id: OPEN43_NEXT_PREVIOUS_CASE_IDS[0],
      observations: {
        source_fixture: { path: LIVE_FIXTURE_PATH, sha256: LIVE_FIXTURE_SHA256, case_id: LIVE_CAPTURE.case_id },
        initial,
        renamed,
        deleted,
        restored,
        saved_body_sha256: { before: savedBefore, after: savedAfter },
        adapter_events: this.#session.events,
        event_scope: "adapter-issued-external-requests-only",
      },
    }];
  }

  async cleanup() {
    const pages = [];
    const failures = [];
    for (const [name, page] of [...this.#pages].reverse()) {
      try {
        const current = await this.#getPage(name, { cleanup: true });
        if (current) await this.#rpc("page_delete", {
          site_id: this.#siteId,
          page: page.slug,
          last_revision_id: current.revision_id,
          revision_comments: "Open43 Q811 NextPreviousPage cleanup",
          user_id: this.#session.editorUserId,
          ip_address: "127.0.0.1",
        }, { page: page.slug, cleanup: true });
        if (await this.#getPage(name, { actor: "anonymous", cleanup: true })) throw new Error(`run-owned NextPreviousPage page remains public: ${page.slug}`);
        this.#resources.release(page.token, { page_get: null, slug: page.slug });
        pages.push({ name, slug: page.slug, page_get: null });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "NextPreviousPage public cleanup failed");
    return { pages, event_scope: "adapter-issued-external-requests-only" };
  }
}

function verifyCleanup(proof, resources) {
  if (!proof || !Array.isArray(proof.pages) || proof.pages.length !== Object.keys(PAGE_NAMES).length || proof.pages.some(({ page_get }) => page_get !== null)) throw new Error("NextPreviousPage cleanup did not prove public absence for every run-owned page");
  if (!Array.isArray(resources) || resources.length !== proof.pages.length || resources.some((resource) => resource.released !== true)) throw new Error("NextPreviousPage cleanup did not release every run resource");
  return { public_absence_verified: true, page_count: proof.pages.length, resource_count: resources.length };
}

function verifyCase(caseId, observations, plan) {
  if (caseId !== OPEN43_NEXT_PREVIOUS_CASE_IDS[0]) throw new Error(`unsupported NextPreviousPage case: ${caseId}`);
  const initial = observations.initial;
  if (initial.selected !== PAGE_NAMES.older || initial.row?.wrapper !== true || initial.row.row !== true || initial.row.title !== true || initial.row.printuser !== true || typeof initial.row.date !== "string" || initial.row.body !== true || initial.row.compat_markers.length !== 0) throw new Error("Q811 initial public evidence does not prove the default title/printuser/date/body DOM");
  if (initial.inline !== "\nstart-[[module PreviousPage]]-middle\n") throw new Error("Q811 initial public evidence crossed the inline literal boundary");
  if (observations.renamed.selected !== PAGE_NAMES.older || !observations.renamed.previous.includes(plan.renamed_title) || observations.deleted.selected !== null || observations.deleted.previous.includes("list-pages-item") || observations.restored.selected !== PAGE_NAMES.older || !observations.restored.previous.includes(plan.renamed_title)) throw new Error("Q811 mutation evidence does not bind rename/delete/restore to the next public read");
  if (observations.saved_body_sha256.before !== observations.saved_body_sha256.after) throw new Error("Q811 public GET-side rendering changed the saved holder body");
  if (observations.event_scope !== "adapter-issued-external-requests-only" || !Array.isArray(observations.adapter_events) || observations.adapter_events.filter((event) => event.operation === "page_view" && event.method === "POST" && event.response_status === 200).length < 4) throw new Error("Q811 evidence does not prove public page_view execution");
  return { verified: true, exact_default_template_contract: true, empty_wrapper_contract: true, inline_literal_boundary: true, mutation_next_read: true, saved_body_unchanged: true, public_seam: "deepwell.page_view" };
}

function requireCandidateSite(candidateIdentity) {
  const expectedHost = `${SITE_SLUG}.wikijump.localhost`;
  if (candidateIdentity.candidate.endpoint.host !== expectedHost) throw new Error(`Open43 NextPreviousPage cases require a separately sealed ${expectedHost} candidate`);
}

export function createOpen43NextPreviousCandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  const sourceFiles = Object.freeze([
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/atomic-no-replace.mjs",
    "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-nextprevious-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    LIVE_FIXTURE_PATH,
    SOURCE_FIXTURE_PATH,
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-page-query-nextprevious",
    caseIds: OPEN43_NEXT_PREVIOUS_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      requireCandidateSite(candidateIdentity);
      const prefix = `open43-nextprev-${runId.slice("candidate-run-".length)}`;
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      const pages = Object.fromEntries(Object.values(PAGE_NAMES).map((name) => [name, { slug: pageSlug(prefix, name), title: pageTitle(prefix, name) }]));
      const execution = new Open43NextPreviousRun({ session, resources, prefix });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.open43_nextprevious_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_prefix: prefix,
          holder_source: holderSource(prefix),
          source_fixture: { path: LIVE_FIXTURE_PATH, sha256: LIVE_FIXTURE_SHA256, case_id: LIVE_CAPTURE.case_id },
          source_fixture_test: SOURCE_FIXTURE_PATH,
          page_slugs: pages,
          event_scope: "adapter-issued-external-requests-only",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyCase(caseId, observations, { renamed_title: `${pages.older.title} renamed` }),
        verifyCleanup,
      });
    },
  });
}
