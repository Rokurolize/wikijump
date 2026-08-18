import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

export const OPEN43_PAGE_TREE_CASE_IDS = Object.freeze([
  "Q779_EXPLICIT_ROOT_ACTOR_AND_LIFECYCLE_CANDIDATE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const LIVE_FIXTURE_PATH = "install/local/wikidot-verification/artifacts/navigation-list-modules-live.json";
const SOURCE_FIXTURE_PATH = "deepwell/tests/page.rs";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const LIVE_FIXTURE = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, LIVE_FIXTURE_PATH), "utf8"));
const LIVE_PAGE_TREE_CASE = LIVE_FIXTURE.cases.find(({ case_id }) => case_id === "pagetree-depth-and-showroot");
if (!LIVE_PAGE_TREE_CASE) throw new Error("source-owned PageTree live fixture is missing its depth case");

const PAGE_NAMES = Object.freeze({ root: "root", alpha: "alpha", beta: "beta" });
const MODULE_SOURCE = [
  "PT_SHOW_START",
  '[[module PageTree showRoot="true" depth="1"]]',
  "PT_SHOW_END",
  "PT_INLINE_START",
  "start-[[module PageTree]]-middle",
  "PT_INLINE_END",
  "PT_LIFECYCLE_START",
  '[[module PageTree showRoot="true" depth="2"]]',
  "PT_LIFECYCLE_END",
].join("\n");

function pageSlug(prefix, name) {
  return `${prefix}-pagetree-${name}`;
}

function pageTitle(prefix, name) {
  return {
    root: `ABA ${prefix} PageTree root`,
    alpha: `ABB ${prefix} Alpha child`,
    beta: `ABC ${prefix} Beta child`,
  }[name];
}

function expectedPageTree(pages, childSlugs) {
  const rows = childSlugs.map((slug) => {
    const name = Object.entries(pages).find(([, value]) => value.slug === slug)?.[0];
    return `\t\t\t\t\t\t\t<li>\n\t\t\t\t\t<a href="/${slug}">${pages[name].title}</a>\n\t\t\t\t\t\t\t</li>`;
  }).join("\n");
  return `\n  \n\n\n\t<ul>\n\t\t<li>\n\t\t\t<a href="/${pages.root.slug}">${pages.root.title}</a>\n\t\t\t  \n\t\t\t\t<ul>\n${rows}\n\t\t\t\t\t</ul>\n\t\t\t</li>\n\t\t</ul>\n  \n`;
}

function fixturePrefix(prefix) {
  const marker = "PT_SHOW_START</p>";
  const snippet = LIVE_PAGE_TREE_CASE.html_snippet;
  return snippet.slice(snippet.indexOf(marker) + marker.length).replaceAll(LIVE_FIXTURE.fixture.primary_prefix, prefix);
}

function between(html, start, end) {
  const begin = html.indexOf(start);
  if (begin < 0) throw new Error(`PageTree output is missing ${start}`);
  let contentStart = begin + start.length;
  for (const boundary of ["</p>", "<br>\n", "<br>"]) {
    if (html.startsWith(boundary, contentStart)) {
      contentStart += boundary.length;
      break;
    }
  }
  const endStart = html.indexOf(end, contentStart);
  if (endStart < 0) throw new Error(`PageTree output is missing ${end}`);
  let contentEnd = endStart;
  if (html.slice(contentStart, contentEnd).endsWith("<p>")) contentEnd -= 3;
  return html.slice(contentStart, contentEnd);
}

function foundHtml(value) {
  if (value?.type !== "found" || typeof value.data?.compiled_body_html !== "string") throw new Error("page_view did not return a found compiled body at the public seam");
  return value.data.compiled_body_html;
}

function assertPage(value, expected, name) {
  if (value?.page_id !== expected.page_id || value.slug !== expected.slug || value.title !== expected.title || value.wikitext !== expected.wikitext) throw new Error(`${name} did not preserve the run-owned public page identity`);
}

function pageCreateParams(siteId, page, userId) {
  return {
    site_id: siteId,
    wikitext: page.wikitext,
    title: page.title,
    alt_title: null,
    slug: page.slug,
    layout: "wikidot",
    revision_comments: "Open43 Q779 PageTree candidate fixture",
    user_id: userId,
    ip_address: "127.0.0.1",
    tags: [],
  };
}

