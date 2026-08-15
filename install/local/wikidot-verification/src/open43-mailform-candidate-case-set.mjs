import { CandidateHttpSession } from "./candidate-case-http.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  sha256Text,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_MAILFORM_CASE_IDS = Object.freeze([
  "A1037_MAILFORM_FAIL_CLOSED_SERVED",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const PAGE_SLUG_PREFIX = "open43-mailform-runtime";
const ACTIVE_MARKERS = Object.freeze([
  '<div class="mailform-box"',
  "<form",
  "<input",
  "<button",
  "javascript:",
  "mailformdef-",
  "MailFormModule.listeners",
]);

function pageSlug(runId) {
  return `${PAGE_SLUG_PREFIX}-${runId.slice("candidate-case-".length)}`;
}

function sourceFor(marker) {
  return [
    `BEFORE ${marker}`,
    '[[module MailForm to="dummy" button="Send"]]',
    "* first-field",
    " * title: First field",
    " * default: harmless",
    " * type: text",
    "* second-field",
    " * title: Second field",
    " * type: textarea",
    "[[/module]]",
    `AFTER ${marker}`,
  ].join("\n");
}

function requireCandidateSite(candidateIdentity) {
  if (candidateIdentity.candidate.endpoint.host !== SITE_HOST) {
    throw new Error(`Open43 MailForm case requires a separately sealed ${SITE_HOST} candidate`);
  }
}

function bodyEvidence(value, name) {
  const body = requireNonEmptyString(value, `${name} body`);
  for (const marker of ["BEFORE", "<em>MailForm</em>", "No such module", "AFTER"]) {
    if (!body.includes(marker)) throw new Error(`${name} is not the retained fail-closed MailForm shape`);
  }
  for (const marker of ACTIVE_MARKERS) {
    if (body.includes(marker)) throw new Error(`${name} exposes active MailForm content ${marker}`);
  }
  return { sha256: sha256Text(body), bytes: Buffer.byteLength(body), fail_closed: true };
}

function requestEvidence(events) {
  if (!Array.isArray(events)) throw new Error("MailForm candidate request evidence is not an array");
  return events.map(({ service, operation, method, response_status }) => ({ service, operation, method, response_status }));
}

class Open43MailformRun {
  #session;
  #resources;
  #pageSlug;
  #marker;
  #source;
  #siteId = null;
  #ownedPage = null;
  #pageResource = null;

  constructor({ session, resources, pageSlug: slug }) {
    this.#session = session;
    this.#resources = resources;
    this.#pageSlug = slug;
    this.#marker = `candidate-case-owner:${slug}`;
    this.#source = sourceFor(this.#marker);
  }

