import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { Open43Issue1029JoinBrowserAdapter } from "./open43-issue1029-join-browser-adapter.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requirePlainObject,
  sha256Text,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_ISSUE1029_CASE_IDS = Object.freeze([
  "A1029_EXACT_BROWSER_TRANSITIONS",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const JOIN_PATH = "/system:join";
const JOIN_SOURCE = "[[module Join]]";
const OPERATIONS = Object.freeze(["click", "enter", "space", "repeated"]);
const ACTORS = Object.freeze(["administrator", "eligible"]);

function actorPrivateInput(input, actor) {
  const value = requirePlainObject(input, "private issue 1029 candidate input");
  const selected = requirePlainObject(value.actors?.[actor], `private issue 1029 ${actor} actor`);
  return { ...value, actors: { editor: selected } };
}

function requireInitial(value, plan, name) {
  const initial = requirePlainObject(value, `${name} initial`);
  const capture = requirePlainObject(initial.capture, `${name} initial capture`);
  if (
    capture.capture_error !== undefined ||
    capture.navigation_status !== 200 ||
    capture.input_url !== plan.page_url ||
    capture.final_url !== plan.page_url
  ) {
    throw new Error(`${name} did not capture the exact Join page`);
  }
  const documents = [capture.first_paint?.document, capture.document];
  for (const documentValue of documents) {
    const document = requirePlainObject(documentValue, `${name} capture document`);
    const probe = document.presence_probes?.find(({ id }) => id === "join-control");
    if (document.phase !== "domcontentloaded_immediate_observation" && document.phase !== "settled") throw new Error(`${name} capture phase is unknown`);
    if (probe?.count !== 1 || probe.rendered_count !== 1) throw new Error(`${name} capture Join control drifted`);
  }
  requireState(initial.state, plan, { joined: false }, `${name} initial`);
  return initial;
}

function requireState(value, plan, expected, name) {
  const state = requirePlainObject(value, `${name} state`);
  if (
    state.url !== plan.page_url ||
    state.path !== plan.page_path ||
    !Number.isSafeInteger(state.history_length) ||
    state.history_length < 1 ||
    state.join_control_count !== (expected.joined ? 0 : 1) ||
    state.source_disclosure !== false
  ) {
    throw new Error(`${name} public Join state drifted`);
  }
  if (!expected.anonymous) {
    if (state.focused_control !== (expected.focused ?? false)) throw new Error(`${name} Join focus drifted`);
    if (state.aria_busy !== (expected.busy ?? false)) throw new Error(`${name} Join busy state drifted`);
    if (!Array.isArray(state.busy_events)) throw new Error(`${name} Join busy log is missing`);
  }
  if (state.authored_join_calls !== 0) throw new Error(`${name} evaluated authored Join JavaScript`);
  return state;
}

function requireDenial(value, plan, name) {
  const denial = requirePlainObject(value, `${name} denial`);
  requireState(denial.before, plan, { joined: false, anonymous: true, focused: false, busy: false }, `${name} denial before`);
  requireState(denial.after, plan, { joined: false, anonymous: true, focused: false, busy: false }, `${name} denial after`);
  if (denial.mutation_request_count !== 0 || denial.before.busy_events?.length !== 0 || denial.after.busy_events?.length !== 0) {
    throw new Error(`${name} anonymous denial issued a mutation or a busy transition`);
  }
  return denial;
}

function requireHistory(value, plan, name) {
  const history = requirePlainObject(value, `${name} history`);
  const home = requirePlainObject(history.home, `${name} history home`);
  const back = requirePlainObject(history.back, `${name} history back`);
  if (home.path !== "/" || back.path !== "/") throw new Error(`${name} history did not return to the origin root`);
  const forward = requireState(history.forward, plan, { joined: false }, `${name} history forward`);
  if (forward.focused_control === true || forward.aria_busy === true || forward.busy_events?.length !== 0) {
    throw new Error(`${name} history forward replayed a Join activation`);
  }
  return history;
}

function requireOperation(value, plan, name) {
  const operation = requirePlainObject(value, `${name} operation`);
  const before = requireState(operation.before, plan, { joined: false, focused: true, busy: false }, `${name} before`);
  const after = requireState(operation.after, plan, { joined: true, focused: false, busy: false }, `${name} after`);
  if (before.history_length !== after.history_length) throw new Error(`${name} Join success changed the history length`);
  if (operation.mutation_request_count !== 1) throw new Error(`${name} did not issue exactly one membership mutation`);
  if (before.busy_events?.length !== 0 || JSON.stringify(after.busy_events) !== JSON.stringify([true])) {
    throw new Error(`${name} did not expose exactly one busy transition before the joined reload`);
  }
  return { before, after, mutation_request_count: operation.mutation_request_count };
}

function verifyCase(caseId, observations, plan) {
  if (caseId !== OPEN43_ISSUE1029_CASE_IDS[0]) throw new Error(`unknown issue 1029 case: ${caseId}`);
  const value = requirePlainObject(observations, `${caseId} observations`);
  const page = requirePlainObject(value.page, `${caseId} page`);
  if (page.path !== plan.page_path || page.source_sha256 !== sha256Text(JOIN_SOURCE)) throw new Error(`${caseId} Join page identity drifted`);
  const lifecycle = requirePlainObject(value.lifecycle, `${caseId} lifecycle`);
  requireInitial(lifecycle.initial, plan, caseId);
  requireDenial(lifecycle.denial, plan, caseId);
  requireHistory(lifecycle.history, plan, caseId);
  const operations = requirePlainObject(lifecycle.operations, `${caseId} operations`);
  if (JSON.stringify(Object.keys(operations)) !== JSON.stringify(OPERATIONS)) throw new Error(`${caseId} operation denominator drifted`);
  for (const name of OPERATIONS) requireOperation(operations[name], plan, `${caseId} ${name}`);
  const membership = requirePlainObject(value.membership, `${caseId} membership`);
  if (membership.from_id !== plan.eligible_user_id || membership.dest_id !== plan.site_id) {
    throw new Error(`${caseId} did not leave one joined membership at the public seam`);
  }
  return {
    verified: true,
    page_path: plan.page_path,
    operations: OPERATIONS.length,
    authored_join_calls: 0,
    joined_state_hidden: true,
  };
}

function verifyCleanup(proof, resources) {
  const value = requirePlainObject(proof, "issue 1029 cleanup proof");
  if (
    value.membership_get !== null ||
    value.public_absence_verified !== true ||
    !Array.isArray(resources) ||
    resources.length !== 1 ||
    resources.some((resource) => resource.released !== true)
  ) {
    throw new Error("issue 1029 cleanup did not prove membership absence and resource release");
  }
  return { verified: true, public_absence_verified: true, membership_absent: true };
}

class Open43Issue1029JoinRun {
  #sessions;
  #resources;
  #siteId = null;
  #membershipResource = null;
  #membershipAttempted = false;
  #plan = null;

  constructor({ sessions, resources }) {
    this.#sessions = sessions;
    this.#resources = resources;
  }

  get #eligibleId() {
    return this.#sessions.eligible.editorUserId;
  }

  async #rpc(actor, method, params = {}, { cleanup = false } = {}) {
    return await this.#sessions[actor].rpc(method, params, {
      actor: "editor",
      siteId: this.#siteId ?? undefined,
      cleanup,
    });
  }

  async #memberGet({ cleanup = false } = {}) {
    return await this.#rpc("administrator", "member_get", { site_id: this.#siteId, user_id: this.#eligibleId }, { cleanup });
  }

  async #resetMembership() {
    const membership = await this.#memberGet();
    if (membership === null) return;
    if (membership.from_id !== this.#eligibleId || membership.dest_id !== this.#siteId) {
      throw new Error("issue 1029 eligible membership identity drifted during reset");
    }
    await this.#rpc("administrator", "member_remove", {
      site_id: this.#siteId,
      user_id: this.#eligibleId,
      removed_by: this.#sessions.administrator.editorUserId,
    });
    if ((await this.#memberGet()) !== null) throw new Error("issue 1029 membership reset did not remove the relation");
  }

  async execute() {
    const sessionUsers = {};
    for (const actor of ACTORS) {
      const session = await this.#rpc(actor, "session_get", [this.#sessions[actor].editorSessionToken], {});
      if (session?.user_id !== this.#sessions[actor].editorUserId) throw new Error(`issue 1029 ${actor} session identity drifted`);
      sessionUsers[actor] = session.user_id;
    }
    if (sessionUsers.administrator === sessionUsers.eligible) throw new Error("issue 1029 browser actors are not distinct");

    const site = await this.#rpc("administrator", "site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) throw new Error("issue 1029 editable candidate site is missing");
    this.#siteId = site.site_id;

    const joinPage = await this.#rpc("administrator", "page_get", {
      site_id: this.#siteId,
      page: "system:join",
      details: { wikitext: true, compiled: false },
    });
    if (joinPage?.wikitext?.trim() !== JOIN_SOURCE) throw new Error("issue 1029 public self-join route is missing from the seeded candidate");
    if ((await this.#memberGet()) !== null) throw new Error("issue 1029 eligible browser actor is already a member");

    const pageUrl = new URL(JOIN_PATH, this.#sessions.eligible.pageOrigin).href;
    this.#membershipAttempted = true;
    const lifecycle = await this.#sessions.browser.run({
      pageUrl,
      pagePath: JOIN_PATH,
      reset: () => this.#resetMembership(),
    });
    const membership = await this.#memberGet();
    if (membership === null) throw new Error("issue 1029 joined membership is missing at the public seam");
    this.#membershipResource = this.#resources.register("membership", { site_id: this.#siteId, user_id: this.#eligibleId });
    this.#plan = {
      page_path: JOIN_PATH,
      page_url: new URL(JOIN_PATH, this.#sessions.eligible.pageOrigin).href,
      site_id: this.#siteId,
      eligible_user_id: this.#eligibleId,
    };
    return [{
      case_id: OPEN43_ISSUE1029_CASE_IDS[0],
      observations: {
        page: { path: JOIN_PATH, source_sha256: sha256Text(JOIN_SOURCE) },
        lifecycle,
        membership: { from_id: membership.from_id, dest_id: membership.dest_id },
      },
    }];
  }

  async cleanup() {
    let membershipAfter = null;
    if (this.#siteId !== null && this.#membershipAttempted) {
      const membership = await this.#memberGet({ cleanup: true });
      if (membership !== null) {
        if (membership.from_id !== this.#eligibleId || membership.dest_id !== this.#siteId) {
          throw new Error("issue 1029 membership identity drifted during cleanup");
        }
        await this.#rpc("administrator", "member_remove", {
          site_id: this.#siteId,
          user_id: this.#eligibleId,
          removed_by: this.#sessions.administrator.editorUserId,
        }, { cleanup: true });
      }
      membershipAfter = await this.#memberGet({ cleanup: true });
      if (this.#membershipResource !== null && membershipAfter === null) {
        this.#resources.release(this.#membershipResource, { member_get: null });
      }
    }
    return { membership_get: membershipAfter, public_absence_verified: membershipAfter === null };
  }

  verifyCase(caseId, observations) {
    if (this.#plan === null) throw new Error("issue 1029 case was not executed");
    return verifyCase(caseId, observations, this.#plan);
  }
}

const SOURCE_FILES = Object.freeze([
  ...new Set([
    ...STANDING_BROWSER_EXECUTION_MODULES,
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/open43-issue1029-join-browser-adapter.mjs",
    "install/local/wikidot-verification/src/open43-issue1029-join-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "framerail/src/lib/wikidot/wikidot-membership-actions.js",
    "framerail/src/lib/wikidot/wikidot-membership-action-request.js",
    "framerail/src/routes/[slug]/[...extra]/page.svelte",
    "deepwell/src/endpoints/site_member.rs",
    "deepwell/src/services/membership/service.rs",
    "deepwell/src/services/render/membership_actions.rs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]),
]);

export function createOpen43Issue1029JoinCandidateCaseSet({
  sessionFactory = (options) => new CandidateHttpSession(options),
  browserAdapterFactory = (options) => new Open43Issue1029JoinBrowserAdapter(options),
} = {}) {
  return Object.freeze({
    id: "open43-issue1029-join",
    caseIds: OPEN43_ISSUE1029_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      const candidate = requirePlainObject(candidateIdentity?.candidate, "issue 1029 candidate identity");
      const endpoint = requirePlainObject(candidate.endpoint, "issue 1029 candidate endpoint");
      if (endpoint.host !== SITE_HOST || endpoint.port === 443 || candidate.port_443_published !== false) {
        throw new Error(`issue 1029 requires an exact non-standing ${SITE_HOST} candidate`);
      }
      const sessions = Object.fromEntries(ACTORS.map((actor) => [actor, sessionFactory({
        candidateIdentity,
        privateInput: actorPrivateInput(privateInput, actor),
        signal,
      })]));
      const eligibleId = sessions.eligible.editorUserId;
      const administratorId = sessions.administrator.editorUserId;
      if (!Number.isSafeInteger(eligibleId) || !Number.isSafeInteger(administratorId) || eligibleId === administratorId) {
        throw new Error("issue 1029 private actors must have distinct safe user IDs");
      }
      const pageOrigin = sessions.eligible.pageOrigin;
      if (pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("issue 1029 session did not bind the candidate origin");
      const storageState = (actor) => {
        if (actor === "anonymous") return { cookies: [], origins: [] };
        return {
          cookies: [{ name: "wikijump_token", value: sessions[actor].editorSessionToken, url: pageOrigin, httpOnly: true, secure: true, sameSite: "Lax" }],
          origins: [],
        };
      };
      sessions.browser = browserAdapterFactory({
        browserContexts: candidateBrowserContexts,
        storageState,
      });
      const execution = new Open43Issue1029JoinRun({ sessions, resources });
      const privateInputIdentity = {
        eligible_user_id: eligibleId,
        administrator_user_id: administratorId,
        eligible_session_sha256: sha256Value(sessions.eligible.privateInputIdentity),
      };
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: [...new Map(ACTORS.flatMap((actor) => sessions[actor].requiredServiceBindings).map((binding) => [JSON.stringify(binding), binding])).values()],
        privateInputIdentity,
        browserCredentialPolicy: { mode: "private-actor-storage-states", storage_state_count: 2, private_input_identity_sha256: sha256Value(privateInputIdentity) },
        plan: {
          schema: "wikijump.open43_issue1029_join_candidate_plan.v1",
          site_slug: SITE_SLUG,
          join_path: JOIN_PATH,
          join_source_sha256: sha256Text(JOIN_SOURCE),
          page_origin: pageOrigin,
          actor_user_ids: { eligible: eligibleId, administrator: administratorId },
          operations: OPERATIONS,
          case_ids: OPEN43_ISSUE1029_CASE_IDS,
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup,
      });
    },
  });
}