class Open43PageTreeRun {
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
      page: page ?? this.#pages.get("root")?.slug,
      cleanup,
    });
  }

  async #getPage(name, { cleanup = false, pageOverride = null } = {}) {
    const page = this.#page(name) ?? pageOverride;
    if (!page || this.#siteId === null) return null;
    return await this.#rpc("page_get", {
      site_id: this.#siteId,
      page: page.slug,
      details: { wikitext: true, compiled: false },
    }, { cleanup, page: page.slug });
  }

  async #createPage(name) {
    const page = {
      slug: pageSlug(this.#prefix, name),
      title: pageTitle(this.#prefix, name),
      wikitext: name === PAGE_NAMES.root ? MODULE_SOURCE : `Open43 Q779 ${name} child`,
    };
    if (await this.#getPage(name, { pageOverride: page })) throw new Error(`run-owned PageTree page already exists: ${page.slug}`);
    let created;
    try {
      created = await this.#rpc("page_create", pageCreateParams(this.#siteId, page, this.#session.editorUserId), { page: page.slug });
    } catch (error) {
      const recovered = await this.#getPage(name, { cleanup: true, pageOverride: page });
      if (recovered) {
        assertPage(recovered, { ...page, page_id: recovered.page_id }, `recovered ${name}`);
        const token = this.#resources.register("page", { site_id: this.#siteId, page_id: recovered.page_id, slug: page.slug, title: page.title, owner: `candidate-case:${this.#prefix}` });
        this.#pages.set(name, { ...page, page_id: recovered.page_id, revision_id: recovered.revision_id, token });
      }
      throw error;
    }
    if (!Number.isSafeInteger(created?.page_id) || !Number.isSafeInteger(created.revision_id) || created.slug !== page.slug) throw new Error(`page_create did not return the public ${name} identity`);
    const owned = { ...page, page_id: created.page_id, revision_id: created.revision_id };
    const token = this.#resources.register("page", { site_id: this.#siteId, page_id: owned.page_id, slug: owned.slug, title: owned.title, owner: `candidate-case:${this.#prefix}` });
    this.#pages.set(name, { ...owned, token });
    const observed = await this.#getPage(name);
    if (!observed) throw new Error(`created PageTree page is not publicly readable: ${page.slug}`);
    assertPage(observed, owned, `created ${name}`);
  }

  async #setParent(parent, child) {
    await this.#rpc("parent_set", { site_id: this.#siteId, parent: this.#page(parent).slug, child: this.#page(child).slug }, { page: this.#page(child).slug });
  }

  async #removeParent(parent, child) {
    await this.#rpc("parent_remove", { site_id: this.#siteId, parent: this.#page(parent).slug, child: this.#page(child).slug }, { page: this.#page(child).slug });
  }

  async #view(actor) {
    const root = this.#page(PAGE_NAMES.root);
    const value = await this.#rpc("page_view", {
      site_id: this.#siteId,
      session_token: null,
      route: { slug: root.slug, extra: "" },
      locales: ["en-US", "en"],
    }, { actor, page: root.slug });
    const html = foundHtml(value);
    const exact = between(html, "PT_SHOW_START", "PT_SHOW_END");
    const negative = between(html, "PT_INLINE_START", "PT_INLINE_END");
    return {
      actor,
      exact_output: exact,
      exact_output_sha256: sha256Value(exact),
      negative_boundary: negative,
      negative_boundary_sha256: sha256Value(negative),
      lifecycle_output: html,
    };
  }

  #assertInitial(view, pages) {
    const expected = expectedPageTree(pages, [pages.alpha.slug, pages.beta.slug]);
    if (!expected.startsWith(fixturePrefix(this.#prefix))) throw new Error("PageTree expected output no longer matches the source-owned live fixture indentation");
    if (view.exact_output !== expected) throw new Error("PageTree public module output differs from the exact source-owned candidate output");
    if ((view.negative_boundary.match(/start-\[\[module PageTree\]\]-middle/gu) ?? []).length !== 1 || view.negative_boundary.includes("<ul>")) throw new Error("inline PageTree syntax crossed its negative boundary");
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id)) throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    this.#siteId = site.site_id;
    await this.#createPage(PAGE_NAMES.root);
    await this.#createPage(PAGE_NAMES.alpha);
    await this.#createPage(PAGE_NAMES.beta);
    await this.#setParent(PAGE_NAMES.root, PAGE_NAMES.alpha);
    await this.#setParent(PAGE_NAMES.root, PAGE_NAMES.beta);

    const pages = Object.fromEntries([...this.#pages].map(([name, page]) => [name, page]));
    const anonymous = await this.#view("anonymous");
    this.#assertInitial(anonymous, pages);
    const editor = await this.#view("editor");
    this.#assertInitial(editor, pages);

    const alpha = this.#page(PAGE_NAMES.alpha);
    const alphaCurrent = await this.#getPage(PAGE_NAMES.alpha);
    const renamedTitle = `${alpha.title} renamed`;
    const edited = await this.#rpc("page_edit", {
      site_id: this.#siteId,
      page: alpha.slug,
      last_revision_id: alphaCurrent.revision_id,
      revision_comments: "Open43 Q779 PageTree rename",
      user_id: this.#session.editorUserId,
      title: renamedTitle,
      ip_address: "127.0.0.1",
    }, { page: alpha.slug });
    if (!Number.isSafeInteger(edited?.revision_id)) throw new Error("PageTree rename did not return a public revision");
    alpha.title = renamedTitle;
    alpha.revision_id = edited.revision_id;
    await this.#removeParent(PAGE_NAMES.root, PAGE_NAMES.beta);
    await this.#setParent(PAGE_NAMES.alpha, PAGE_NAMES.beta);
    const afterMove = await this.#view("anonymous");
    if (!afterMove.lifecycle_output.includes(alpha.title) || !afterMove.lifecycle_output.includes(this.#page(PAGE_NAMES.beta).slug)) throw new Error("PageTree next read did not observe the public rename and parent move");

    const beta = this.#page(PAGE_NAMES.beta);
    const betaCurrent = await this.#getPage(PAGE_NAMES.beta);
    await this.#rpc("page_delete", {
      site_id: this.#siteId,
      page: beta.slug,
      last_revision_id: betaCurrent.revision_id,
      revision_comments: "Open43 Q779 PageTree delete",
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
    }, { page: beta.slug });
    const afterDelete = await this.#view("anonymous");
    if (afterDelete.lifecycle_output.includes(beta.slug)) throw new Error("PageTree next read exposed a deleted child");

    await this.#rpc("page_restore", {
      site_id: this.#siteId,
      page_id: beta.page_id,
      revision_comments: "Open43 Q779 PageTree restore",
      user_id: this.#session.editorUserId,
      slug: beta.slug,
      ip_address: "127.0.0.1",
    }, { page: beta.slug });
    const restored = await this.#getPage(PAGE_NAMES.beta);
    if (!restored) throw new Error("PageTree restore did not make the child publicly readable");
    beta.revision_id = restored.revision_id;
    await this.#setParent(PAGE_NAMES.alpha, PAGE_NAMES.beta);
    const afterRestore = await this.#view("editor");
    if (!afterRestore.lifecycle_output.includes(beta.slug) || !afterRestore.lifecycle_output.includes(alpha.title)) throw new Error("PageTree next read did not observe the restored child");

    return [{
      case_id: OPEN43_PAGE_TREE_CASE_IDS[0],
      observations: {
        source_fixture: { path: LIVE_FIXTURE_PATH, case_id: LIVE_PAGE_TREE_CASE.case_id },
        module_source: MODULE_SOURCE,
        initial_anonymous: anonymous,
        initial_editor: editor,
        after_move: afterMove,
        after_delete: afterDelete,
        after_restore: afterRestore,
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
        if (current) {
          await this.#rpc("page_delete", {
            site_id: this.#siteId,
            page: page.slug,
            last_revision_id: current.revision_id,
            revision_comments: "Open43 Q779 PageTree cleanup",
            user_id: this.#session.editorUserId,
            ip_address: "127.0.0.1",
          }, { page: page.slug, cleanup: true });
        }
        const absent = await this.#getPage(name, { cleanup: true });
        if (absent) throw new Error(`run-owned PageTree page remains public: ${page.slug}`);
        this.#resources.release(page.token, { page_get: null, slug: page.slug });
        pages.push({ name, slug: page.slug, page_get: null });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "PageTree public cleanup failed");
    return { pages, event_scope: "adapter-issued-external-requests-only" };
  }
}

