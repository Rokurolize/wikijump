import { Open43Issue1041LifecycleBrowserAdapter } from "./open43-issue1041-lifecycle-browser-adapter.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requirePlainObject,
  sha256Text,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_ISSUE1041_CASE_IDS = Object.freeze([
  "A1041_EXACT_BROWSER_LIFECYCLE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const SOURCE = [
  '[[button edit text="Edit page here"]]',
  "[[button history]]",
  "[[button source]]",
  '[[button print text="Print this page"]]',
  '[[button set-tags -* +candidate text="Apply tags"]]',
].join("\n");
const INITIAL_TAGS = Object.freeze(["original"]);
const EXPECTED_TAGS = Object.freeze(["candidate"]);
const EDIT_LABEL = "Edit page here";
const HISTORY_LABEL = "history";
const SOURCE_LABEL = "view source";
const PRINT_LABEL = "Print this page";
const TAGS_LABEL = "Apply tags";

function requireInitial(value, plan, name) {
  const initial = requirePlainObject(value, `${name} initial`);
  const capture = requirePlainObject(initial.capture, `${name} initial capture`);
  if (
    capture.capture_error !== undefined ||
    capture.navigation_status !== 200 ||
    capture.input_url !== plan.page_url ||
    capture.final_url !== plan.page_url
  ) {
    throw new Error(`${name} did not capture the exact action page`);
  }
  const documents = [capture.first_paint?.document, capture.document];
  for (const documentValue of documents) {
    const document = requirePlainObject(documentValue, `${name} capture document`);
    if (document.phase !== "domcontentloaded_immediate_observation" && document.phase !== "settled") throw new Error(`${name} capture phase is unknown`);
    const probe = document.presence_probes?.find(({ id }) => id === "standalone-actions");
    if (probe?.count !== 5 || probe.rendered_count !== 5) throw new Error(`${name} capture standalone controls drifted`);
  }
  requireState(initial.state, plan, { busy: false }, `${name} initial`);
  return initial;
}

function requireState(value, plan, expected, name) {
  const state = requirePlainObject(value, `${name} state`);
  if (
    state.url !== plan.page_url ||
    state.path !== plan.page_path ||
    !Number.isSafeInteger(state.history_length) ||
    state.history_length < 1 ||
    state.standalone_button_count !== 5 ||
    state.editor_count !== 0 ||
    state.source_disclosure !== false
  ) {
    throw new Error(`${name} public action page state drifted`);
  }
  if (state.any_aria_busy !== (expected.busy ?? false)) throw new Error(`${name} busy state drifted`);
  if (state.error_popup_visible !== (expected.error ?? false)) throw new Error(`${name} error popup visibility drifted`);
  return state;
}

function requireFocusedActivation(value, plan, expected, name) {
  const operation = requirePlainObject(value, `${name} operation`);
  requireState(operation.before, plan, { busy: false }, `${name} before`);
  if (operation.before.focused_control !== true) throw new Error(`${name} did not focus its control`);
  requireState(operation.after, plan, { busy: false, ...(expected.error ? { error: true } : {}) }, `${name} after`);
  if (operation.mutation_request_count !== expected.requests) throw new Error(`${name} public request count drifted`);
  return operation;
}

function requireBusyCycle(value, expected, name) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error(`${name} busy cycle drifted`);
  }
}

function requireEditDestination(value, plan, name) {
  const after = requirePlainObject(value, `${name} after`);
  if (after.path !== plan.edit_path || after.editor_count !== 1) {
    throw new Error(`${name} did not reach the editor`);
  }
  if (after.any_aria_busy !== false || after.error_popup_visible !== false || after.source_disclosure !== false) {
    throw new Error(`${name} editor state did not settle`);
  }
  return after;
}

