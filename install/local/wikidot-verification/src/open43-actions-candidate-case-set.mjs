import { CandidateHttpSession } from "./candidate-case-http.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  sha256Text,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_ACTIONS_CASE_IDS = Object.freeze([
  "A1041_CENTRAL_REGISTRY_AND_MUTATION",
  "A1041_SET_TAGS_CONTENTION",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const SOURCE = [
  "[[button history]]",
  "[[button source]]",
  '[[button set-tags -* +candidate text="Apply tags"]]',
].join("\n");
const INITIAL_TAGS = Object.freeze(["original"]);
const EXPECTED_TAGS = Object.freeze(["candidate"]);
const STALE_ERROR_CODE = 4000;
const STALE_ERROR_MESSAGE_SHA256 = sha256Text("The request is in some way malformed or incorrect");
const EXPECTED_LABELS = Object.freeze(["history", "view source", "Apply tags"]);
const EXPECTED_OPERATIONS = Object.freeze([
  "site_get",
  "page_get",
  "wikidot_page_preview",
  "page_get",
  "page_create",
  "page_get",
  "page_view",
  "wikidot_legacy_set_tags",
  "page_get",
  "wikidot_legacy_set_tags",
  "page_get",
]);
const CONTENTION_SETUP_OPERATIONS = Object.freeze(["page_edit", "page_get"]);
const CONTENTION_OPERATIONS = Object.freeze([
  "wikidot_legacy_set_tags",
  "wikidot_legacy_set_tags",
  "page_get",
]);

function pageSlug(runId) {
  return `open43-actions-runtime-${runId.slice("candidate-case-".length)}`;
}

function requireCandidateSite(candidateIdentity) {
  const candidate = requirePlainObject(candidateIdentity?.candidate, "actions candidate identity");
  const endpoint = requirePlainObject(candidate.endpoint, "actions candidate endpoint");
  if (endpoint.host !== SITE_HOST || endpoint.port === 443 || candidate.port_443_published !== false) {
    throw new Error(`Open43 actions requires an exact non-standing ${SITE_HOST} candidate`);
  }
}

function bodyEvidence(value, name) {
  const body = requireNonEmptyString(value, `${name} body`);
  const controls = body.match(/class="wiki-standalone-button"/gu) ?? [];
  const inertLinks = body.match(/href="javascript:;"/gu) ?? [];
  if (controls.length !== 3 || inertLinks.length !== 3) {
    throw new Error(`${name} did not expose exactly three inert Wikidot controls`);
  }
  for (const label of EXPECTED_LABELS) {
    if (!body.includes(`>${label}</a>`)) throw new Error(`${name} omitted the exact ${label} label`);
  }
  for (const forbidden of ["[[button", "onclick=", "wj-button-", "data-wikijump"]) {
    if (body.includes(forbidden)) throw new Error(`${name} exposed forbidden action content ${forbidden}`);
  }
  return {
    sha256: sha256Text(body),
    bytes: Buffer.byteLength(body),
    control_count: controls.length,
    labels: [...EXPECTED_LABELS],
    inert_href_count: inertLinks.length,
  };
}

