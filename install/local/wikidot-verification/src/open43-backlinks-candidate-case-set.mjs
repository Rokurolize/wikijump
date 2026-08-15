import { CandidateHttpSession } from "./candidate-case-http.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  sha256Text,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_BACKLINKS_CASE_IDS = Object.freeze([
  "Q1027_BACKLINKS_PREVIEW_SAVED_FAIL_CLOSED",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const MUTATING_OPERATIONS = new Set([
  "page_create",
  "page_edit",
  "page_delete",
  "page_restore",
  "page_move",
]);

function safeId(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

function pageIdentity(value, name) {
  const page = requirePlainObject(value, name);
  return Object.freeze({
    page_id: safeId(page.page_id, `${name}.page_id`),
    slug: requireNonEmptyString(page.slug, `${name}.slug`),
    title: requireNonEmptyString(page.title, `${name}.title`),
  });
}

function pageRows(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must contain at least one page`);
  return Object.freeze(value.map((row, index) => pageIdentity(row, `${name}[${index}]`)));
}

function sourcePage(value, name) {
  const page = pageIdentity(value, name);
  const source = requireNonEmptyString(value.source, `${name}.source`);
  if (!/(?:^|\n)\[\[module Backlinks\]\](?:\n|$)/u.test(source)) throw new Error(`${name}.source must contain an own-line Backlinks module`);
  return Object.freeze({ ...page, source });
}

function expectedFragment(value, name) {
  const fragment = requireNonEmptyString(value, name);
  if (!fragment.includes('<div class="backlinks-module-box">')) throw new Error(`${name} must be a Backlinks wrapper`);
  return fragment;
}

function fixtureIdentity(value) {
  const fixture = requirePlainObject(value?.fixture, "private Backlinks fixture identity");
  if (fixture.site_slug !== SITE_SLUG) throw new Error("private Backlinks fixture must bind the editable site");
  const siteId = safeId(fixture.site_id, "private Backlinks fixture.site_id");
  const holder = sourcePage(fixture.holder, "private Backlinks fixture.holder");
  const emptyHolder = sourcePage(fixture.empty_holder, "private Backlinks fixture.empty_holder");
  const visible = pageRows(fixture.visible, "private Backlinks fixture.visible");
  const hidden = pageRows(fixture.hidden, "private Backlinks fixture.hidden");
  const privatePages = pageRows(fixture.private, "private Backlinks fixture.private");
  const deleted = pageRows(fixture.deleted, "private Backlinks fixture.deleted");
  const foreign = requirePlainObject(fixture.foreign_page, "private Backlinks fixture.foreign_page");
  const foreignPage = Object.freeze({
    ...pageIdentity(foreign, "private Backlinks fixture.foreign_page"),
    site_id: safeId(foreign.site_id, "private Backlinks fixture.foreign_page.site_id"),
    site_slug: requireNonEmptyString(foreign.site_slug, "private Backlinks fixture.foreign_page.site_slug"),
  });
  if (foreignPage.site_id === siteId || foreignPage.site_slug === SITE_SLUG) throw new Error("foreign Backlinks fixture must belong to another site");
  const staleSlug = requireNonEmptyString(fixture.stale_page_slug, "private Backlinks fixture.stale_page_slug");
  const expected = Object.freeze({
    populated: expectedFragment(fixture.expected?.populated, "private Backlinks fixture.expected.populated"),
    empty: expectedFragment(fixture.expected?.empty, "private Backlinks fixture.expected.empty"),
  });
  return Object.freeze({
    site_id: siteId,
    site_slug: fixture.site_slug,
    holder,
    empty_holder: emptyHolder,
    visible,
    hidden,
    private: privatePages,
    deleted,
    foreign_page: foreignPage,
    stale_page_slug: staleSlug,
    expected,
  });
}

function pageDigest(page) {
  return {
    page_id: page?.page_id ?? null,
    revision_id: page?.revision_id ?? null,
    slug: page?.slug ?? null,
    tags: page?.tags ?? null,
    wikitext_sha256: typeof page?.wikitext === "string" ? sha256Text(page.wikitext) : null,
  };
}

function assertPage(value, expected, name, source = null) {
  if (value?.page_id !== expected.page_id || value.slug !== expected.slug || value.title !== expected.title || (source !== null && value.wikitext !== source)) {
    throw new Error(`${name} public identity does not match the private fixture`);
  }
  return pageDigest(value);
}

function foundPageView(value, name) {
  if (value?.type !== "found" || !requirePlainObject(value.data, `${name}.data`) || typeof value.data.compiled_body_html !== "string") {
    throw new Error(`${name} did not return a found page with compiled HTML`);
  }
  return value.data;
}

function exactFragment(body, expected, name) {
  const occurrences = body.split(expected).length - 1;
  if (occurrences !== 1) throw new Error(`${name} did not contain its exact Backlinks DOM fragment once`);
  return { body_sha256: sha256Text(body), fragment_sha256: sha256Text(expected), fragment_length: expected.length };
}

function assertAbsent(body, rows, name) {
  for (const row of rows) {
    if (body.includes(row.slug) || body.includes(row.title)) throw new Error(`${name} leaked ${row.slug}`);
  }
}

function previewObservation(value, expected, name) {
  if (typeof value?.body !== "string") throw new Error(`${name} did not return preview body text`);
  return { ...exactFragment(value.body, expected, name), has_wrapper: true };
}

function negativePreviewObservation(value, rows, name) {
  if (typeof value?.body !== "string") throw new Error(`${name} did not return preview body text`);
  if (value.body.includes('<div class="backlinks-module-box">')) throw new Error(`${name} rendered Backlinks without a valid current-page identity`);
  assertAbsent(value.body, rows, name);
  return { body_sha256: sha256Text(value.body), has_wrapper: false };
}

class Open43BacklinksRun {
  #session;
  #fixture;
  #siteId;
  #before = null;

  constructor({ session, fixture }) {
    this.#session = session;
    this.#fixture = fixture;
    this.#siteId = fixture.site_id;
  }

  async #rpc(method, params = {}, { actor = "anonymous", siteId = this.#siteId, page, cleanup = false } = {}) {
    return await this.#session.rpc(method, params, { actor, siteId, page, cleanup });
  }

  async #page(page, { actor = "editor", siteId = this.#siteId, cleanup = false } = {}) {
    return await this.#rpc("page_get", {
      site_id: siteId,
      page: page.slug,
      details: { compiled_html: false, wikitext: true },
    }, { actor, siteId, page: page.slug, cleanup });
  }

  async #saved(page, { cleanup = false } = {}) {
    const value = await this.#rpc("page_view", {
      site_id: this.#siteId,
      session_token: null,
      route: { slug: page.slug, extra: "" },
      locales: ["en-US", "en"],
    }, { actor: "anonymous", siteId: this.#siteId, page: page.slug, cleanup });
    return foundPageView(value, `saved ${page.slug}`);
  }

  async #preview(page, { cleanup = false, pageHeader = page?.slug } = {}) {
    const request = {
      actor: "anonymous",
      siteId: this.#siteId,
      cleanup,
    };
    if (pageHeader !== null && pageHeader !== undefined) request.page = pageHeader;
    return await this.#rpc("wikidot_page_preview", {
      site_id: this.#siteId,
      title: page?.title ?? "Backlinks identity negative control",
      wikitext: page?.source ?? this.#fixture.holder.source,
    }, request);
  }

  async #snapshot({ cleanup = false } = {}) {
    const pages = [this.#fixture.holder, this.#fixture.empty_holder, ...this.#fixture.visible, ...this.#fixture.hidden, ...this.#fixture.private];
    const rows = [];
    for (const page of pages) rows.push(assertPage(await this.#page(page, { cleanup }), page, `snapshot ${page.slug}`, page.source ?? null));
    const deletedPageIds = [];
    for (const expected of this.#fixture.deleted) {
      const deleted = await this.#rpc("page_get_deleted", { site_id: this.#siteId, slug: expected.slug }, { actor: "editor", siteId: this.#siteId, cleanup });
      if (!Array.isArray(deleted) || !deleted.some((page) => page.page_id === expected.page_id && page.slug === expected.slug)) throw new Error(`deleted Backlinks fixture ${expected.slug} is not publicly verifiable`);
      deletedPageIds.push(expected.page_id);
    }
    return { pages: rows, deleted_page_ids: deletedPageIds.sort((left, right) => left - right) };
  }

  async #preflight() {
    const site = await this.#rpc("site_get", { site: SITE_SLUG }, { actor: "editor", siteId: undefined });
    if (site?.site_id !== this.#siteId || site.slug !== SITE_SLUG) throw new Error("Backlinks candidate site identity does not match its fixture");
    assertPage(await this.#page(this.#fixture.holder), this.#fixture.holder, "Backlinks holder", this.#fixture.holder.source);
    assertPage(await this.#page(this.#fixture.empty_holder), this.#fixture.empty_holder, "empty Backlinks holder", this.#fixture.empty_holder.source);
    for (const group of ["visible", "hidden", "private"]) {
      for (const page of this.#fixture[group]) {
        const observed = await this.#page(page);
        assertPage(observed, page, `${group} ${page.slug}`);
        const canView = await this.#rpc("page_view_permission", { site_id: this.#siteId, page: page.slug }, { actor: "anonymous" });
        if (group === "visible" && canView !== true) throw new Error(`visible Backlinks row ${page.slug} is not anonymously viewable`);
        if (group === "private" && canView !== false) throw new Error(`private Backlinks row ${page.slug} is anonymously viewable`);
        if (group === "hidden" && (!Array.isArray(observed.hidden_fields) || !observed.hidden_fields.some((field) => field === "title" || field === "slug"))) throw new Error(`hidden Backlinks row ${page.slug} does not hide title or slug`);
      }
    }
    if (await this.#page({ slug: this.#fixture.stale_page_slug }) !== null) throw new Error("stale Backlinks preview identity unexpectedly resolves");
    const foreign = await this.#page(this.#fixture.foreign_page, { siteId: this.#fixture.foreign_page.site_id });
    assertPage(foreign, this.#fixture.foreign_page, "foreign Backlinks page");
    if (await this.#page(this.#fixture.foreign_page) !== null) throw new Error("foreign Backlinks slug collides in the current site");
    for (const expected of this.#fixture.deleted) {
      const deleted = await this.#rpc("page_get_deleted", { site_id: this.#siteId, slug: expected.slug }, { actor: "editor" });
      if (!Array.isArray(deleted) || !deleted.some((page) => page.page_id === expected.page_id && page.slug === expected.slug)) throw new Error(`deleted Backlinks fixture ${expected.slug} is missing`);
      const canView = await this.#rpc("page_view_permission", { site_id: this.#siteId, page: expected.slug }, { actor: "anonymous" });
      if (canView !== false) throw new Error(`deleted Backlinks row ${expected.slug} is anonymously viewable`);
    }
  }

  async execute() {
    await this.#preflight();
    this.#before = await this.#snapshot();
    const populatedSaved = await this.#saved(this.#fixture.holder);
    const emptySaved = await this.#saved(this.#fixture.empty_holder);
    const populatedPreview = await this.#preview(this.#fixture.holder);
    const emptyPreview = await this.#preview(this.#fixture.empty_holder);
    const noIdentity = await this.#preview(this.#fixture.holder, { pageHeader: null });
    const staleIdentity = await this.#preview(this.#fixture.holder, { pageHeader: this.#fixture.stale_page_slug });
    const foreignIdentity = await this.#preview(this.#fixture.holder, { pageHeader: this.#fixture.foreign_page.slug });
    const after = await this.#snapshot();
    const rows = [...this.#fixture.hidden, ...this.#fixture.private, ...this.#fixture.deleted];
    assertAbsent(populatedSaved.compiled_body_html, rows, "saved populated Backlinks");
    assertAbsent(populatedPreview.body, rows, "preview populated Backlinks");
    return [{
      case_id: "Q1027_BACKLINKS_PREVIEW_SAVED_FAIL_CLOSED",
      observations: {
        actor: { editor_user_id: this.#session.editorUserId, rendered_viewer: "anonymous" },
        fixture: {
          site_id: this.#siteId,
          site_slug: SITE_SLUG,
          holder_page_id: this.#fixture.holder.page_id,
          empty_holder_page_id: this.#fixture.empty_holder.page_id,
          source_sha256: sha256Text(this.#fixture.holder.source),
          empty_source_sha256: sha256Text(this.#fixture.empty_holder.source),
          expected_populated_dom_sha256: sha256Text(this.#fixture.expected.populated),
          expected_empty_dom_sha256: sha256Text(this.#fixture.expected.empty),
        },
        saved: {
          populated: { page_id: populatedSaved.page.page_id, revision_id: populatedSaved.page_revision.revision_id, ...exactFragment(populatedSaved.compiled_body_html, this.#fixture.expected.populated, "saved populated Backlinks") },
          empty: { page_id: emptySaved.page.page_id, revision_id: emptySaved.page_revision.revision_id, ...exactFragment(emptySaved.compiled_body_html, this.#fixture.expected.empty, "saved empty Backlinks") },
        },
        preview: {
          populated: previewObservation(populatedPreview, this.#fixture.expected.populated, "preview populated Backlinks"),
          empty: previewObservation(emptyPreview, this.#fixture.expected.empty, "preview empty Backlinks"),
        },
        identity_negative: {
          no_identity: negativePreviewObservation(noIdentity, rows, "identity-free preview"),
          stale: negativePreviewObservation(staleIdentity, rows, "stale-identity preview"),
          foreign: negativePreviewObservation(foreignIdentity, rows, "foreign-identity preview"),
        },
        state_before_sha256: sha256Value(this.#before),
        state_after_sha256: sha256Value(after),
        request_events: this.#session.events,
      },
    }];
  }

  async cleanup() {
    const state = await this.#snapshot({ cleanup: true });
    return {
      public_absence_verified: true,
      mutation_count: 0,
      state_sha256: sha256Value(state),
      request_events: this.#session.events,
    };
  }
}

function verifyCleanup(proof, resources) {
  if (proof?.public_absence_verified !== true || proof.mutation_count !== 0 || !Array.isArray(resources) || resources.length !== 0 || !Array.isArray(proof.request_events) || proof.request_events.some((event) => MUTATING_OPERATIONS.has(event.operation))) throw new Error("Backlinks candidate cleanup did not prove a no-mutation run");
  return { public_absence_verified: true, mutation_count: 0, resource_count: 0 };
}

function verifyCase(observations, fixture) {
  if (observations.fixture?.source_sha256 !== sha256Text(fixture.holder.source) || observations.fixture.empty_source_sha256 !== sha256Text(fixture.empty_holder.source) || observations.fixture.expected_populated_dom_sha256 !== sha256Text(fixture.expected.populated) || observations.fixture.expected_empty_dom_sha256 !== sha256Text(fixture.expected.empty)) throw new Error("Backlinks candidate fixture identity drifted");
  for (const side of [observations.saved.populated, observations.saved.empty, observations.preview.populated, observations.preview.empty]) if (side.fragment_sha256 !== sha256Text(side === observations.saved.empty || side === observations.preview.empty ? fixture.expected.empty : fixture.expected.populated)) throw new Error("saved or preview Backlinks DOM digest does not match its exact fixture fragment");
  for (const negative of Object.values(observations.identity_negative)) if (negative.has_wrapper !== false) throw new Error("invalid preview page identity rendered a Backlinks wrapper");
  if (observations.state_before_sha256 !== observations.state_after_sha256) throw new Error("Backlinks candidate changed public fixture state");
  const events = [...observations.request_events];
  if (events.some((event) => MUTATING_OPERATIONS.has(event.operation))) throw new Error("Backlinks candidate issued a mutating public operation");
  return { verified: true, controls: ["saved_populated", "saved_empty", "preview_populated", "preview_empty", "identity_free", "stale_identity", "foreign_identity"], hidden_private_deleted_fail_closed: true, mutation_count: 0 };
}

export function createOpen43BacklinksCandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  const sourceFiles = Object.freeze([
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/atomic-no-replace.mjs",
    "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-backlinks-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-backlinks",
    caseIds: OPEN43_BACKLINKS_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, signal }) {
      if (candidateIdentity.candidate.endpoint.host !== `${SITE_SLUG}.wikijump.localhost`) throw new Error(`Open43 Backlinks cases require a sealed ${SITE_SLUG}.wikijump.localhost candidate`);
      const fixture = fixtureIdentity(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      const execution = new Open43BacklinksRun({ session, fixture });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: { ...session.privateInputIdentity, fixture_identity_sha256: sha256Value(fixture) },
        plan: {
          schema: "wikijump.open43_backlinks_candidate_plan.v1",
          site: { site_id: fixture.site_id, site_slug: fixture.site_slug },
          fixture_identity_sha256: sha256Value(fixture),
          fixture: {
            holder_page_id: fixture.holder.page_id,
            empty_holder_page_id: fixture.empty_holder.page_id,
            visible_page_ids: fixture.visible.map((page) => page.page_id),
            hidden_page_ids: fixture.hidden.map((page) => page.page_id),
            private_page_ids: fixture.private.map((page) => page.page_id),
            deleted_page_ids: fixture.deleted.map((page) => page.page_id),
            foreign_page_id: fixture.foreign_page.page_id,
            source_sha256: sha256Text(fixture.holder.source),
            empty_source_sha256: sha256Text(fixture.empty_holder.source),
            expected_populated_dom_sha256: sha256Text(fixture.expected.populated),
            expected_empty_dom_sha256: sha256Text(fixture.expected.empty),
          },
          actor: { editor_user_id: session.editorUserId, rendered_viewer: "anonymous" },
          mutation_policy: "read-only-public-seams",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (_caseId, observations) => verifyCase(observations, fixture),
        verifyCleanup,
      });
    },
  });
}
