import { createHash } from "node:crypto";
import net from "node:net";

import { requestCandidateCaseHttp } from "./candidate-case-http.mjs";
import { deepwellRpcAuthorization } from "./deepwell-rpc-auth.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  sha256Text,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_MEMBERSHIP_CASE_IDS = Object.freeze([
  "A1060_ORDINARY_MEMBER_PAGE_CREATE",
  "A1033_CENTRAL_STATIC_MODULE_MATRIX",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const ADMINISTRATOR_USER_ID = -1;
const OPAQUE_VALUES = Object.freeze([
  "candidate-invitation-secret",
  "candidate-unsubscribe-secret",
]);
const PAGE_SOURCE = [
  "MEMBERSHIP_APPLY_START",
  "[[module MembershipApply]]",
  "MEMBERSHIP_APPLY_END",
  "MEMBERSHIP_PASSWORD_START",
  "[[module MembershipByPassword]]",
  "MEMBERSHIP_PASSWORD_END",
  "INVITATION_START",
  `[[module MembershipEmailInvitation token="${OPAQUE_VALUES[0]}"]]`,
  "INVITATION_END",
  "UNSUBSCRIBE_START",
  `[[module AnonymousNotificationsUnsubscribe token="${OPAQUE_VALUES[1]}"]]`,
  "UNSUBSCRIBE_END",
  "SEND_INVITATIONS_START",
  "[[module SendInvitations]]",
  "SEND_INVITATIONS_END",
].join("\n");
const JOIN_PAGE = "system:join";
const JOIN_CONTROL = "WIKIDOT.page.listeners.join";
const EXPECTED_REQUESTS = Object.freeze([
  ["site_get", "anonymous"],
  ["member_get", "registered"],
  ["page_get", "registered"],
  ["page_view", "registered"],
  ["membership_join", "registered"],
  ["member_get", "registered"],
  ["admin_view", "registered"],
  ["page_view", "registered"],
  ["page_create", "registered"],
  ["page_get", "registered"],
  ["page_view", "registered"],
]);
const STATIC_EXPECTED_REQUESTS = Object.freeze([
  ["page_view", "registered"],
  ["wikidot_page_preview", "anonymous"],
  ["wikidot_page_preview", "registered"],
  ["page_view", "anonymous"],
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function actor(value, name) {
  const input = requirePlainObject(value, `private input ${name} actor`);
  if (!Number.isSafeInteger(input.user_id) || typeof input.session_token !== "string" || input.session_token.length === 0 || /[\r\n]/u.test(input.session_token)) {
    throw new Error(`private input ${name} actor is invalid`);
  }
  return Object.freeze({ userId: input.user_id, sessionToken: input.session_token });
}

function loopbackRpcUrl(value) {
  const url = new URL(requireNonEmptyString(value, "private input deepwell_rpc_url"));
  const address = url.hostname.replace(/^\[(.*)\]$/u, "$1");
  const family = net.isIP(address);
  if (url.protocol !== "http:" || url.pathname !== "/jsonrpc" || url.search || url.hash || !url.port || !((family === 4 && address.startsWith("127.")) || (family === 6 && address === "::1"))) {
    throw new Error("private input deepwell_rpc_url must be one loopback HTTP JSON-RPC endpoint");
  }
  return { url, address };
}

class Open43MembershipCandidateSession {
  #rpc;
  #rpcAuthorization;
  #rpcToken;
  #actors;
  #request;
  #signal;
  #rpcId = 1;
  #events = [];

  constructor({ privateInput: rawInput, requestImpl = requestCandidateCaseHttp, signal = null }) {
    const input = requirePlainObject(rawInput, "private Open43 membership input");
    this.#rpc = loopbackRpcUrl(input.deepwell_rpc_url);
    this.#rpcToken = requireNonEmptyString(input.deepwell_rpc_token, "private input deepwell_rpc_token");
    this.#rpcAuthorization = deepwellRpcAuthorization(this.#rpcToken);
    this.#actors = {
      registered: actor(input.actors?.registered, "registered"),
      administrator: actor(input.actors?.administrator, "administrator"),
    };
    if (this.#actors.registered.userId === ADMINISTRATOR_USER_ID || this.#actors.administrator.userId !== ADMINISTRATOR_USER_ID) {
      throw new Error("membership candidate actors must be one ordinary user and the cleanup administrator");
    }
    this.#request = requestImpl;
    this.#signal = signal;
  }

  get registeredUserId() { return this.#actors.registered.userId; }
  get registeredSessionToken() { return this.#actors.registered.sessionToken; }
  get administratorUserId() { return this.#actors.administrator.userId; }
  get events() { return structuredClone(this.#events); }
  get requiredServiceBindings() {
    return [{ role: "deepwell", container_port: "2747/tcp", host_address: this.#rpc.address, host_port: Number(this.#rpc.url.port) }];
  }
  get privateInputIdentity() {
    return {
      deepwell_rpc_url: this.#rpc.url.href,
      deepwell_rpc_token_sha256: sha256(this.#rpcToken),
      registered_user_id: this.registeredUserId,
      administrator_user_id: this.administratorUserId,
      registered_session_sha256: sha256(this.#actors.registered.sessionToken),
      administrator_session_sha256: sha256(this.#actors.administrator.sessionToken),
    };
  }

  async verifyRegisteredSession() {
    const session = await this.rpc("session_get", [this.registeredSessionToken], { actor: "anonymous" });
    if (session?.user_id !== this.registeredUserId) throw new Error("registered candidate session has the wrong user identity");
    const user = await this.rpc("user_get", { user: this.registeredUserId }, { actor: "registered" });
    if (user?.user_id !== this.registeredUserId || user.user_type !== "regular") throw new Error("registered candidate actor is not a regular user");
    return { user_id: user.user_id, user_type: user.user_type };
  }

  async rpc(method, params = {}, { actor: actorName = "registered", siteId, page, cleanup = false } = {}) {
    const selected = actorName === "anonymous" ? null : this.#actors[actorName];
    if (actorName !== "anonymous" && !selected) throw new Error(`unknown membership RPC actor: ${actorName}`);
    const response = await this.#request({
      url: this.#rpc.url,
      method: "POST",
      headers: {
        authorization: this.#rpcAuthorization,
        "content-type": "application/json",
        ...(selected ? { "x-deepwell-session-token": selected.sessionToken } : {}),
        ...(siteId === undefined ? {} : { "x-deepwell-site-id": siteId }),
        ...(page === undefined ? {} : { "x-deepwell-page": page }),
      },
      body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: this.#rpcId++, method, params })),
      signal: cleanup ? null : this.#signal,
    });
    this.#events.push({ service: "deepwell", operation: method, method: "POST", response_status: response.status, actor: actorName });
    let payload;
    try { payload = JSON.parse(response.body); } catch { throw new Error(`${method} returned non-JSON at the public Deepwell seam`); }
    if (response.status !== 200 || payload?.error !== undefined) throw new Error(`${method} failed at the public Deepwell seam`);
    return payload.result;
  }
}

function pageSlug(runId) {
  return `component:membership-candidate-${runId.slice("candidate-run-".length)}`;
}

function found(value, name) {
  if (value?.type !== "found") throw new Error(`${name} did not return a found public page view`);
  return requirePlainObject(value.data, `${name} data`);
}

function joinDescriptor(view) {
  const data = found(view, "pre-join page_view");
  if (!String(data.compiled_body_html).includes(JOIN_CONTROL) || !Array.isArray(data.membership_actions) || data.membership_actions.length !== 1) {
    throw new Error("eligible registered user did not receive one executable Join control");
  }
  const action = requirePlainObject(data.membership_actions[0], "Join descriptor");
  if (action.type !== "join" || action.page_id !== data.page?.page_id || action.revision_id !== data.page_revision?.revision_id || !Number.isSafeInteger(action.index) || action.index < 0 || !/^[0-9a-f]{32}$/u.test(action.fingerprint ?? "")) {
    throw new Error("saved Join descriptor is not bound to the public join page revision");
  }
  return action;
}

function membershipMatches(value, siteId, userId) {
  return value?.dest_id === siteId && value.from_id === userId;
}

function staticModuleEvidence(value, name, actorState) {
  const body = requireNonEmptyString(value, `${name} body`);
  for (const marker of [
    "MEMBERSHIP_APPLY_START",
    "MEMBERSHIP_APPLY_END",
    "MEMBERSHIP_PASSWORD_START",
    "MEMBERSHIP_PASSWORD_END",
    "INVITATION_START",
    "INVITATION_END",
    "UNSUBSCRIBE_START",
    "UNSUBSCRIBE_END",
    "SEND_INVITATIONS_START",
    "SEND_INVITATIONS_END",
  ]) {
    if (!body.includes(marker)) throw new Error(`${name} omitted ${marker}`);
  }
  for (const expected of [
    '<div id="membership-by-password-box">',
    '<div id="membership-email-invitation-box">',
    "Sorry, the invitation could not be found.",
    "Invalid indentification token.",
    "Inviting users has been disabled due to severe abuse.",
  ]) {
    if (!body.includes(expected)) throw new Error(`${name} omitted the observed ${expected} output`);
  }
  if (actorState === "anonymous") {
    if (!body.includes('<div id="membership-apply-box">') || !body.includes("You need to have a Wikidot.com account and be signed to apply for membership.") || !body.includes("Please create an account and/or sign in first.")) {
      throw new Error(`${name} omitted the observed anonymous membership state`);
    }
  } else if (actorState === "member") {
    if (!body.includes("You can not apply.<br/>") || !body.includes("already are a member of this site.")) {
      throw new Error(`${name} omitted the observed current-member password state`);
    }
  } else {
    throw new Error(`${name} actor state is unsupported`);
  }
  for (const forbidden of ["[[module", ...OPAQUE_VALUES]) {
    if (body.includes(forbidden)) throw new Error(`${name} exposed forbidden opaque source ${forbidden}`);
  }
  return {
    actor_state: actorState,
    body_sha256: sha256Text(body),
    body_bytes: Buffer.byteLength(body),
    opaque_values_absent: true,
  };
}

class Open43MembershipRun {
  #session;
  #resources;
  #pageSlug;
  #title;
  #siteId = null;
  #joinAttempted = false;
  #pageCreateAttempted = false;
  #membershipResource = null;
  #pageResource = null;
  #ownedPage = null;

  constructor({ session, resources, pageSlug: slug }) {
    this.#session = session;
    this.#resources = resources;
    this.#pageSlug = slug;
    this.#title = `candidate-case-owner:${slug}`;
  }

  async #rpc(method, params = {}, { actor = "registered", page, cleanup = false } = {}) {
    return await this.#session.rpc(method, params, { actor, siteId: this.#siteId ?? undefined, page, cleanup });
  }

  async #page({ actor = "registered", cleanup = false } = {}) {
    return await this.#rpc("page_get", { site_id: this.#siteId, page: this.#pageSlug, details: { wikitext: true, compiled: false } }, { actor, page: this.#pageSlug, cleanup });
  }

  async #membership({ actor = "registered", cleanup = false } = {}) {
    return await this.#rpc("member_get", { site_id: this.#siteId, user_id: this.#session.registeredUserId }, { actor, cleanup });
  }

  async #view(slug, { actor = "registered" } = {}) {
    return await this.#rpc("page_view", {
      site_id: this.#siteId,
      session_token: actor === "anonymous" ? null : this.#session.registeredSessionToken,
      route: { slug, extra: "" },
      locales: ["en-US", "en"],
    }, { actor, page: slug });
  }

  #matchesOwnedPage(page) {
    return page?.site_id === this.#siteId
      && page.slug === this.#pageSlug
      && page.title === this.#title
      && page.wikitext === PAGE_SOURCE
      && (this.#ownedPage === null || page.page_id === this.#ownedPage.page_id);
  }

  async execute() {
    const actor = await this.#session.verifyRegisteredSession();
    const eventStart = this.#session.events.length;
    const site = await this.#rpc("site_get", { site: SITE_SLUG }, { actor: "anonymous" });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) throw new Error("editable membership candidate site is missing");
    this.#siteId = site.site_id;
    if (await this.#membership() !== null) throw new Error("registered candidate actor is already a site member");
    if (await this.#page() !== null) throw new Error("run-owned membership page namespace already exists");

    const beforeJoin = await this.#view(JOIN_PAGE);
    const action = joinDescriptor(beforeJoin);
    this.#joinAttempted = true;
    const joinOutcome = await this.#rpc("membership_join", {
      page_id: action.page_id,
      last_revision_id: action.revision_id,
      action_index: action.index,
      action_fingerprint: action.fingerprint,
    }, { page: JOIN_PAGE });
    if (joinOutcome !== "joined") throw new Error("registered candidate actor did not self-join exactly once");
    const membership = await this.#membership();
    if (!membershipMatches(membership, this.#siteId, actor.user_id)) throw new Error("self-join did not create the public membership relation");
    this.#membershipResource = this.#resources.register("site-membership", { site_id: this.#siteId, user_id: actor.user_id, accepted: "self_joined" });

    const adminView = await this.#rpc("admin_view", { site_id: this.#siteId, session_token: this.#session.registeredSessionToken, locales: ["en-US", "en"] }, { page: undefined });
    if (adminView?.type !== "admin_permissions") throw new Error("self-joined actor unexpectedly has site administrator access");

    const afterJoin = found(await this.#view(JOIN_PAGE), "post-join page_view");
    if (String(afterJoin.compiled_body_html).includes(JOIN_CONTROL) || !Array.isArray(afterJoin.membership_actions) || afterJoin.membership_actions.length !== 0) {
      throw new Error("joined member still received the Join control or descriptor");
    }

    this.#pageCreateAttempted = true;
    const created = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug: this.#pageSlug,
      title: this.#title,
      alt_title: null,
      wikitext: PAGE_SOURCE,
      layout: "wikidot",
      user_id: actor.user_id,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 membership candidate page",
    }, { page: this.#pageSlug });
    if (!Number.isSafeInteger(created?.page_id) || !Number.isSafeInteger(created.revision_id) || created.slug !== this.#pageSlug) throw new Error("ordinary member page_create did not return its public identity");
    this.#ownedPage = { page_id: created.page_id, revision_id: created.revision_id };
    this.#pageResource = this.#resources.register("page", { site_id: this.#siteId, page_id: created.page_id, slug: this.#pageSlug, title: this.#title, source_sha256: sha256Text(PAGE_SOURCE) });
    const saved = await this.#page();
    if (!this.#matchesOwnedPage(saved) || saved.revision_id !== created.revision_id || saved.revision_user_id !== actor.user_id) throw new Error("ordinary member page did not round-trip through page_get");
    const readback = found(await this.#view(this.#pageSlug), "created page_view");
    if (readback.page?.page_id !== created.page_id || readback.page?.slug !== this.#pageSlug || readback.page_revision?.revision_id !== created.revision_id || readback.page_revision?.user_id !== actor.user_id || readback.wikitext !== PAGE_SOURCE) {
      throw new Error("ordinary member page did not round-trip through page_view");
    }

    const membershipRequests = this.#session.events.slice(eventStart);
    const staticRequestStart = this.#session.events.length - 1;
    const anonymousPreview = await this.#rpc("wikidot_page_preview", {
      site_id: this.#siteId,
      title: "Open43 static membership anonymous preview",
      wikitext: PAGE_SOURCE,
    }, { actor: "anonymous" });
    const memberPreview = await this.#rpc("wikidot_page_preview", {
      site_id: this.#siteId,
      title: "Open43 static membership member preview",
      wikitext: PAGE_SOURCE,
    });
    const anonymousSaved = found(await this.#view(this.#pageSlug, { actor: "anonymous" }), "anonymous static membership page_view");
    const staticEvidence = {
      preview: {
        anonymous: staticModuleEvidence(anonymousPreview?.body, "anonymous preview", "anonymous"),
        member: staticModuleEvidence(memberPreview?.body, "member preview", "member"),
      },
      saved: {
        anonymous: staticModuleEvidence(anonymousSaved.compiled_body_html, "anonymous saved page", "anonymous"),
        member: staticModuleEvidence(readback.compiled_body_html, "member saved page", "member"),
      },
    };
    if (staticEvidence.preview.anonymous.body_sha256 !== staticEvidence.saved.anonymous.body_sha256 || staticEvidence.preview.member.body_sha256 !== staticEvidence.saved.member.body_sha256) {
      throw new Error("static membership preview and saved-page output differ by actor");
    }

    return [
      {
        case_id: OPEN43_MEMBERSHIP_CASE_IDS[0],
        observations: {
          actor: { ...actor, admin_view_type: adminView.type },
          join: {
            before: { page_id: action.page_id, revision_id: action.revision_id, descriptor_type: action.type, control_visible: true },
            outcome: joinOutcome,
            membership: { site_id: membership.dest_id, user_id: membership.from_id, accepted: membership.metadata?.accepted?.cause ?? null },
            after: { control_visible: false, descriptor_count: afterJoin.membership_actions.length },
          },
          page: {
            slug: this.#pageSlug,
            category: "component",
            created: { page_id: created.page_id, revision_id: created.revision_id, revision_user_id: saved.revision_user_id },
            readback: { page_id: readback.page.page_id, revision_id: readback.page_revision.revision_id, revision_user_id: readback.page_revision.user_id, source_sha256: sha256Text(readback.wikitext) },
          },
          requests: membershipRequests,
        },
      },
      {
        case_id: OPEN43_MEMBERSHIP_CASE_IDS[1],
        observations: {
          actor: { user_id: actor.user_id, membership: membership.metadata?.accepted?.cause ?? null },
          ...staticEvidence,
          requests: this.#session.events.slice(staticRequestStart),
        },
      },
    ];
  }

  async cleanup() {
    const failures = [];
    let pageAfter = null;
    let membershipAfter = null;
    try {
      if (this.#siteId !== null && this.#pageCreateAttempted) {
        const page = await this.#page({ actor: "administrator", cleanup: true });
        if (page !== null && !this.#matchesOwnedPage(page)) throw new Error("run-owned membership page identity drifted during cleanup");
        if (page !== null) {
          await this.#rpc("page_delete", {
            site_id: this.#siteId,
            page: page.page_id,
            last_revision_id: page.revision_id,
            revision_comments: "Open43 membership candidate cleanup",
            user_id: this.#session.administratorUserId,
            ip_address: "127.0.0.1",
          }, { actor: "administrator", cleanup: true });
        }
        pageAfter = await this.#page({ actor: "administrator", cleanup: true });
        if (this.#pageResource !== null && pageAfter === null) this.#resources.release(this.#pageResource, { page_get: null });
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      if (this.#siteId !== null && this.#joinAttempted) {
        const membership = await this.#membership({ actor: "administrator", cleanup: true });
        if (membership !== null && !membershipMatches(membership, this.#siteId, this.#session.registeredUserId)) throw new Error("run-owned membership identity drifted during cleanup");
        if (membership !== null) {
          await this.#rpc("member_remove", { site_id: this.#siteId, user_id: this.#session.registeredUserId, removed_by: this.#session.administratorUserId }, { actor: "administrator", cleanup: true });
        }
        membershipAfter = await this.#membership({ actor: "administrator", cleanup: true });
        if (this.#membershipResource !== null && membershipAfter === null) this.#resources.release(this.#membershipResource, { member_get: null });
      }
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "membership candidate cleanup failed");
    return { page_get: pageAfter, member_get: membershipAfter };
  }
}

function verifyCase(caseId, observations) {
  requirePlainObject(observations, `${caseId} observations`);
  if (caseId === OPEN43_MEMBERSHIP_CASE_IDS[1]) {
    if (!Number.isSafeInteger(observations.actor?.user_id) || observations.actor.membership !== "self_joined") throw new Error(`${caseId} did not use the controlled current member`);
    for (const actorState of ["anonymous", "member"]) {
      if (observations.preview?.[actorState]?.actor_state !== actorState || observations.saved?.[actorState]?.actor_state !== actorState || observations.preview[actorState].body_sha256 !== observations.saved[actorState].body_sha256 || observations.preview[actorState].opaque_values_absent !== true || observations.saved[actorState].opaque_values_absent !== true) {
        throw new Error(`${caseId} did not prove equal preview and saved-page ${actorState} output`);
      }
    }
    if (!Array.isArray(observations.requests) || observations.requests.length !== STATIC_EXPECTED_REQUESTS.length) throw new Error(`${caseId} public request denominator is wrong`);
    observations.requests.forEach((request, index) => {
      const [operation, actor] = STATIC_EXPECTED_REQUESTS[index];
      if (request?.service !== "deepwell" || request.operation !== operation || request.method !== "POST" || request.response_status !== 200 || request.actor !== actor) throw new Error(`${caseId} public requests are wrong or out of order`);
    });
    return { verified: true, actor_states: ["anonymous", "member"], preview_and_saved_page_equal: true, opaque_values_absent: true };
  }
  if (caseId !== OPEN43_MEMBERSHIP_CASE_IDS[0]) throw new Error(`unsupported Open43 membership case: ${caseId}`);
  if (!Number.isSafeInteger(observations.actor?.user_id) || observations.actor.user_id === ADMINISTRATOR_USER_ID || observations.actor.user_type !== "regular" || observations.actor.admin_view_type !== "admin_permissions") throw new Error(`${caseId} actor is not an ordinary registered non-administrator`);
  if (observations.join?.before?.control_visible !== true || observations.join.before.descriptor_type !== "join" || observations.join.outcome !== "joined" || observations.join.after?.control_visible !== false || observations.join.after.descriptor_count !== 0) throw new Error(`${caseId} did not prove the public self-join transition`);
  if (observations.join.membership?.user_id !== observations.actor.user_id || observations.join.membership.accepted !== "self_joined") throw new Error(`${caseId} did not prove self-joined membership`);
  if (!String(observations.page?.slug).startsWith("component:membership-candidate-") || observations.page.category !== "component" || observations.page.created?.revision_user_id !== observations.actor.user_id || observations.page.readback?.revision_user_id !== observations.actor.user_id || observations.page.created.page_id !== observations.page.readback.page_id || observations.page.created.revision_id !== observations.page.readback.revision_id || observations.page.readback.source_sha256 !== sha256Text(PAGE_SOURCE)) {
    throw new Error(`${caseId} did not prove ordinary-member component page creation and readback`);
  }
  if (!Array.isArray(observations.requests) || observations.requests.length !== EXPECTED_REQUESTS.length) throw new Error(`${caseId} public request denominator is wrong`);
  observations.requests.forEach((request, index) => {
    const [operation, actor] = EXPECTED_REQUESTS[index];
    if (request?.service !== "deepwell" || request.operation !== operation || request.method !== "POST" || request.response_status !== 200 || request.actor !== actor) throw new Error(`${caseId} public requests are wrong or out of order`);
  });
  return { verified: true, registered_user_id: observations.actor.user_id, joined_without_administrator_fallback: true, component_page_created_and_read_back: true };
}

function verifyCleanup(proof, resources) {
  if (proof?.page_get !== null || proof?.member_get !== null || !Array.isArray(resources) || resources.length !== 2 || resources.some(({ released }) => released !== true)) {
    throw new Error("membership cleanup did not prove page and membership absence");
  }
  return { public_absence_verified: true, page_absent: true, membership_absent: true, resource_count: resources.length };
}

export function createOpen43MembershipCandidateCaseSet({
  sessionFactory = (options) => new Open43MembershipCandidateSession(options),
} = {}) {
  const sourceFiles = Object.freeze([
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-membership-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "deepwell/src/database/seeder/data.rs",
    "deepwell/src/endpoints/page.rs",
    "deepwell/src/endpoints/site_member.rs",
    "deepwell/src/services/membership/service.rs",
    "deepwell/src/services/render/runtime_modules.rs",
    "deepwell/src/services/view/service.rs",
    "docs/wikidot-specifications/specifications/module/module-anonymousnotificationsunsubscribe.md",
    "docs/wikidot-specifications/specifications/module/module-membershipapply.md",
    "docs/wikidot-specifications/specifications/module/module-membershipbypassword.md",
    "docs/wikidot-specifications/specifications/module/module-membershipemailinvitation.md",
    "docs/wikidot-specifications/specifications/module/module-sendinvitations.md",
    "install/local/wikidot-verification/artifacts/membershipbypassword-role-preview-probe.json",
    "install/local/wikidot-verification/artifacts/simpletodo-sendinvitations-live-preview.json",
    "install/local/wikidot-verification/artifacts/static-account-modules-live-preview-and-pageview.json",
    "deepwell/tests/role.rs",
    "framerail/src/lib/server/deepwell/membership.ts",
    "framerail/src/lib/wikidot/wikidot-membership-actions.js",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-membership",
    caseIds: OPEN43_MEMBERSHIP_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      const candidate = requirePlainObject(candidateIdentity?.candidate, "membership candidate identity");
      if (candidate.endpoint?.host !== SITE_HOST || candidate.endpoint.port === 443 || candidate.port_443_published !== false) throw new Error(`Open43 membership requires an exact non-standing ${SITE_HOST} candidate`);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      const slug = pageSlug(runId);
      const execution = new Open43MembershipRun({ session, resources, pageSlug: slug });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.open43_membership_candidate_plan.v1",
          site_slug: SITE_SLUG,
          join_page: JOIN_PAGE,
          page_slug: slug,
          registered_user_id: session.registeredUserId,
          administrator_user_id: session.administratorUserId,
          execution_actor: "registered",
          administrator_scope: "cleanup-only",
          source_sha256: sha256Text(PAGE_SOURCE),
          candidate_observation_scope: "public Deepwell session, membership, anonymous/member preview, page-create, actor-specific page-readback, and cleanup RPC responses",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase,
        verifyCleanup,
      });
    },
  });
}
