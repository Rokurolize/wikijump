import { CandidateHttpSession } from "./candidate-case-http.mjs";
import {
  requirePlainObject,
  sha256Text,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_MEMBERSHIP_JOIN_CASE_IDS = Object.freeze([
  "A1029_CENTRAL_PUBLIC_SEAMS",
  "A1029_TWO_TRANSACTION_CONTENTION",
]);

const ACTORS = Object.freeze(["administrator", "eligible", "pending", "banned"]);
const EDITABLE_SITE = "scpaiueouiuiuiui";
const MIRROR_SITE = "scp-wiki";
const SITE_HOST = `${EDITABLE_SITE}.wikijump.localhost`;
const JOIN_SOURCE = "[[module Join]]";
const JOIN_BODY = '<div class="join-box"><a href="javascript:;" onclick="WIKIDOT.page.listeners.join(event, \'unified\')">Join</a></div>';
const CONTENT_SOURCE = "Joined through the public membership action.";
const EXPECTED_REQUESTS = Object.freeze([
  ...ACTORS.map((actor) => [actor, "session_get"]),
  ["anonymous", "site_get"],
  ["anonymous", "site_get"],
  ["administrator", "member_get"],
  ["administrator", "page_get"],
  ["administrator", "page_get"],
  ["anonymous", "wikidot_page_preview"],
  ["eligible", "wikidot_page_preview"],
  ["administrator", "page_get"],
  ["administrator", "page_create"],
  ["anonymous", "page_view"],
  ["eligible", "page_view"],
  ["pending", "page_view"],
  ["banned", "page_view"],
  ["administrator", "page_view"],
  ["eligible", "membership_join"],
  ["eligible", "page_view"],
  ["eligible", "membership_join"],
  ["eligible", "page_view"],
  ["eligible", "membership_join"],
  ["eligible", "membership_join"],
  ["administrator", "member_get"],
  ["eligible", "page_view"],
  ["eligible", "page_create"],
  ["eligible", "page_get"],
]);

function runSlugs(runId) {
  const suffix = runId.slice("candidate-run-".length);
  return {
    join: `open43-membership-join-${suffix}`,
    content: `component:open43-member-${suffix}`,
  };
}

function requireCandidate(candidateIdentity) {
  const candidate = requirePlainObject(candidateIdentity?.candidate, "membership candidate identity");
  const endpoint = requirePlainObject(candidate.endpoint, "membership candidate endpoint");
  if (endpoint.host !== SITE_HOST || endpoint.port === 443 || candidate.port_443_published !== false) {
    throw new Error(`Open43 membership Join requires an exact non-standing ${SITE_HOST} candidate`);
  }
}

function actorPrivateInput(input, actor) {
  const value = requirePlainObject(input, "private membership candidate input");
  const selected = requirePlainObject(value.actors?.[actor], `private membership ${actor} actor`);
  return { ...value, actors: { editor: selected } };
}

function exactJoinAction(value, page, name) {
  if (!Array.isArray(value) || value.length !== 1) throw new Error(`${name} Join action denominator is not exact`);
  const action = value[0];
  if (
    action?.type !== "join"
    || action.page_id !== page.page_id
    || action.revision_id !== page.revision_id
    || action.index !== 0
    || !/^[0-9a-f]{32}$/u.test(action.fingerprint ?? "")
    || Object.keys(action).length !== 5
  ) {
    throw new Error(`${name} Join action descriptor is not exact`);
  }
  return structuredClone(action);
}

function foundView(value, name) {
  if (value?.type !== "found") throw new Error(`${name} did not return a found page`);
  return requirePlainObject(value.data, `${name} data`);
}

function visibleJoinEvidence(value, page, name, { action }) {
  const data = foundView(value, name);
  if (data.compiled_body_html !== JOIN_BODY) throw new Error(`${name} did not return the exact Join DOM`);
  const actions = action ? [exactJoinAction(data.membership_actions, page, name)] : data.membership_actions;
  if (!action && (!Array.isArray(actions) || actions.length !== 0)) throw new Error(`${name} exposed an active Join action`);
  return { body_sha256: sha256Text(data.compiled_body_html), actions: structuredClone(actions) };
}

function hiddenJoinEvidence(value, name) {
  const data = foundView(value, name);
  if (data.compiled_body_html !== "" || !Array.isArray(data.membership_actions) || data.membership_actions.length !== 0) {
    throw new Error(`${name} did not hide the complete Join surface`);
  }
  return { body_sha256: sha256Text(data.compiled_body_html), actions: [] };
}

class Open43MembershipJoinRun {
  #sessions;
  #resources;
  #slugs;
  #events = [];
  #siteId = null;
  #mirrorSiteId = null;
  #ownedPages = new Map();
  #membershipResource = null;
  #membershipMutationAttempted = false;

  constructor({ sessions, resources, slugs }) {
    this.#sessions = sessions;
    this.#resources = resources;
    this.#slugs = slugs;
  }

  get #administratorId() {
    return this.#sessions.administrator.editorUserId;
  }

  get #eligibleId() {
    return this.#sessions.eligible.editorUserId;
  }

  async #rpc(actor, method, params = {}, { siteId = this.#siteId, page, cleanup = false, anonymous = false } = {}) {
    const session = actor === "anonymous" ? this.#sessions.administrator : this.#sessions[actor];
    const before = session.events.length;
    try {
      return await session.rpc(method, params, {
        actor: actor === "anonymous" || anonymous ? "anonymous" : "editor",
        siteId: siteId ?? undefined,
        page,
        cleanup,
      });
    } finally {
      for (const event of session.events.slice(before)) {
        this.#events.push({ actor, service: event.service, operation: event.operation, method: event.method, response_status: event.response_status });
      }
    }
  }

  async #page(slug, { actor = "administrator", cleanup = false } = {}) {
    return await this.#rpc(actor, "page_get", {
      site_id: this.#siteId,
      page: slug,
      details: { wikitext: true, compiled: false },
    }, { page: slug, cleanup });
  }

  async #view(actor) {
    return await this.#rpc(actor, "page_view", {
      site_id: this.#siteId,
      session_token: actor === "anonymous" ? null : this.#sessions[actor].editorSessionToken,
      route: { slug: this.#slugs.join, extra: "" },
      locales: ["en-US", "en"],
    }, { page: this.#slugs.join });
  }

  async #createPage(actor, slug, title, wikitext) {
    const page = await this.#rpc(actor, "page_create", {
      site_id: this.#siteId,
      slug,
      title,
      alt_title: null,
      wikitext,
      layout: "wikidot",
      user_id: this.#sessions[actor].editorUserId,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 membership Join candidate fixture",
    }, { page: slug });
    if (!Number.isSafeInteger(page?.page_id) || !Number.isSafeInteger(page.revision_id) || page.site_id !== this.#siteId || page.slug !== slug) {
      throw new Error(`page_create did not return the public ${slug} identity`);
    }
    const owned = { page_id: page.page_id, revision_id: page.revision_id, site_id: this.#siteId, slug, title, wikitext };
    const resource = this.#resources.register("page", { ...owned, source_sha256: sha256Text(wikitext) });
    this.#ownedPages.set(slug, { owned, resource });
    return owned;
  }

  #matchesPage(page, owned) {
    return page?.page_id === owned.page_id
      && page.site_id === owned.site_id
      && page.slug === owned.slug
      && page.title === owned.title
      && page.wikitext === owned.wikitext;
  }

  async execute() {
    const sessionUsers = {};
    for (const actor of ACTORS) {
      const session = await this.#rpc(actor, "session_get", [this.#sessions[actor].editorSessionToken], { siteId: null, anonymous: true });
      if (session?.user_id !== this.#sessions[actor].editorUserId) throw new Error(`${actor} session identity drifted`);
      sessionUsers[actor] = session.user_id;
    }
    if (new Set(Object.values(sessionUsers)).size !== ACTORS.length) throw new Error("membership candidate actors are not distinct");

    const site = await this.#rpc("anonymous", "site_get", { site: EDITABLE_SITE }, { siteId: null });
    const mirror = await this.#rpc("anonymous", "site_get", { site: MIRROR_SITE }, { siteId: null });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== EDITABLE_SITE) throw new Error("editable membership candidate site is missing");
    if (!Number.isSafeInteger(mirror?.site_id) || mirror.slug !== MIRROR_SITE || mirror.site_id === site.site_id) throw new Error("mirror membership denial site is missing");
    this.#siteId = site.site_id;
    this.#mirrorSiteId = mirror.site_id;

    if (await this.#rpc("administrator", "member_get", { site_id: this.#siteId, user_id: this.#eligibleId }) !== null) {
      throw new Error("eligible membership candidate actor is already a member");
    }
    for (const slug of Object.values(this.#slugs)) {
      if (await this.#page(slug) !== null) throw new Error(`run-owned page namespace already exists: ${slug}`);
    }

    const anonymousPreview = await this.#rpc("anonymous", "wikidot_page_preview", {
      site_id: this.#siteId,
      title: "Open43 membership Join preview",
      wikitext: JOIN_SOURCE,
    });
    const eligiblePreview = await this.#rpc("eligible", "wikidot_page_preview", {
      site_id: this.#siteId,
      title: "Open43 membership Join preview",
      wikitext: JOIN_SOURCE,
    });
    for (const [name, preview] of [["anonymous preview", anonymousPreview], ["eligible preview", eligiblePreview]]) {
      if (preview?.body !== JOIN_BODY || !Array.isArray(preview.membership_actions) || preview.membership_actions.length !== 0) {
        throw new Error(`${name} did not prove exact non-mutating Join output`);
      }
    }
    if (await this.#page(this.#slugs.join) !== null) throw new Error("Join preview mutated public page state");

    const joinPage = await this.#createPage("administrator", this.#slugs.join, `candidate-case-owner:${this.#slugs.join}`, JOIN_SOURCE);
    const actorViews = {
      anonymous: visibleJoinEvidence(await this.#view("anonymous"), joinPage, "anonymous Join view", { action: false }),
      eligible: visibleJoinEvidence(await this.#view("eligible"), joinPage, "eligible Join view", { action: true }),
      pending: hiddenJoinEvidence(await this.#view("pending"), "pending Join view"),
      banned: hiddenJoinEvidence(await this.#view("banned"), "banned Join view"),
      administrator: hiddenJoinEvidence(await this.#view("administrator"), "administrator Join view"),
    };
    const action = actorViews.eligible.actions[0];

    let forgedDenied = false;
    try {
      await this.#rpc("eligible", "membership_join", {
        page_id: action.page_id,
        last_revision_id: action.revision_id,
        action_index: action.index,
        action_fingerprint: "0".repeat(32),
      }, { page: this.#slugs.join });
    } catch {
      forgedDenied = true;
    }
    const afterForged = visibleJoinEvidence(await this.#view("eligible"), joinPage, "Join view after forged binding", { action: true });

    let mirrorDenied = false;
    try {
      await this.#rpc("eligible", "membership_join", {
        page_id: action.page_id,
        last_revision_id: action.revision_id,
        action_index: action.index,
        action_fingerprint: action.fingerprint,
      }, { siteId: this.#mirrorSiteId, page: this.#slugs.join });
    } catch {
      mirrorDenied = true;
    }
    const afterMirror = visibleJoinEvidence(await this.#view("eligible"), joinPage, "Join view after mirror denial", { action: true });

    const joinParams = {
      page_id: action.page_id,
      last_revision_id: action.revision_id,
      action_index: action.index,
      action_fingerprint: action.fingerprint,
    };
    this.#membershipMutationAttempted = true;
    const contentionStart = this.#events.length;
    const eligibleSession = this.#sessions.eligible;
    const eligibleEventStart = eligibleSession.events.length;
    const attempts = await Promise.allSettled([0, 1].map(() => eligibleSession.rpc(
      "membership_join",
      joinParams,
      { actor: "editor", siteId: this.#siteId, page: this.#slugs.join },
    )));
    this.#events.push(...eligibleSession.events.slice(eligibleEventStart).map((event) => ({
      actor: "eligible",
      service: event.service,
      operation: event.operation,
      method: event.method,
      response_status: event.response_status,
    })));
    const attemptEvidence = attempts.map((attempt) => attempt.status === "fulfilled"
      ? { status: attempt.status, outcome: attempt.value }
      : { status: attempt.status, rpc_code: attempt.reason?.rpc?.code ?? null, rpc_message_sha256: attempt.reason?.rpc?.message_sha256 ?? null });
    const outcomes = attemptEvidence.filter(({ status }) => status === "fulfilled").map(({ outcome }) => outcome);
    const join = outcomes.find((outcome) => outcome === "joined");
    const repeat = outcomes.find((outcome) => outcome === "already_member");
    const membership = await this.#rpc("administrator", "member_get", { site_id: this.#siteId, user_id: this.#eligibleId });
    if (membership?.from_id !== this.#eligibleId || membership.dest_id !== this.#siteId) throw new Error("joined membership is missing at the public seam");
    const contentionRequests = structuredClone(this.#events.slice(contentionStart));
    this.#membershipResource = this.#resources.register("membership", { site_id: this.#siteId, user_id: this.#eligibleId });
    const joinedView = hiddenJoinEvidence(await this.#view("eligible"), "joined actor Join view");

    const contentPage = await this.#createPage("eligible", this.#slugs.content, `candidate-case-owner:${this.#slugs.content}`, CONTENT_SOURCE);
    const savedContent = await this.#page(this.#slugs.content, { actor: "eligible" });
    if (!this.#matchesPage(savedContent, contentPage)) throw new Error("joined actor page_create was not publicly readable");

    return [{
      case_id: OPEN43_MEMBERSHIP_JOIN_CASE_IDS[0],
      observations: {
        actors: sessionUsers,
        sites: { editable: { site_id: this.#siteId, slug: EDITABLE_SITE }, mirror: { site_id: this.#mirrorSiteId, slug: MIRROR_SITE } },
        preview: { anonymous_body_sha256: sha256Text(anonymousPreview.body), eligible_body_sha256: sha256Text(eligiblePreview.body), membership_actions: 0, page_after: null },
        views: actorViews,
        forged: { denied: forgedDenied, state_unchanged: sha256Value(afterForged) === sha256Value(actorViews.eligible) },
        mirror: { denied: mirrorDenied, state_unchanged: sha256Value(afterMirror) === sha256Value(actorViews.eligible) },
        transition: { first: join, repeat, membership: { from_id: membership.from_id, dest_id: membership.dest_id }, joined_view: joinedView },
        page_create: { page_id: savedContent.page_id, slug: savedContent.slug, source_sha256: sha256Text(savedContent.wikitext) },
        requests: structuredClone(this.#events),
      },
    }, {
      case_id: OPEN43_MEMBERSHIP_JOIN_CASE_IDS[1],
      observations: {
        actor: { user_id: this.#eligibleId },
        site: { site_id: this.#siteId, slug: EDITABLE_SITE },
        action,
        attempts: attemptEvidence,
        membership: { from_id: membership.from_id, dest_id: membership.dest_id },
        requests: contentionRequests,
      },
    }];
  }

  async cleanup() {
    const failures = [];
    let membershipAfter = null;
    const pagesAfter = {};
    try {
      const membership = this.#siteId === null ? null : await this.#rpc("administrator", "member_get", { site_id: this.#siteId, user_id: this.#eligibleId }, { cleanup: true });
      if (membership !== null && this.#membershipMutationAttempted) {
        if (membership.from_id !== this.#eligibleId || membership.dest_id !== this.#siteId) throw new Error("membership identity drifted during cleanup");
        await this.#rpc("administrator", "member_remove", {
          site_id: this.#siteId,
          user_id: this.#eligibleId,
          removed_by: this.#administratorId,
        }, { cleanup: true });
      }
      membershipAfter = this.#siteId === null ? null : await this.#rpc("administrator", "member_get", { site_id: this.#siteId, user_id: this.#eligibleId }, { cleanup: true });
      if (this.#membershipResource !== null && membershipAfter === null) this.#resources.release(this.#membershipResource, { member_get: null });
    } catch (error) {
      failures.push(error);
    }
    for (const slug of [this.#slugs.content, this.#slugs.join]) {
      try {
        const entry = this.#ownedPages.get(slug);
        const page = this.#siteId === null ? null : await this.#page(slug, { cleanup: true });
        if (page !== null && (!entry || !this.#matchesPage(page, entry.owned))) throw new Error(`owned page identity drifted during cleanup: ${slug}`);
        if (page !== null) {
          await this.#rpc("administrator", "page_delete", {
            site_id: this.#siteId,
            page: page.page_id,
            last_revision_id: page.revision_id,
            revision_comments: "Open43 membership Join candidate cleanup",
            user_id: this.#administratorId,
            ip_address: "127.0.0.1",
          }, { page: slug, cleanup: true });
        }
        pagesAfter[slug] = this.#siteId === null ? null : await this.#page(slug, { actor: "anonymous", cleanup: true });
        if (entry && pagesAfter[slug] === null) this.#resources.release(entry.resource, { page_get: null });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "membership Join public cleanup failed");
    return { membership_get: membershipAfter, pages: pagesAfter };
  }
}

function verifyCase(caseId, observations) {
  requirePlainObject(observations, `${caseId} observations`);
  if (caseId === OPEN43_MEMBERSHIP_JOIN_CASE_IDS[1]) {
    const attempts = observations.attempts;
    const outcomes = Array.isArray(attempts)
      ? attempts.filter(({ status }) => status === "fulfilled").map(({ outcome }) => outcome).sort()
      : [];
    if (
      attempts?.length !== 2
      || attempts.some(({ status }) => status !== "fulfilled")
      || JSON.stringify(outcomes) !== JSON.stringify(["already_member", "joined"])
      || observations.membership?.from_id !== observations.actor?.user_id
      || observations.membership.dest_id !== observations.site?.site_id
    ) {
      throw new Error(`${caseId} did not serialize concurrent self-join to one current relation`);
    }
    const requests = observations.requests;
    const expected = [["eligible", "membership_join"], ["eligible", "membership_join"], ["administrator", "member_get"]];
    if (!Array.isArray(requests) || requests.length !== expected.length) throw new Error(`${caseId} public request denominator is wrong`);
    requests.forEach((request, index) => {
      const [actor, operation] = expected[index];
      if (request.actor !== actor || request.service !== "deepwell" || request.operation !== operation || request.method !== "POST" || request.response_status !== 200) {
        throw new Error(`${caseId} public contention request evidence is wrong or out of order`);
      }
    });
    return {
      verified: true,
      committed_relations: 1,
      outcomes,
      stale_successes: 0,
    };
  }
  if (caseId !== OPEN43_MEMBERSHIP_JOIN_CASE_IDS[0]) throw new Error(`unsupported membership Join case: ${caseId}`);
  if (new Set(Object.values(observations.actors ?? {})).size !== ACTORS.length) throw new Error(`${caseId} actor identities are not distinct`);
  if (
    observations.preview?.anonymous_body_sha256 !== observations.views?.anonymous?.body_sha256
    || observations.preview.eligible_body_sha256 !== observations.views.eligible.body_sha256
    || observations.preview.membership_actions !== 0
    || observations.preview.page_after !== null
  ) {
    throw new Error(`${caseId} preview and saved Join surfaces are not exact`);
  }
  for (const actor of ["pending", "banned", "administrator"]) {
    if (observations.views?.[actor]?.body_sha256 !== sha256Text("") || observations.views[actor].actions?.length !== 0) throw new Error(`${caseId} ${actor} Join surface was not hidden`);
  }
  if (observations.views?.anonymous?.actions?.length !== 0 || observations.views?.eligible?.actions?.length !== 1) throw new Error(`${caseId} actor-bound action visibility is wrong`);
  if (observations.forged?.denied !== true || observations.forged.state_unchanged !== true) throw new Error(`${caseId} forged binding did not fail closed`);
  if (observations.mirror?.denied !== true || observations.mirror.state_unchanged !== true) throw new Error(`${caseId} mirror denial did not fail closed`);
  if (
    observations.transition?.first !== "joined"
    || observations.transition.repeat !== "already_member"
    || observations.transition.membership?.from_id !== observations.actors.eligible
    || observations.transition.membership.dest_id !== observations.sites.editable.site_id
    || observations.transition.joined_view?.body_sha256 !== sha256Text("")
  ) {
    throw new Error(`${caseId} open self-join transition is not exact`);
  }
  if (observations.page_create?.source_sha256 !== sha256Text(CONTENT_SOURCE)) throw new Error(`${caseId} joined actor did not create a public page`);
  const requests = observations.requests;
  if (!Array.isArray(requests) || requests.length !== EXPECTED_REQUESTS.length) throw new Error(`${caseId} public request denominator is wrong`);
  requests.forEach((request, index) => {
    const [actor, operation] = EXPECTED_REQUESTS[index];
    if (request.actor !== actor || request.service !== "deepwell" || request.operation !== operation || request.method !== "POST" || request.response_status !== 200) {
      throw new Error(`${caseId} public actor/request evidence is wrong or out of order`);
    }
  });
  return {
    verified: true,
    actors: ACTORS,
    exact_join_body_sha256: observations.views.eligible.body_sha256,
    forged_binding_denied: true,
    mirror_denied: true,
    outcomes: ["joined", "already_member"],
    joined_state_hidden: true,
    ordinary_page_create_verified: true,
  };
}

function verifyCleanup(proof, resources) {
  if (
    proof?.membership_get !== null
    || !proof.pages
    || Object.values(proof.pages).some((page) => page !== null)
    || !Array.isArray(resources)
    || resources.length !== 3
    || resources.some((resource) => resource.released !== true)
  ) {
    throw new Error("membership Join cleanup did not prove public absence and resource release");
  }
  return { public_absence_verified: true, membership_absent: true, pages_absent: true, resource_count: resources.length };
}

export function createOpen43MembershipJoinCandidateCaseSet({
  sessionFactory = ({ candidateIdentity, privateInput, signal }) => new CandidateHttpSession({ candidateIdentity, privateInput, signal }),
} = {}) {
  const sourceFiles = Object.freeze([
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/atomic-no-replace.mjs",
    "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-membership-join-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    "deepwell/src/endpoints/site_member.rs",
    "deepwell/src/services/membership/service.rs",
    "deepwell/src/services/membership/structs.rs",
    "deepwell/src/services/relation/site_member.rs",
    "deepwell/src/services/render/membership_actions.rs",
    "deepwell/src/services/render/runtime_modules.rs",
    "deepwell/src/services/render/service.rs",
    "framerail/src/lib/server/deepwell/membership.ts",
    "framerail/src/lib/wikidot/wikidot-membership-action-request.js",
    "framerail/src/lib/wikidot/wikidot-membership-actions.js",
    "framerail/src/routes/[slug]/[...extra]/+page.server.ts",
    "framerail/src/routes/[slug]/[...extra]/page.svelte",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-membership-join",
    caseIds: OPEN43_MEMBERSHIP_JOIN_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      requireCandidate(candidateIdentity);
      const sessions = Object.fromEntries(ACTORS.map((actor) => [actor, sessionFactory({
        actor,
        candidateIdentity,
        privateInput: actorPrivateInput(privateInput, actor),
        signal,
      })]));
      const actorIds = Object.fromEntries(ACTORS.map((actor) => [actor, sessions[actor].editorUserId]));
      if (Object.values(actorIds).some((userId) => !Number.isSafeInteger(userId)) || new Set(Object.values(actorIds)).size !== ACTORS.length) {
        throw new Error("private membership candidate actors must have distinct safe user IDs");
      }
      const slugs = runSlugs(runId);
      const execution = new Open43MembershipJoinRun({ sessions, resources, slugs });
      const runtimeBindings = [...new Map(ACTORS.flatMap((actor) => sessions[actor].requiredServiceBindings).map((binding) => [JSON.stringify(binding), binding])).values()];
      return Object.freeze({
        sourceFiles,
        runtimeBindings,
        privateInputIdentity: {
          actors: Object.fromEntries(ACTORS.map((actor) => [actor, sessions[actor].privateInputIdentity])),
          fixture_identity_sha256: sha256Value({ actor_ids: actorIds, site_slug: EDITABLE_SITE }),
        },
        plan: {
          schema: "wikijump.open43_membership_join_candidate_plan.v1",
          site_slug: EDITABLE_SITE,
          mirror_site_slug: MIRROR_SITE,
          actor_ids: actorIds,
          page_slugs: slugs,
          join_source_sha256: sha256Text(JOIN_SOURCE),
          content_source_sha256: sha256Text(CONTENT_SOURCE),
          candidate_observation_scope: "public Deepwell preview, actor page views, binding denials, membership transitions, member read, ordinary page creation, and cleanup",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase,
        verifyCleanup,
      });
    },
  });
}