function requireEdit(value, plan, name) {
  const edit = requirePlainObject(value, `${name} edit`);
  for (const mode of ["click", "keyboard", "double"]) {
    const operation = requirePlainObject(edit[mode], `${name} edit ${mode}`);
    requireState(operation.before, plan, { busy: false }, `${name} edit ${mode} before`);
    if (operation.before.focused_control !== true) throw new Error(`${name} edit ${mode} did not focus its control`);
    requireEditDestination(operation.after, plan, `${name} edit ${mode}`);
    requireBusyCycle(operation.after.busy_events, [{ label: EDIT_LABEL, busy: true }], `${name} edit ${mode}`);
    if (operation.mutation_request_count !== 1) throw new Error(`${name} edit ${mode} public request count drifted`);
    if (operation.before.history_length !== operation.after.history_length) throw new Error(`${name} edit ${mode} changed the history length`);
  }
  const backForward = requirePlainObject(edit.back_forward, `${name} edit back_forward`);
  if (backForward.home?.path !== "/") throw new Error(`${name} edit history did not start at the origin root`);
  requireState(backForward.back, plan, { busy: false }, `${name} edit back`);
  requireEditDestination(backForward.forward, plan, `${name} edit forward`);
  return edit;
}

function requirePane(value, plan, expected, name) {
  const pane = requirePlainObject(value, `${name} pane`);
  for (const mode of expected.modes) {
    const operation = requireFocusedActivation(pane[mode], plan, { requests: 0 }, `${name} ${mode}`);
    requireBusyCycle(operation.after.busy_events, [{ label: expected.label, busy: true }, { label: expected.label, busy: false }], `${name} ${mode}`);
    if (operation.after.action_area_visible !== true) throw new Error(`${name} ${mode} did not open the action area`);
    if (expected.kind === "history" && operation.after.history_pane_visible !== true) throw new Error(`${name} ${mode} did not open the history pane`);
    if (expected.kind === "source" && operation.after.source_pane_visible !== true) throw new Error(`${name} ${mode} did not open the source pane`);
    if (operation.before.history_length !== operation.after.history_length) throw new Error(`${name} ${mode} changed the history length`);
  }
  return pane;
}

function requirePrint(value, plan, name) {
  const print = requirePlainObject(value, `${name} print`);
  const operation = requirePlainObject(print.hold, `${name} print hold`);
  requireState(operation.before, plan, { busy: false }, `${name} print before`);
  if (operation.before.focused_control !== true) throw new Error(`${name} print did not focus its control`);
  requireState(operation.during, plan, { busy: true }, `${name} print during`);
  if (operation.during.print_pending !== 1 || operation.during.source_pane_visible !== false) {
    throw new Error(`${name} print did not hold its pending busy state`);
  }
  requireState(operation.independent, plan, { busy: true }, `${name} print independent`);
  if (operation.independent.source_pane_visible !== true || operation.independent.print_pending !== 1) {
    throw new Error(`${name} print busy state blocked an independent control`);
  }
  requireState(operation.after, plan, { busy: false }, `${name} print after`);
  if (operation.after.print_pending !== 0 || operation.after.source_pane_visible !== true) {
    throw new Error(`${name} print release did not settle`);
  }
  requireBusyCycle(operation.after.busy_events.filter(({ label }) => label === PRINT_LABEL), [{ label: PRINT_LABEL, busy: true }, { label: PRINT_LABEL, busy: false }], `${name} print`);
  requireBusyCycle(operation.after.busy_events.filter(({ label }) => label === SOURCE_LABEL), [{ label: SOURCE_LABEL, busy: true }, { label: SOURCE_LABEL, busy: false }], `${name} independent source`);
  if (operation.mutation_request_count !== 0) throw new Error(`${name} print issued a mutation request`);
  return print;
}

function requireSetTags(value, plan, modes, name) {
  const setTags = requirePlainObject(value, `${name} set_tags`);
  for (const mode of modes) {
    const operation = requireFocusedActivation(setTags[mode], plan, { requests: 1 }, `${name} set_tags ${mode}`);
    if (operation.after.path !== plan.page_path) throw new Error(`${name} set_tags ${mode} navigated away from the page`);
    if (operation.after.error_popup_visible !== false) throw new Error(`${name} set_tags ${mode} surfaced an error popup`);
    requireBusyCycle(operation.after.busy_events, [{ label: TAGS_LABEL, busy: true }], `${name} set_tags ${mode}`);
    if (operation.navigation_count < 1) throw new Error(`${name} set_tags ${mode} did not reload`);
    if (operation.before.history_length !== operation.after.history_length) throw new Error(`${name} set_tags ${mode} changed the history length`);
  }
  return setTags;
}