  async #rpc(method, params = {}, { actor = "editor", cleanup = false } = {}) {
    return await this.#session.rpc(method, params, {
      actor,
      siteId: this.#siteId ?? undefined,
      page: this.#pageSlug,
      cleanup,
    });
  }

  async #page({ actor = "anonymous", cleanup = false } = {}) {
    return await this.#rpc(
      "page_get",
      {
        site_id: this.#siteId,
        page: this.#pageSlug,
        details: { wikitext: true, compiled: true },
      },
      { actor, cleanup },
    );
  }

  async execute() {
    const eventStart = this.#session.events.length;
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG }, { actor: "anonymous" });
    if (!Number.isSafeInteger(site?.site_id)) throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    this.#siteId = site.site_id;
    if (await this.#page() !== null) throw new Error("run-owned MailForm page namespace already exists");

    const preview = await this.#rpc("wikidot_page_preview", {
      site_id: this.#siteId,
      title: this.#marker,
      wikitext: this.#source,
    }, { actor: "anonymous" });
    const previewEvidence = bodyEvidence(preview?.body, "MailForm preview");

    const created = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug: this.#pageSlug,
      title: this.#marker,
      alt_title: null,
      wikitext: this.#source,
      layout: "wikidot",
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 MailForm fail-closed candidate",
    });
    if (!Number.isSafeInteger(created?.page_id) || !Number.isSafeInteger(created.revision_id) || created.slug !== this.#pageSlug) {
      throw new Error("page_create did not return a public MailForm page identity");
    }
    this.#ownedPage = {
      page_id: created.page_id,
      revision_id: created.revision_id,
      slug: created.slug,
      title: this.#marker,
      wikitext: this.#source,
    };
    this.#pageResource = this.#resources.register("page", this.#ownedPage);

    const saved = await this.#page();
    if (!this.#matchesOwnedPage(saved)) throw new Error("saved MailForm page does not match its public ownership proof");
    const savedEvidence = bodyEvidence(saved.compiled_body_html, "MailForm saved view");
    return [{
      case_id: "A1037_MAILFORM_FAIL_CLOSED_SERVED",
      observations: {
        preview: previewEvidence,
        saved: { ...savedEvidence, page_id: saved.page_id, revision_id: saved.revision_id },
        adapter_requests: requestEvidence(this.#session.events.slice(eventStart)),
      },
    }];
  }

  async cleanup() {
    const failures = [];
    let pageAfter = null;
    try {
      const page = this.#siteId === null ? null : await this.#page({ actor: "editor", cleanup: true });
      if (this.#matchesOwnedPage(page)) {
        await this.#rpc("page_delete", {
          site_id: this.#siteId,
          page: page.page_id,
          last_revision_id: page.revision_id,
          revision_comments: "Open43 candidate cleanup",
          user_id: this.#session.editorUserId,
          ip_address: "127.0.0.1",
        }, { actor: "editor", cleanup: true });
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      pageAfter = this.#siteId === null ? null : await this.#page({ cleanup: true });
      if (this.#pageResource !== null && pageAfter === null) {
        this.#resources.release(this.#pageResource, { page_get: null });
      }
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "MailForm public cleanup failed");
    return { page_get: pageAfter };
  }

  #matchesOwnedPage(page) {
    return this.#ownedPage !== null
      && page?.page_id === this.#ownedPage.page_id
      && page.revision_id === this.#ownedPage.revision_id
      && page.slug === this.#ownedPage.slug
      && page.title === this.#ownedPage.title
      && page.wikitext === this.#ownedPage.wikitext;
  }
}

function verifyCase(caseId, observations) {
  requirePlainObject(observations, `${caseId} observations`);
  if (caseId !== "A1037_MAILFORM_FAIL_CLOSED_SERVED") throw new Error(`unsupported Open43 MailForm case: ${caseId}`);
  for (const name of ["preview", "saved"]) {
    requirePlainObject(observations[name], `${caseId} ${name}`);
    if (observations[name].fail_closed !== true) throw new Error(`${caseId} ${name} did not prove fail-closed output`);
  }
  const expected = ["site_get", "page_get", "wikidot_page_preview", "page_create", "page_get"];
  const requests = observations.adapter_requests;
  if (!Array.isArray(requests) || requests.length !== expected.length) throw new Error(`${caseId} request denominator is wrong`);
  requests.forEach((request, index) => {
    if (request.service !== "deepwell" || request.operation !== expected[index] || request.method !== "POST" || request.response_status !== 200) {
      throw new Error(`${caseId} public request evidence is wrong or out of order`);
    }
  });
  return {
    verified: true,
    preview_body_sha256: observations.preview.sha256,
    saved_body_sha256: observations.saved.sha256,
    public_request_order_verified: true,
  };
}

function verifyCleanup(proof, resources) {
  if (proof?.page_get !== null) throw new Error("MailForm cleanup did not prove public page absence");
  if (!Array.isArray(resources) || resources.length !== 1 || resources.some((resource) => resource.released !== true)) {
    throw new Error("MailForm cleanup did not release its recorded page");
  }
  return { public_absence_verified: true, page_absent: true, resource_count: resources.length };
}

export function createOpen43MailformCandidateCaseSet({
  sessionFactory = (options) => new CandidateHttpSession(options),
} = {}) {
  const sourceFiles = Object.freeze([
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/atomic-no-replace.mjs",
    "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-mailform-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-mailform-fail-closed",
    caseIds: OPEN43_MAILFORM_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      requireCandidateSite(candidateIdentity);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      const runSlug = pageSlug(runId);
      const execution = new Open43MailformRun({ session, resources, pageSlug: runSlug });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.open43_mailform_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_slug: runSlug,
          source_sha256: sha256Text(sourceFor(`candidate-case-owner:${runSlug}`)),
          candidate_observation_scope: "public Deepwell preview and saved-page RPC responses plus adapter-issued requests",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase,
        verifyCleanup,
      });
    },
  });
}