function verifyCleanup(proof, resources) {
  if (!proof || !Array.isArray(proof.pages) || proof.pages.length !== Object.keys(PAGE_NAMES).length || proof.pages.some(({ page_get }) => page_get !== null)) throw new Error("PageTree cleanup did not prove public absence for every run-owned page");
  if (!Array.isArray(resources) || resources.length !== proof.pages.length || resources.some((resource) => resource.released !== true)) throw new Error("PageTree cleanup did not release every run resource");
  return { public_absence_verified: true, page_count: proof.pages.length, resource_count: resources.length };
}

function verifyCase(caseId, observations, plan) {
  if (caseId !== OPEN43_PAGE_TREE_CASE_IDS[0]) throw new Error(`unsupported PageTree case: ${caseId}`);
  for (const actor of ["anonymous", "editor"]) {
    const view = observations[`initial_${actor}`];
    if (view?.actor !== actor || view.exact_output !== plan.expected_initial_output || (view.negative_boundary.match(/start-\[\[module PageTree\]\]-middle/gu) ?? []).length !== 1 || view.negative_boundary.includes("<ul>")) throw new Error(`Q779 initial ${actor} evidence is not exact or crossed the negative boundary`);
  }
  const events = observations.adapter_events;
  if (observations.event_scope !== "adapter-issued-external-requests-only" || !Array.isArray(events) || events.filter((event) => event.operation === "page_view" && event.method === "POST" && event.response_status === 200).length < 4) throw new Error("Q779 evidence does not prove public page_view execution");
  if (!observations.after_move.lifecycle_output.includes(plan.beta_slug) || !observations.after_move.lifecycle_output.includes(plan.alpha_renamed_title) || !observations.after_restore.lifecycle_output.includes(plan.beta_slug) || !observations.after_restore.lifecycle_output.includes(plan.alpha_renamed_title) || observations.after_delete.lifecycle_output.includes(plan.beta_slug)) throw new Error("Q779 lifecycle evidence does not bind move, delete, restore, and the renamed parent to the next public read");
  return { verified: true, exact_public_module_output: true, negative_inline_boundary: true, actors: ["anonymous", "editor"], lifecycle_next_read: true, public_seam: "deepwell.page_view" };
}