function requireSetTagsDenial(value, plan, name) {
  const error = requirePlainObject(value, `${name} set_tags_error`);
  const denial = requireFocusedActivation(error.non_editable_member, plan, { requests: 1, error: true }, `${name} set_tags denial`);
  if (denial.after.path !== plan.page_path) throw new Error(`${name} set_tags denial navigated away from the page`);
  requireBusyCycle(denial.after.busy_events, [{ label: TAGS_LABEL, busy: true }, { label: TAGS_LABEL, busy: false }], `${name} set_tags denial`);
  if (denial.navigation_count !== 0) throw new Error(`${name} set_tags denial reloaded the page`);
  return error;
}

function verifyCase(caseId, observations, plan) {
  if (caseId !== OPEN43_ISSUE1041_CASE_IDS[0]) throw new Error(`unknown issue 1041 case: ${caseId}`);
  const value = requirePlainObject(observations, `${caseId} observations`);
  const page = requirePlainObject(value.page, `${caseId} page`);
  if (page.source_sha256 !== plan.source_sha256 || page.initial_tags !== JSON.stringify(INITIAL_TAGS)) {
    throw new Error(`${caseId} action page identity drifted`);
  }
  const lifecycle = requirePlainObject(value.lifecycle, `${caseId} lifecycle`);
  requireInitial(lifecycle.initial, plan, caseId);
  requireEdit(lifecycle.edit, plan, caseId);
  requirePane(lifecycle.history, plan, { label: HISTORY_LABEL, kind: "history", modes: ["click"] }, caseId);
  requirePane(lifecycle.source, plan, { label: SOURCE_LABEL, kind: "source", modes: ["click", "keyboard"] }, caseId);
  requirePrint(lifecycle.print, plan, caseId);
  requireSetTags(lifecycle.set_tags, plan, ["click", "keyboard", "double"], caseId);
  requireSetTagsDenial(lifecycle.set_tags_error, plan, caseId);
  const mutation = requirePlainObject(value.mutation, `${caseId} mutation`);
  if (mutation.tags !== JSON.stringify(EXPECTED_TAGS) || mutation.revision_id === plan.created_revision_id) {
    throw new Error(`${caseId} did not leave the exact set-tags public state`);
  }
  return {
    verified: true,
    page_path: plan.page_path,
    controls: ["edit", "history", "source", "print", "set-tags"],
    tags_after_set_tags: EXPECTED_TAGS,
    error_popup_verified: true,
    independent_buttons_verified: true,
  };
}

function verifyCleanup(proof, resources) {
  const value = requirePlainObject(proof, "issue 1041 cleanup proof");
  if (
    value.page_get !== null ||
    value.public_absence_verified !== true ||
    !Array.isArray(resources) ||
    resources.length !== 1 ||
    resources.some((resource) => resource.released !== true)
  ) {
    throw new Error("issue 1041 cleanup did not prove page absence and resource release");
  }
  return { verified: true, public_absence_verified: true, page_absent: true };
}

class Open43Issue1041LifecycleRun {
  #session;
  #browser;
  #resources;
  #runId;
  #pageSlug;
  #siteId = null;
  #ownedPage = null;
  #pageResource = null;
  #verificationPlan = null;

  constructor({ session, browser, resources, runId }) {
    this.#session = session;
    this.#browser = browser;
    this.#resources = resources;
    this.#runId = runId;
    this.#pageSlug = `open43-issue1041-${runId.slice("candidate-run-".length)}`;
  }

