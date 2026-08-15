import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

export const OPEN43_AUTHORING_HISTORY_CASE_IDS = Object.freeze([
  "A1063_EXACT_PUBLIC_SOURCE_CANDIDATE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const INITIAL_SOURCE = "first line\nunchanged line\n";
const EDITED_SOURCE = "first line\nadded line\n";

function pageSlug(runId) {
  return `open43-history-${runId.slice("candidate-case-".length)}`;
}

function requirePage(value, slug) {
  if (!Number.isSafeInteger(value?.page_id) || !Number.isSafeInteger(value.revision_id) || !Number.isSafeInteger(value.revision_number) || value.slug !== slug) {
    throw new Error(`history candidate page ${slug} is missing or malformed`);
  }
  return value;
}

function requireCreatedPage(value, slug) {
  if (!Number.isSafeInteger(value?.page_id) || !Number.isSafeInteger(value.revision_id) || value.slug !== slug) {
    throw new Error(`history candidate page ${slug} was not created`);
  }
  return value;
}

function requireDiff(value) {
  if (!value || !Array.isArray(value.lines) || value.lines.some((line) => !["added", "removed", "unchanged"].includes(line?.kind) || typeof line.text !== "string")) {
    throw new Error("history candidate revision diff is not a typed line list");
  }
  return value;
}

function requireAjax(value, moduleName) {
  if (value?.http_status !== 200 || value.payload?.status !== "ok" || typeof value.payload.body !== "string" || value.payload.body.length === 0) {
    throw new Error(`${moduleName} did not return a successful public response`);
  }
  return {
    http_status: value.http_status,
    status: value.payload.status,
    body_size: value.response_body_size,
    body_sha256: value.response_body_sha256,
  };
}

class Open43AuthoringHistoryRun {
  #session;
  #resources;
  #slug;
  #siteId = null;
  #page = null;
  #pageResource = null;

  constructor({ session, resources, slug }) {
    this.#session = session;
    this.#resources = resources;
    this.#slug = slug;
  }

  async #rpc(method, params = {}, { actor = "editor", cleanup = false } = {}) {
    return await this.#session.rpc(method, params, {
      actor,
      siteId: this.#siteId ?? undefined,
      page: this.#slug,
      cleanup,
    });
  }

  async #pageRead({ cleanup = false } = {}) {
    return await this.#rpc("page_get", {
      site_id: this.#siteId,
      page: this.#slug,
      details: { wikitext: true, compiled: false },
    }, { cleanup });
  }

  async #createPage() {
    const page = requireCreatedPage(await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug: this.#slug,
      title: "Open43 history candidate",
      alt_title: null,
      wikitext: INITIAL_SOURCE,
      layout: "wikidot",
      revision_comments: "Open43 history candidate initial revision",
      user_id: this.#session.editorUserId,
      ip_address: "192.0.2.61",
      tags: [],
    }), this.#slug);
    this.#page = page;
    this.#pageResource = this.#resources.register("page", {
      page_id: page.page_id,
      slug: page.slug,
      revision_id: page.revision_id,
    });
    return page;
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) {
      throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    }
    this.#siteId = site.site_id;
    if (await this.#pageRead() !== null) throw new Error(`run-owned history page already exists: ${this.#slug}`);

    const initial = await this.#createPage();
    const before = requirePage(await this.#pageRead(), this.#slug);
    const edited = await this.#rpc("page_edit", {
      site_id: this.#siteId,
      page: initial.page_id,
      last_revision_id: initial.revision_id,
      revision_comments: "Open43 history candidate edited revision",
      user_id: this.#session.editorUserId,
      wikitext: EDITED_SOURCE,
      ip_address: "192.0.2.61",
    });
    const after = requirePage(await this.#pageRead(), this.#slug);
    if (edited !== null && edited !== undefined && !Number.isSafeInteger(edited.revision_id)) throw new Error("page_edit returned an invalid revision identity");

    const diff = requireDiff(await this.#rpc("page_revision_diff", {
      site_id: this.#siteId,
      page_id: after.page_id,
      from_revision_number: before.revision_number,
      to_revision_number: after.revision_number,
    }, { actor: "anonymous" }));
    const ajax = [
      ["history/PageRevisionListModule", {
        moduleName: "history/PageRevisionListModule",
        page_id: String(after.page_id),
        options: "{'all': True}",
        perpage: "100000000",
      }],
      ["history/PageSourceModule", {
        moduleName: "history/PageSourceModule",
        revision_id: String(before.revision_id),
      }],
      ["history/PageVersionModule", {
        moduleName: "history/PageVersionModule",
        revision_id: String(after.revision_id),
      }],
    ];
    const ajaxResponses = [];
    for (const [moduleName, fields] of ajax) {
      const response = await this.#session.ajaxModuleRequest(fields, {
        actor: "anonymous",
        page: this.#slug,
      });
      ajaxResponses.push({ module_name: moduleName, ...requireAjax(response, moduleName) });
    }

    return [{
      case_id: "A1063_EXACT_PUBLIC_SOURCE_CANDIDATE",
      observations: {
        page: {
          page_id: after.page_id,
          initial_revision_id: before.revision_id,
          edited_revision_id: after.revision_id,
        },
        diff: {
          site_id: diff.site_id,
          page_id: diff.page_id,
          from_revision_number: diff.from_revision_number,
          to_revision_number: diff.to_revision_number,
          lines: diff.lines,
        },
        ajax: ajaxResponses,
      },
    }];
  }

  async cleanup() {
    if (this.#page === null) return { page_get: null, absent_pages: [] };
    const failures = [];
    try {
      const current = await this.#pageRead({ cleanup: true });
      if (current !== null) {
        await this.#rpc("page_delete", {
          site_id: this.#siteId,
          page: current.page_id,
          last_revision_id: current.revision_id,
          revision_comments: "Open43 history candidate cleanup",
          user_id: this.#session.editorUserId,
          ip_address: "192.0.2.61",
        }, { cleanup: true });
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      if (await this.#pageRead({ cleanup: true }) !== null) throw new Error(`cleanup left ${this.#slug} publicly present`);
      this.#resources.release(this.#pageResource, { page_get: null });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "history candidate cleanup failed");
    return { page_get: null, absent_pages: [this.#slug] };
  }
}

function verifyCase(caseId, observations) {
  if (caseId !== "A1063_EXACT_PUBLIC_SOURCE_CANDIDATE") throw new Error(`unsupported Open43 history case: ${caseId}`);
  const page = observations.page;
  const diff = observations.diff;
  if (!Number.isSafeInteger(page?.page_id) || page.initial_revision_id === page.edited_revision_id || diff.page_id !== page.page_id || diff.from_revision_number >= diff.to_revision_number) throw new Error("history candidate revision identities are not bound to one edited page");
  const kinds = new Set(diff.lines.map((line) => line.kind));
  if (!kinds.has("added") || !kinds.has("removed") || !kinds.has("unchanged")) throw new Error("history candidate diff did not expose all typed line kinds");
  if (diff.lines.some((line) => Object.hasOwn(line, "wikitext") || Object.hasOwn(line, "compiled_body_html"))) throw new Error("history candidate diff exposed a raw source field");
  if (!Array.isArray(observations.ajax) || observations.ajax.length !== 3 || observations.ajax.some((response) => response.http_status !== 200 || response.status !== "ok" || !/^[0-9a-f]{64}$/u.test(response.body_sha256))) throw new Error("history candidate AMC responses are incomplete");
  return {
    verified: true,
    typed_diff_kinds: [...kinds].sort(),
    diff_lines_sha256: sha256Value(diff.lines),
    exact_ajax_modules: observations.ajax.map((response) => response.module_name),
  };
}

function verifyCleanup(proof, resources) {
  if (proof?.page_get !== null || proof.absent_pages?.length !== 1 || resources.some((resource) => resource.released !== true)) throw new Error("history candidate cleanup did not prove public absence");
  return { public_absence_verified: true, page_count: proof.absent_pages.length };
}

export function createOpen43AuthoringHistoryCandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  const sourceFiles = Object.freeze([
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-authoring-history-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-authoring-history",
    caseIds: OPEN43_AUTHORING_HISTORY_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      if (candidateIdentity.candidate.endpoint.host !== SITE_HOST) throw new Error(`Open43 history cases require ${SITE_HOST}`);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      if (session?.editorUserId !== -1) throw new Error("history candidate session must bind the fixed editor actor");
      const execution = new Open43AuthoringHistoryRun({ session, resources, slug: pageSlug(runId) });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.open43_authoring_history_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_slug: pageSlug(runId),
          editor_user_id: -1,
          public_behavior: "one public page revision pair yields typed diff lines and the exact legacy History AMC envelopes",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase,
        verifyCleanup,
      });
    },
  });
}