function actionEvidence(value, name) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${name} action denominator is not exact`);
  if (value[0]?.type !== "history" || Object.keys(value[0]).length !== 1) throw new Error(`${name} history descriptor is not exact`);
  if (value[1]?.type !== "source" || Object.keys(value[1]).length !== 1) throw new Error(`${name} source descriptor is not exact`);
  if (
    value[2]?.type !== "set-tags"
    || value[2].index !== 2
    || !/^[0-9a-f]{32}$/u.test(value[2].fingerprint ?? "")
    || Object.keys(value[2]).length !== 3
  ) {
    throw new Error(`${name} set-tags descriptor is not exact`);
  }
  return structuredClone(value);
}

function foundPageView(value) {
  if (value?.type !== "found") throw new Error("public page_view did not return a found actions page");
  return requirePlainObject(value.data, "actions page_view data");
}

function requestEvidence(events, start) {
  return events.slice(start).map(({ service, operation, method, response_status }) => ({ service, operation, method, response_status }));
}

class Open43ActionsRun {
  #session;
  #resources;
  #pageSlug;
  #siteId = null;
  #ownedPage = null;
  #pageResource = null;

  constructor({ session, resources, pageSlug: slug }) {
    this.#session = session;
    this.#resources = resources;
    this.#pageSlug = slug;
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
    return await this.#rpc("page_get", {
      site_id: this.#siteId,
      page: this.#pageSlug,
      details: { compiled_html: true, wikitext: true },
    }, { actor, cleanup });
  }

  #matchesOwnedPage(page) {
    return this.#ownedPage !== null
      && page?.page_id === this.#ownedPage.page_id
      && page.site_id === this.#siteId
      && page.slug === this.#pageSlug
      && page.title === this.#ownedPage.title
      && page.wikitext === SOURCE;
  }

  async execute() {
    const eventStart = this.#session.events.length;
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG }, { actor: "anonymous" });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) throw new Error("editable actions candidate site is missing");
    this.#siteId = site.site_id;
    if (await this.#page() !== null) throw new Error("run-owned actions page namespace already exists");

    const preview = await this.#rpc("wikidot_page_preview", {
      site_id: this.#siteId,
      title: `candidate-case-owner:${this.#pageSlug}`,
      wikitext: SOURCE,
    }, { actor: "anonymous" });
    const previewBody = bodyEvidence(preview?.body, "actions preview");
    const previewActions = actionEvidence(preview?.legacy_actions, "actions preview");
    if (await this.#page() !== null) throw new Error("anonymous action preview mutated public page state");

    const title = `candidate-case-owner:${this.#pageSlug}`;
    const created = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug: this.#pageSlug,
      title,
      alt_title: null,
      wikitext: SOURCE,
      layout: "wikidot",
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
      tags: INITIAL_TAGS,
      revision_comments: "Open43 actions candidate fixture",
    });
    if (!Number.isSafeInteger(created?.page_id) || !Number.isSafeInteger(created.revision_id) || created.slug !== this.#pageSlug) {
      throw new Error("page_create did not return the public actions page identity");
    }
    this.#ownedPage = { page_id: created.page_id, slug: created.slug, title };
    this.#pageResource = this.#resources.register("page", {
      page_id: created.page_id,
      site_id: this.#siteId,
      slug: created.slug,
      title,
      source_sha256: sha256Text(SOURCE),
    });

    const saved = await this.#page();
    if (!this.#matchesOwnedPage(saved)) throw new Error("saved actions page does not match its public ownership proof");
    const savedBody = bodyEvidence(saved.compiled_body_html, "saved actions page");
    const view = foundPageView(await this.#rpc("page_view", {
      site_id: this.#siteId,
      session_token: null,
      route: { slug: this.#pageSlug, extra: "" },
      locales: ["en-US", "en"],
    }, { actor: "anonymous" }));
    const viewBody = bodyEvidence(view.compiled_body_html, "served actions page");
    const viewActions = actionEvidence(view.legacy_actions, "served actions page");
    if (previewBody.sha256 !== savedBody.sha256 || previewBody.sha256 !== viewBody.sha256) throw new Error("preview, saved, and served action DOM differ");
    if (JSON.stringify(previewActions) !== JSON.stringify(viewActions)) throw new Error("preview and served action descriptors differ");

    const beforeMismatch = { revision_id: saved.revision_id, tags: saved.tags };
    const mismatchFingerprint = "0".repeat(32);
    if (mismatchFingerprint === viewActions[2].fingerprint) throw new Error("forged fingerprint control is not distinct");
    let mismatchDenied = false;
    try {
      await this.#rpc("wikidot_legacy_set_tags", {
        page_id: saved.page_id,
        last_revision_id: saved.revision_id,
        action_index: 2,
        action_fingerprint: mismatchFingerprint,
        user_id: this.#session.editorUserId,
        ip_address: "127.0.0.1",
      });
    } catch {
      mismatchDenied = true;
    }
    const afterMismatch = await this.#page();

    await this.#rpc("wikidot_legacy_set_tags", {
      page_id: saved.page_id,
      last_revision_id: afterMismatch.revision_id,
      action_index: viewActions[2].index,
      action_fingerprint: viewActions[2].fingerprint,
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
    });
    const afterMutation = await this.#page();
    const centralRequests = requestEvidence(this.#session.events, eventStart);

    const contentionSetupStart = this.#session.events.length;
    await this.#rpc("page_edit", {
      site_id: this.#siteId,
      page: saved.page_id,
      last_revision_id: afterMutation.revision_id,
      revision_comments: "Open43 actions contention reset",
      user_id: this.#session.editorUserId,
      tags: INITIAL_TAGS,
      ip_address: "127.0.0.1",
    });
    const contentionBefore = await this.#page();
    const contentionSetupRequests = requestEvidence(this.#session.events, contentionSetupStart);
    const contentionStart = this.#session.events.length;
    const attempts = await Promise.allSettled([0, 1].map(() => this.#rpc("wikidot_legacy_set_tags", {
      page_id: saved.page_id,
      last_revision_id: contentionBefore.revision_id,
      action_index: viewActions[2].index,
      action_fingerprint: viewActions[2].fingerprint,
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
    })));
    const contentionAfter = await this.#page();

    return [
      {
        case_id: OPEN43_ACTIONS_CASE_IDS[0],
        observations: {
          actor: { user_id: this.#session.editorUserId },
          page: { site_id: this.#siteId, page_id: saved.page_id, slug: this.#pageSlug, source_sha256: sha256Text(SOURCE) },
          preview: { body: previewBody, actions: previewActions, page_after_preview: null },
          saved: { body: savedBody, revision_id: saved.revision_id, tags: saved.tags },
          served: { body: viewBody, actions: viewActions },
          forged: {
            denied: mismatchDenied,
            before_sha256: sha256Value(beforeMismatch),
            after_sha256: sha256Value({ revision_id: afterMismatch.revision_id, tags: afterMismatch.tags }),
          },
          mutation: { revision_id: afterMutation.revision_id, tags: afterMutation.tags },
          requests: centralRequests,
        },
      },
      {
        case_id: OPEN43_ACTIONS_CASE_IDS[1],
        observations: {
          actor: { user_id: this.#session.editorUserId },
          page: { site_id: this.#siteId, page_id: saved.page_id, slug: this.#pageSlug, source_sha256: sha256Text(SOURCE) },
          action: viewActions[2],
          setup: {
            before: { revision_id: afterMutation.revision_id, revision_number: afterMutation.revision_number, tags: afterMutation.tags },
            reset: { revision_id: contentionBefore.revision_id, revision_number: contentionBefore.revision_number, tags: contentionBefore.tags },
            requests: contentionSetupRequests,
          },
          attempts: attempts.map((attempt) => attempt.status === "fulfilled"
            ? { status: attempt.status }
            : { status: attempt.status, rpc_code: attempt.reason?.rpc?.code ?? null, rpc_message_sha256: attempt.reason?.rpc?.message_sha256 ?? null }),
          after: { revision_id: contentionAfter.revision_id, revision_number: contentionAfter.revision_number, tags: contentionAfter.tags },
          requests: requestEvidence(this.#session.events, contentionStart),
        },
      },
    ];
  }

  async cleanup() {
    const failures = [];
    let pageAfter = null;
    try {
      const page = this.#siteId === null ? null : await this.#page({ actor: "editor", cleanup: true });
      if (page !== null && !this.#matchesOwnedPage(page)) throw new Error("run-owned actions page identity drifted during cleanup");
      if (page !== null) {
        await this.#rpc("page_delete", {
          site_id: this.#siteId,
          page: page.page_id,
          last_revision_id: page.revision_id,
          revision_comments: "Open43 actions candidate cleanup",
          user_id: this.#session.editorUserId,
          ip_address: "127.0.0.1",
        }, { cleanup: true });
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      pageAfter = this.#siteId === null ? null : await this.#page({ cleanup: true });
      if (this.#pageResource !== null && pageAfter === null) this.#resources.release(this.#pageResource, { page_get: null });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "actions public cleanup failed");
    return { page_get: pageAfter };
  }
}

function verifyCase(caseId, observations) {
  if (!OPEN43_ACTIONS_CASE_IDS.includes(caseId)) throw new Error(`unsupported Open43 actions case: ${caseId}`);
  requirePlainObject(observations, `${caseId} observations`);
  if (caseId === OPEN43_ACTIONS_CASE_IDS[1]) {
    if (observations.action?.type !== "set-tags" || observations.action.index !== 2 || !/^[0-9a-f]{32}$/u.test(observations.action.fingerprint ?? "")) throw new Error(`${caseId} did not bind the server-issued set-tags action`);
    if (
      JSON.stringify(observations.setup?.before?.tags) !== JSON.stringify(EXPECTED_TAGS)
      || JSON.stringify(observations.setup?.reset?.tags) !== JSON.stringify(INITIAL_TAGS)
      || observations.setup.before.revision_id === observations.setup.reset.revision_id
      || !Number.isSafeInteger(observations.setup.before.revision_number)
      || observations.setup.reset.revision_number !== observations.setup.before.revision_number + 1
    ) throw new Error(`${caseId} did not establish one fresh public contention revision`);
    const fulfilled = Array.isArray(observations.attempts) ? observations.attempts.filter(({ status }) => status === "fulfilled") : [];
    const rejected = Array.isArray(observations.attempts) ? observations.attempts.filter(({ status }) => status === "rejected") : [];
    if (fulfilled.length !== 1 || Object.keys(fulfilled[0]).length !== 1 || rejected.length !== 1 || rejected[0].rpc_code !== STALE_ERROR_CODE || rejected[0].rpc_message_sha256 !== STALE_ERROR_MESSAGE_SHA256) throw new Error(`${caseId} returned stale success or did not expose the exact stale-revision denial`);
    if (
      JSON.stringify(observations.after?.tags) !== JSON.stringify(EXPECTED_TAGS)
      || observations.after.revision_id === observations.setup.reset.revision_id
      || observations.after.revision_number !== observations.setup.reset.revision_number + 1
    ) throw new Error(`${caseId} final public state does not match one winning transition`);
    for (const [requests, expected, name] of [[observations.setup.requests, CONTENTION_SETUP_OPERATIONS, "setup"], [observations.requests, CONTENTION_OPERATIONS, "contention"]]) {
      if (!Array.isArray(requests) || requests.length !== expected.length) throw new Error(`${caseId} ${name} request denominator is wrong`);
      requests.forEach((request, index) => {
        if (request.service !== "deepwell" || request.operation !== expected[index] || request.method !== "POST" || request.response_status !== 200) throw new Error(`${caseId} ${name} request evidence is wrong or out of order`);
      });
    }
    return {
      verified: true,
      actor_user_id: observations.actor.user_id,
      attempts: 2,
      committed_transitions: 1,
      stale_successes: 0,
      tags_after_contention: EXPECTED_TAGS,
      public_request_order_verified: true,
    };
  }
  for (const name of ["preview", "saved", "served"]) requirePlainObject(observations[name], `${caseId} ${name}`);
  const bodyHashes = [observations.preview.body?.sha256, observations.saved.body?.sha256, observations.served.body?.sha256];
  if (new Set(bodyHashes).size !== 1 || bodyHashes[0] === undefined) throw new Error(`${caseId} did not prove exact preview, saved, and served DOM equality`);
  if (JSON.stringify(observations.preview.actions) !== JSON.stringify(observations.served.actions)) throw new Error(`${caseId} action descriptors drifted`);
  if (observations.preview.page_after_preview !== null) throw new Error(`${caseId} preview was not non-mutating`);
  if (observations.forged?.denied !== true || observations.forged.before_sha256 !== observations.forged.after_sha256) throw new Error(`${caseId} forged descriptor was not denied without mutation`);
  if (
    JSON.stringify(observations.saved.tags) !== JSON.stringify(INITIAL_TAGS)
    || JSON.stringify(observations.mutation?.tags) !== JSON.stringify(EXPECTED_TAGS)
    || observations.mutation.revision_id === observations.saved.revision_id
  ) {
    throw new Error(`${caseId} valid set-tags did not create the exact next public state`);
  }
  if (!Array.isArray(observations.requests) || observations.requests.length !== EXPECTED_OPERATIONS.length) throw new Error(`${caseId} public request denominator is wrong`);
  observations.requests.forEach((request, index) => {
    if (request.service !== "deepwell" || request.operation !== EXPECTED_OPERATIONS[index] || request.method !== "POST" || request.response_status !== 200) {
      throw new Error(`${caseId} public request evidence is wrong or out of order`);
    }
  });
  return {
    verified: true,
    actor_user_id: observations.actor.user_id,
    preview_saved_served_dom_sha256: bodyHashes[0],
    controls: ["history", "source", "set-tags"],
    forged_descriptor_denied: true,
    tags_after_set_tags: EXPECTED_TAGS,
    public_request_order_verified: true,
  };
}

function verifyCleanup(proof, resources) {
  if (proof?.page_get !== null || !Array.isArray(resources) || resources.length !== 1 || resources.some((resource) => resource.released !== true)) {
    throw new Error("actions cleanup did not prove public page absence and resource release");
  }
  return { public_absence_verified: true, page_absent: true, resource_count: resources.length };
}

export function createOpen43ActionsCandidateCaseSet({
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
    "install/local/wikidot-verification/src/open43-actions-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    "deepwell/src/endpoints/page.rs",
    "deepwell/src/services/legacy_action.rs",
    "deepwell/src/services/render/legacy_actions.rs",
    "framerail/src/lib/wikidot/wikidot-legacy-action-request.js",
    "framerail/src/lib/wikidot/wikidot-legacy-actions.js",
    "framerail/src/routes/[slug]/[...extra]/page.svelte",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-actions",
    caseIds: OPEN43_ACTIONS_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      requireCandidateSite(candidateIdentity);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      const runSlug = pageSlug(runId);
      const execution = new Open43ActionsRun({ session, resources, pageSlug: runSlug });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.open43_actions_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_slug: runSlug,
          actor_user_id: session.editorUserId,
          source: SOURCE,
          source_sha256: sha256Text(SOURCE),
          initial_tags: INITIAL_TAGS,
          expected_tags: EXPECTED_TAGS,
          candidate_observation_scope: "public Deepwell preview, saved-page, page-view, denial, mutation, contention, and cleanup RPC responses",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase,
        verifyCleanup,
      });
    },
  });
}