  async #rpc(method, params = {}, { actor = "administrator", cleanup = false } = {}) {
    return await this.#session.rpc(method, params, {
      actor,
      siteId: this.#siteId ?? undefined,
      page: this.#pageSlug,
      cleanup,
    });
  }

  async #page(cleanup = false) {
    return await this.#rpc("page_get", {
      site_id: this.#siteId,
      page: this.#pageSlug,
      details: { wikitext: true, compiled: false },
    }, { cleanup });
  }

  #matchesOwnedPage(page) {
    return page?.site_id === this.#siteId
      && page.page_id === this.#ownedPage?.page_id
      && page.slug === this.#pageSlug
      && page.title === this.#ownedPage?.title
      && page.wikitext === SOURCE;
  }

  async execute() {
    const sessions = await this.#session.verifyActorSessions();
    const privateIdentity = this.#session.privateInputIdentity;
    if (
      sessions.administrator_user_id !== privateIdentity.administrator_user_id ||
      sessions.non_admin_user_id !== privateIdentity.non_admin_user_id ||
      sessions.expired_session !== null
    ) {
      throw new Error("issue 1041 actor session identity drifted");
    }
    const site = await this.#rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) throw new Error("issue 1041 editable candidate site is missing");
    this.#siteId = site.site_id;
    if (await this.#page() !== null) throw new Error("issue 1041 run-owned page namespace already exists");
    const title = `candidate-case-owner:${this.#pageSlug}`;
    const created = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug: this.#pageSlug,
      title,
      alt_title: null,
      wikitext: SOURCE,
      layout: "wikidot",
      user_id: privateIdentity.administrator_user_id,
      ip_address: "127.0.0.1",
      tags: INITIAL_TAGS,
      revision_comments: "Open43 issue 1041 candidate fixture",
    });
    if (!Number.isSafeInteger(created?.page_id) || !Number.isSafeInteger(created.revision_id) || created.slug !== this.#pageSlug) {
      throw new Error("issue 1041 page_create did not return the owned page identity");
    }
    this.#ownedPage = { page_id: created.page_id, revision_id: created.revision_id, slug: created.slug, title };
    this.#pageResource = this.#resources.register("page", {
      page_id: created.page_id,
      site_id: this.#siteId,
      slug: created.slug,
      title,
      source_sha256: sha256Text(SOURCE),
    });
    if (!this.#matchesOwnedPage(await this.#page())) throw new Error("issue 1041 created page failed its public ownership proof");
    const permissionRows = await Promise.all([
      ["anonymous", "anonymous", false],
      ["editable_member", "administrator", true],
      ["non_editable_member", "non_admin", false],
    ].map(async ([label, actor, expected]) => {
      const result = await this.#rpc("page_edit_permission", {}, { actor });
      if (result?.can_edit !== expected) throw new Error(`issue 1041 ${label} permission preflight did not match the fixture contract`);
      return [label, result.can_edit];
    }));
    const permissions = Object.fromEntries(permissionRows);
    const pagePath = `/${encodeURIComponent(this.#pageSlug)}`;
    const pageUrl = new URL(pagePath, this.#session.pageOrigin).href;
    const lifecycle = await this.#browser.run({ pageUrl, pagePath });
    const after = await this.#page();
    if (!this.#matchesOwnedPage(after)) throw new Error("issue 1041 page identity drifted during the browser lifecycle");
    this.#verificationPlan = {
      page_path: pagePath,
      page_url: pageUrl,
      edit_path: `${pagePath}/edit`,
      source_sha256: sha256Text(SOURCE),
      created_revision_id: created.revision_id,
    };
    return [{
      case_id: OPEN43_ISSUE1041_CASE_IDS[0],
      observations: {
        page: {
          page_id: created.page_id,
          slug: this.#pageSlug,
          source_sha256: sha256Text(SOURCE),
          initial_tags: JSON.stringify(INITIAL_TAGS),
        },
        permissions,
        lifecycle,
        mutation: { revision_id: after.revision_id, tags: JSON.stringify(after.tags) },
      },
    }];
  }

  async cleanup() {
    let pageAfter = null;
    if (this.#siteId !== null && this.#ownedPage !== null) {
      const page = await this.#page(true);
      if (!this.#matchesOwnedPage(page)) throw new Error("issue 1041 owned page identity drifted during cleanup");
      await this.#rpc("page_delete", {
        site_id: this.#siteId,
        page: page.page_id,
        last_revision_id: page.revision_id,
        revision_comments: "Open43 issue 1041 candidate cleanup",
        user_id: this.#session.privateInputIdentity.administrator_user_id,
        ip_address: "127.0.0.1",
      }, { cleanup: true });
      pageAfter = await this.#page(true);
      if (pageAfter !== null) throw new Error("issue 1041 run-owned page remained after cleanup");
      this.#resources.release(this.#pageResource, { page_get: null });
    }
    return { page_get: pageAfter, public_absence_verified: pageAfter === null };
  }

  verifyCase(caseId, observations) {
    if (this.#verificationPlan === null) throw new Error("issue 1041 case was not executed");
    return verifyCase(caseId, observations, this.#verificationPlan);
  }
}

const SOURCE_FILES = Object.freeze([
  ...new Set([
    ...STANDING_BROWSER_EXECUTION_MODULES,
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/open43-issue1041-lifecycle-browser-adapter.mjs",
    "install/local/wikidot-verification/src/open43-issue1041-lifecycle-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/open43-settings-candidate-http.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "framerail/src/lib/wikidot/wikidot-legacy-actions.js",
    "framerail/src/lib/wikidot/wikidot-legacy-action-request.js",
    "framerail/src/routes/[slug]/[...extra]/page.svelte",
    "framerail/src/routes/[slug]/[...extra]/EditorPane.svelte",
    "deepwell/src/endpoints/page.rs",
    "deepwell/src/services/legacy_action.rs",
    "deepwell/src/services/render/legacy_actions.rs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]),
]);

export function createOpen43Issue1041LifecycleCandidateCaseSet({
  sessionFactory = async (options) => {
    const { Open43SettingsCandidateSession } = await import("./open43-settings-candidate-http.mjs");
    return new Open43SettingsCandidateSession(options);
  },
  browserAdapterFactory = (options) => new Open43Issue1041LifecycleBrowserAdapter(options),
} = {}) {
  return Object.freeze({
    id: "open43-issue1041-action-lifecycle",
    caseIds: OPEN43_ISSUE1041_CASE_IDS,
    async prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      const candidate = requirePlainObject(candidateIdentity?.candidate, "issue 1041 candidate identity");
      const endpoint = requirePlainObject(candidate.endpoint, "issue 1041 candidate endpoint");
      if (endpoint.host !== SITE_HOST || endpoint.port === 443 || candidate.port_443_published !== false) {
        throw new Error(`issue 1041 requires an exact non-standing ${SITE_HOST} candidate`);
      }
      const session = await sessionFactory({ candidateIdentity, privateInput, signal });
      if (session.pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("issue 1041 session did not bind the candidate origin");
      const privateInputIdentity = session.privateInputIdentity;
      const browser = browserAdapterFactory({
        browserContexts: candidateBrowserContexts,
        pageOrigin: session.pageOrigin,
        storageState: (actor) => session.storageState(actor),
      });
      const execution = new Open43Issue1041LifecycleRun({ session, browser, resources, runId });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity,
        browserCredentialPolicy: { mode: "private-actor-storage-states", storage_state_count: 2, private_input_identity_sha256: sha256Value(privateInputIdentity) },
        plan: {
          schema: "wikijump.open43_issue1041_lifecycle_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_origin: session.pageOrigin,
          source_sha256: sha256Text(SOURCE),
          initial_tags: INITIAL_TAGS,
          expected_tags: EXPECTED_TAGS,
          actor_order: ["editable_member", "non_editable_member", "anonymous"],
          case_ids: OPEN43_ISSUE1041_CASE_IDS,
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup,
      });
    },
  });
}