function requireCandidateSite(candidateIdentity) {
  const expectedHost = `${SITE_SLUG}.wikijump.localhost`;
  if (candidateIdentity.candidate.endpoint.host !== expectedHost) throw new Error(`Open43 PageTree cases require a separately sealed ${expectedHost} candidate`);
}

export function createOpen43PageTreeCandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  const sourceFiles = Object.freeze([
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/atomic-no-replace.mjs",
    "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-page-tree-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    LIVE_FIXTURE_PATH,
    SOURCE_FIXTURE_PATH,
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-page-tree",
    caseIds: OPEN43_PAGE_TREE_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      requireCandidateSite(candidateIdentity);
      const suffix = runId.slice("candidate-run-".length);
      const prefix = `open43-pagetree-${suffix}`;
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      const pages = Object.fromEntries(Object.values(PAGE_NAMES).map((name) => [name, { slug: pageSlug(prefix, name), title: pageTitle(prefix, name) }]));
      const expectedInitialOutput = expectedPageTree(pages, [pages.alpha.slug, pages.beta.slug]);
      if (!expectedInitialOutput.startsWith(fixturePrefix(prefix))) throw new Error("source-owned PageTree fixture no longer matches the candidate expected output");
      const execution = new Open43PageTreeRun({ session, resources, prefix });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.open43_page_tree_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_prefix: prefix,
          module_source: MODULE_SOURCE,
          source_fixture: { path: LIVE_FIXTURE_PATH, case_id: LIVE_PAGE_TREE_CASE.case_id },
          source_fixture_test: SOURCE_FIXTURE_PATH,
          expected_initial_output: expectedInitialOutput,
          alpha_renamed_title: `${pages.alpha.title} renamed`,
          beta_slug: pages.beta.slug,
          event_scope: "adapter-issued-external-requests-only",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyCase(caseId, observations, { expected_initial_output: expectedInitialOutput, alpha_renamed_title: `${pages.alpha.title} renamed`, beta_slug: pages.beta.slug }),
        verifyCleanup,
      });
    },
  });
}
