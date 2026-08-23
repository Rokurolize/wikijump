import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { Open43Issue1060RegisterJoinCreateBrowserAdapter } from "./open43-issue1060-register-join-browser-adapter.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requirePlainObject,
  sha256Text,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_ISSUE1060_CASE_IDS = Object.freeze([
  "A1060_BROWSER_REGISTER_JOIN_CREATE",
  "A1060_CONCURRENT_SELF_JOIN_AND_CREATE",
  "A1060_FRESH_SEED_CARGO_MATRIX",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const JOIN_PATH = "/system:join";
const JOIN_SOURCE = "[[module Join]]";
const CONTENT_SOURCE = "Created by the public self-join browser candidate.";
const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);
const ACTORS = Object.freeze(["administrator", "eligible"]);
const CARGO_TIMEOUT_MS = 1_800_000;
const FRESH_SEED_COMMANDS = Object.freeze([
  Object.freeze([
    "cargo", "test", "--manifest-path", "deepwell/Cargo.toml",
    "--lib", "database::seeder::data::tests::editable_site_seeds_the_public_self_join_route",
    "--", "--exact", "--nocapture",
  ]),
  Object.freeze([
    "cargo", "test", "--manifest-path", "deepwell/Cargo.toml",
    "--test", "role", "ordinary_user_joins_only_the_editable_site_then_creates_a_page",
    "--", "--exact", "--nocapture",
  ]),
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function actorPrivateInput(input, actor) {
  const value = requirePlainObject(input, "private issue 1060 candidate input");
  const selected = requirePlainObject(value.actors?.[actor], `private issue 1060 ${actor} actor`);
  return { ...value, actors: { editor: selected } };
}

function cargoEnv(input) {
  const value = requirePlainObject(input, "private issue 1060 candidate input");
  const env = requirePlainObject(value.cargo_env, "private issue 1060 cargo_env");
  for (const [name, entry] of Object.entries(env)) {
    if (typeof entry !== "string" || entry.length === 0 || /\r|\n/u.test(entry)) {
      throw new Error(`private issue 1060 cargo_env.${name} must be a single-line non-empty string`);
    }
  }
  return env;
}

async function defaultCargoRunner({ commands, cwd, env, timeoutMs }) {
  const results = [];
  for (const command of commands) {
    const started = Date.now();
    const [executable, ...args] = command;
    const result = await new Promise((resolve) => {
      const child = spawn(executable, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks = [];
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.stderr.on("data", (chunk) => chunks.push(chunk));
      child.once("error", (error) => {
        clearTimeout(timer);
        resolve({
          exit_code: null,
          signal: null,
          duration_ms: Date.now() - started,
          output_sha256: sha256(Buffer.concat(chunks)),
          spawn_error: error.message,
        });
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          exit_code: code,
          signal,
          duration_ms: Date.now() - started,
          output_sha256: sha256(Buffer.concat(chunks)),
        });
      });
    });
    results.push({ command: [...command], ...result });
  }
  return results;
}

function requireBrowserLifecycle(value, plan, name) {
  const lifecycle = requirePlainObject(value, `${name} lifecycle`);
  if (lifecycle.username !== plan.username) throw new Error(`${name} registered account drifted`);
  const initial = requirePlainObject(lifecycle.initial, `${name} initial`);
  const capture = requirePlainObject(initial.capture, `${name} initial capture`);
  if (capture.capture_error !== undefined || capture.navigation_status !== 200) throw new Error(`${name} did not capture the public Join route`);
  const documents = [capture.first_paint?.document, capture.document];
  for (const documentValue of documents) {
    const document = requirePlainObject(documentValue, `${name} capture document`);
    if (document.phase !== "domcontentloaded_immediate_observation" && document.phase !== "settled") throw new Error(`${name} capture phase is unknown`);
    const probe = document.presence_probes?.find(({ id }) => id === "system-join");
    if (probe?.count !== 1 || probe.rendered_count !== 1) throw new Error(`${name} capture Join control drifted`);
  }
  if (initial.state.join_control_count !== 1 || initial.state.source_disclosure !== false) throw new Error(`${name} initial Join route drifted`);
  const register = requirePlainObject(lifecycle.register, `${name} register`);
  if (register.login_form_visible !== true || register.register_form_visible !== false) throw new Error(`${name} registration did not settle at the login form`);
  const logout = requirePlainObject(lifecycle.logout, `${name} logout`);
  if (logout.state?.logout_button_visible !== false) throw new Error(`${name} logout did not settle at the public seam`);
  const loginAgain = requirePlainObject(lifecycle.login_again, `${name} login again`);
  if (loginAgain.state?.login_form_visible !== false) throw new Error(`${name} second login did not settle`);
  if (typeof lifecycle.session_token !== "string" || lifecycle.session_token.length === 0) throw new Error(`${name} login did not expose a session token`);
  const join = requirePlainObject(lifecycle.join, `${name} join`);
  if (join.before.join_control_count !== 1 || join.before.focused_control !== true || join.before.aria_busy !== false) {
    throw new Error(`${name} join control did not start focused and idle`);
  }
  if (join.after.join_control_count !== 0 || join.after.aria_busy !== false || join.after.error_popup_visible !== false) {
    throw new Error(`${name} joined reload did not hide the Join control`);
  }
  if (join.mutation_request_count !== 1 || join.navigation_count < 1) throw new Error(`${name} join transition issued the wrong public requests`);
  const create = requirePlainObject(lifecycle.create, `${name} create`);
  if (create.path !== plan.component_path || create.body_contains_source !== true || create.error_popup_visible !== false) {
    throw new Error(`${name} ordinary member did not create the component page`);
  }
  const readBack = requirePlainObject(lifecycle.read_back, `${name} read back`);
  if (readBack.path !== plan.component_path || readBack.body_contains_source !== true || readBack.error_popup_visible !== false) {
    throw new Error(`${name} created component page was not publicly readable`);
  }
  return lifecycle;
}

function verifyBrowserCase(caseId, observations, plan) {
  const value = requirePlainObject(observations, `${caseId} observations`);
  const page = requirePlainObject(value.page, `${caseId} page`);
  if (page.join_path !== plan.join_path || page.join_source_sha256 !== sha256Text(JOIN_SOURCE)) {
    throw new Error(`${caseId} Join route identity drifted`);
  }
  const lifecycle = requireBrowserLifecycle(value.lifecycle, plan, caseId);
  const account = requirePlainObject(value.account, `${caseId} account`);
  if (account.user_id !== plan.registered_user_id || account.name !== plan.username) throw new Error(`${caseId} registered account identity drifted`);
  const membership = requirePlainObject(value.membership, `${caseId} membership`);
  if (membership.from_id !== plan.registered_user_id || membership.dest_id !== plan.site_id) throw new Error(`${caseId} joined membership is missing at the public seam`);
  const created = requirePlainObject(value.created_page, `${caseId} created page`);
  if (created.slug !== plan.component_slug || created.wikitext !== CONTENT_SOURCE) throw new Error(`${caseId} created component page drifted`);
  return {
    verified: true,
    registered_username: plan.username,
    joined_once: true,
    joined_state_hidden: true,
    ordinary_page_create_verified: true,
    read_back_verified: true,
  };
}

function verifyContentionCase(caseId, observations, plan) {
  const value = requirePlainObject(observations, `${caseId} observations`);
  const actor = requirePlainObject(value.actor, `${caseId} actor`);
  const site = requirePlainObject(value.site, `${caseId} site`);
  if (actor.user_id !== plan.eligible_user_id || site.site_id !== plan.site_id || site.slug !== SITE_SLUG) {
    throw new Error(`${caseId} actor or site identity drifted`);
  }
  const joinAttempts = value.join_attempts;
  if (!Array.isArray(joinAttempts) || joinAttempts.length !== 2 || joinAttempts.some(({ status }) => status !== "fulfilled")) {
    throw new Error(`${caseId} concurrent self-join attempts did not both settle`);
  }
  const joinOutcomes = joinAttempts.map(({ outcome }) => outcome).sort();
  if (JSON.stringify(joinOutcomes) !== JSON.stringify(["already_member", "joined"])) {
    throw new Error(`${caseId} concurrent self-join did not serialize to one current relation`);
  }
  const createAttempts = value.create_attempts;
  if (!Array.isArray(createAttempts) || createAttempts.length !== 2 || createAttempts.filter(({ status }) => status === "fulfilled").length !== 1 || createAttempts.filter(({ status }) => status === "rejected").length !== 1) {
    throw new Error(`${caseId} concurrent page-create attempts did not commit exactly one page`);
  }
  const membership = requirePlainObject(value.membership, `${caseId} membership`);
  if (membership.from_id !== plan.eligible_user_id || membership.dest_id !== plan.site_id) throw new Error(`${caseId} one current membership is missing`);
  const page = requirePlainObject(value.page, `${caseId} page`);
  if (page.slug !== plan.contention_slug || page.wikitext !== CONTENT_SOURCE) throw new Error(`${caseId} one intended page state is missing`);
  return {
    verified: true,
    join_outcomes: joinOutcomes,
    committed_relations: 1,
    committed_pages: 1,
    stale_successes: 0,
  };
}

function verifyCargoCase(caseId, observations, plan) {
  const value = requirePlainObject(observations, `${caseId} observations`);
  const results = value.results;
  if (!Array.isArray(results) || results.length !== FRESH_SEED_COMMANDS.length) throw new Error(`${caseId} cargo matrix result count drifted`);
  results.forEach((result, index) => {
    const row = requirePlainObject(result, `${caseId} cargo result ${index}`);
    if (JSON.stringify(row.command) !== JSON.stringify(FRESH_SEED_COMMANDS[index])) throw new Error(`${caseId} cargo command ${index} drifted`);
    if (row.exit_code !== 0 || row.spawn_error !== undefined) throw new Error(`${caseId} cargo command ${index} failed`);
  });
  return { verified: true, command_count: results.length, exit_statuses: results.map(({ exit_code }) => exit_code) };
}

function verifyCleanup(proof, resources) {
  const value = requirePlainObject(proof, "issue 1060 cleanup proof");
  if (
    value.public_absence_verified !== true ||
    value.memberships_absent !== true ||
    value.pages_absent !== true ||
    value.user_absent !== true ||
    !Array.isArray(resources) ||
    resources.length !== 5 ||
    resources.some((resource) => resource.released !== true)
  ) {
    throw new Error("issue 1060 cleanup did not prove public absence and resource release");
  }
  return { verified: true, public_absence_verified: true, memberships_absent: true, pages_absent: true, user_absent: true };
}

class Open43Issue1060Run {
  #sessionFactory;
  #sessions;
  #browser;
  #cargoRunner;
  #resources;
  #runId;
  #candidateIdentity;
  #baseInput;
  #siteId = null;
  #username;
  #password;
  #componentSlug;
  #contentionSlug;
  #registeredSession = null;
  #registeredUserId = null;
  #membershipResources = [];
  #pageResources = [];
  #userResource = null;
  #plans = new Map();

  constructor({ sessionFactory, sessions, browser, cargoRunner, resources, runId, candidateIdentity, baseInput }) {
    this.#sessionFactory = sessionFactory;
    this.#sessions = sessions;
    this.#browser = browser;
    this.#cargoRunner = cargoRunner;
    this.#resources = resources;
    this.#runId = runId;
    this.#candidateIdentity = candidateIdentity;
    this.#baseInput = baseInput;
    const suffix = runId.slice("candidate-run-".length);
    this.#username = `candidate${suffix}`;
    this.#password = `open43-issue1060-${suffix}-password`;
    this.#componentSlug = `component:open43-issue1060-${suffix}`;
    this.#contentionSlug = `open43-issue1060-${suffix}`;
  }

  get #eligibleId() {
    return this.#sessions.eligible.editorUserId;
  }

  async #rpc(actor, method, params = {}, { siteId = this.#siteId, cleanup = false } = {}) {
    const session = actor === "registered" ? this.#registeredSession : this.#sessions[actor];
    return await session.rpc(method, params, {
      actor: "editor",
      siteId: siteId ?? undefined,
      cleanup,
    });
  }

  async #memberGet(userId, { cleanup = false } = {}) {
    return await this.#rpc("administrator", "member_get", { site_id: this.#siteId, user_id: userId }, { cleanup });
  }

  async #removeMembership(userId, { cleanup = false } = {}) {
    const membership = await this.#memberGet(userId, { cleanup });
    if (membership === null) return;
    if (membership.from_id !== userId || membership.dest_id !== this.#siteId) throw new Error("issue 1060 membership identity drifted during removal");
    await this.#rpc("administrator", "member_remove", {
      site_id: this.#siteId,
      user_id: userId,
      removed_by: this.#sessions.administrator.editorUserId,
    }, { cleanup });
    if ((await this.#memberGet(userId, { cleanup })) !== null) throw new Error("issue 1060 membership removal did not clear the relation");
  }

  async #page(slug, { cleanup = false } = {}) {
    return await this.#rpc("administrator", "page_get", {
      site_id: this.#siteId,
      page: slug,
      details: { wikitext: true, compiled: false },
    }, { cleanup });
  }

  async #deletePage(slug, { cleanup = false } = {}) {
    const page = await this.#page(slug, { cleanup });
    if (page === null) return;
    await this.#rpc("administrator", "page_delete", {
      site_id: this.#siteId,
      page: page.page_id,
      last_revision_id: page.revision_id,
      revision_comments: "Open43 issue 1060 candidate cleanup",
      user_id: this.#sessions.administrator.editorUserId,
      ip_address: "127.0.0.1",
    }, { cleanup });
    if ((await this.#page(slug, { cleanup })) !== null) throw new Error(`issue 1060 page removal did not clear ${slug}`);
  }

  async #executeBrowserCase() {
    const joinPage = await this.#page("system:join");
    if (joinPage?.wikitext?.trim() !== JOIN_SOURCE) throw new Error("issue 1060 public self-join route is missing from the seeded candidate");
    const lifecycle = await this.#browser.run({
      credentials: {
        username: this.#username,
        email: `${this.#username}@example.com`,
        password: this.#password,
      },
      componentSlug: this.#componentSlug,
      source: CONTENT_SOURCE,
    });
    const session = await this.#rpc("administrator", "session_get", [lifecycle.session_token]);
    if (!Number.isSafeInteger(session?.user_id) || session.user_id === this.#sessions.administrator.editorUserId || session.user_id === this.#eligibleId) {
      throw new Error("issue 1060 registered session did not resolve to a distinct ordinary actor");
    }
    this.#registeredUserId = session.user_id;
    this.#registeredSession = this.#sessionFactory({
      candidateIdentity: this.#candidateIdentity,
      privateInput: { ...this.#baseInput, actors: { editor: { user_id: session.user_id, session_token: lifecycle.session_token } } },
      signal: null,
    });
    const user = await this.#rpc("registered", "user_get", { user: session.user_id });
    if (user?.user_type !== "regular" || user.name !== this.#username) throw new Error("issue 1060 registered actor is not the exact regular account");
    const membership = await this.#memberGet(session.user_id);
    if (membership === null || membership.from_id !== session.user_id || membership.dest_id !== this.#siteId) {
      throw new Error("issue 1060 registered actor did not self-join the editable site");
    }
    this.#membershipResources.push({ userId: session.user_id, token: this.#resources.register("membership", { site_id: this.#siteId, user_id: session.user_id }) });
    const created = await this.#page(this.#componentSlug);
    if (created === null || created.wikitext !== CONTENT_SOURCE) throw new Error("issue 1060 component page is missing at the public seam");
    this.#pageResources.push({ slug: created.slug, token: this.#resources.register("page", {
      page_id: created.page_id,
      site_id: this.#siteId,
      slug: created.slug,
      source_sha256: sha256Text(CONTENT_SOURCE),
    }) });
    this.#userResource = this.#resources.register("user", { user_id: session.user_id, name: this.#username });
    this.#plans.set(OPEN43_ISSUE1060_CASE_IDS[0], {
      join_path: JOIN_PATH,
      username: this.#username,
      component_path: `/${this.#componentSlug}`,
      component_slug: this.#componentSlug,
      registered_user_id: session.user_id,
      site_id: this.#siteId,
    });
    return [{
      case_id: OPEN43_ISSUE1060_CASE_IDS[0],
      observations: {
        page: { join_path: JOIN_PATH, join_source_sha256: sha256Text(JOIN_SOURCE) },
        lifecycle,
        account: { user_id: session.user_id, name: user.name },
        membership: { from_id: membership.from_id, dest_id: membership.dest_id },
        created_page: { page_id: created.page_id, slug: created.slug, wikitext: created.wikitext },
      },
    }];
  }

  async #executeContentionCase() {
    if ((await this.#memberGet(this.#eligibleId)) !== null) throw new Error("issue 1060 contention actor is already a member");
    if ((await this.#page(this.#contentionSlug)) !== null) throw new Error("issue 1060 contention page namespace already exists");
    const eligibleSession = this.#sessions.eligible;
    const joinPage = await this.#page("system:join");
    if (joinPage?.wikitext?.trim() !== JOIN_SOURCE) throw new Error("issue 1060 contention Join route is missing");
    const joinView = await this.#rpc("eligible", "page_view", {
      site_id: this.#siteId,
      session_token: eligibleSession.editorSessionToken,
      route: { slug: "system:join", extra: "" },
      locales: ["en-US", "en"],
    }, { page: "system:join" });
    const joinViewData = requirePlainObject(joinView?.data, "issue 1060 contention Join view data");
    const actions = joinView?.type === "found" ? joinViewData.membership_actions : null;
    if (!Array.isArray(actions) || actions.length !== 1) throw new Error("issue 1060 contention Join action denominator drifted");
    const action = requirePlainObject(actions[0], "issue 1060 contention Join action");
    if (
      action.type !== "join"
      || action.page_id !== joinPage.page_id
      || action.revision_id !== joinPage.revision_id
      || action.index !== 0
      || !/^[0-9a-f]{32}$/u.test(action.fingerprint ?? "")
    ) {
      throw new Error("issue 1060 contention Join action identity drifted");
    }
    const joinParams = {
      page_id: action.page_id,
      last_revision_id: action.revision_id,
      action_index: action.index,
      action_fingerprint: action.fingerprint,
    };
    const joinAttempts = await Promise.allSettled([0, 1].map(() => eligibleSession.rpc(
      "membership_join",
      joinParams,
      { actor: "editor", siteId: this.#siteId, page: "system:join" },
    )));
    const joinEvidence = joinAttempts.map((attempt) => attempt.status === "fulfilled"
      ? { status: attempt.status, outcome: attempt.value }
      : { status: attempt.status, rpc_code: attempt.reason?.rpc?.code ?? null, rpc_message_sha256: attempt.reason?.rpc?.message_sha256 ?? null });
    const membership = await this.#memberGet(this.#eligibleId);
    if (membership === null) throw new Error("issue 1060 concurrent self-join left no membership");
    this.#membershipResources.push({ userId: this.#eligibleId, token: this.#resources.register("membership", { site_id: this.#siteId, user_id: this.#eligibleId }) });

    const createParams = {
      site_id: this.#siteId,
      slug: this.#contentionSlug,
      title: `candidate-case-owner:${this.#contentionSlug}`,
      alt_title: null,
      wikitext: CONTENT_SOURCE,
      layout: "wikidot",
      user_id: this.#eligibleId,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 issue 1060 contention fixture",
    };
    const createAttempts = await Promise.allSettled([0, 1].map(() => eligibleSession.rpc(
      "page_create",
      createParams,
      { actor: "editor", siteId: this.#siteId, page: this.#contentionSlug },
    )));
    const createEvidence = createAttempts.map((attempt) => attempt.status === "fulfilled"
      ? { status: attempt.status }
      : { status: attempt.status, rpc_code: attempt.reason?.rpc?.code ?? null, rpc_message_sha256: attempt.reason?.rpc?.message_sha256 ?? null });
    const page = await this.#page(this.#contentionSlug);
    if (page === null || page.wikitext !== CONTENT_SOURCE) throw new Error("issue 1060 concurrent page-create left no intended page");
    this.#pageResources.push({ slug: page.slug, token: this.#resources.register("page", {
      page_id: page.page_id,
      site_id: this.#siteId,
      slug: page.slug,
      source_sha256: sha256Text(CONTENT_SOURCE),
    }) });
    this.#plans.set(OPEN43_ISSUE1060_CASE_IDS[1], {
      eligible_user_id: this.#eligibleId,
      site_id: this.#siteId,
      contention_slug: this.#contentionSlug,
    });
    return [{
      case_id: OPEN43_ISSUE1060_CASE_IDS[1],
      observations: {
        actor: { user_id: this.#eligibleId },
        site: { site_id: this.#siteId, slug: SITE_SLUG },
        join_attempts: joinEvidence,
        create_attempts: createEvidence,
        membership: { from_id: membership.from_id, dest_id: membership.dest_id },
        page: { page_id: page.page_id, slug: page.slug, wikitext: page.wikitext },
      },
    }];
  }

  async #executeCargoCase(privateInput) {
    const results = await this.#cargoRunner({
      commands: FRESH_SEED_COMMANDS,
      cwd: new URL(REPOSITORY_ROOT).pathname,
      env: cargoEnv(privateInput),
      timeoutMs: CARGO_TIMEOUT_MS,
    });
    this.#plans.set(OPEN43_ISSUE1060_CASE_IDS[2], {});
    return [{
      case_id: OPEN43_ISSUE1060_CASE_IDS[2],
      observations: { results, cargo_env_sha256: sha256Value(cargoEnv(privateInput)) },
    }];
  }

  async execute(privateInput) {
    const sessionUsers = {};
    for (const actor of ACTORS) {
      const session = await this.#rpc(actor, "session_get", [this.#sessions[actor].editorSessionToken], { siteId: null });
      if (session?.user_id !== this.#sessions[actor].editorUserId) throw new Error(`issue 1060 ${actor} session identity drifted`);
      sessionUsers[actor] = session.user_id;
    }
    if (sessionUsers.administrator === sessionUsers.eligible) throw new Error("issue 1060 private actors are not distinct");
    const site = await this.#rpc("administrator", "site_get", { site: SITE_SLUG }, { siteId: null });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) throw new Error("issue 1060 editable candidate site is missing");
    this.#siteId = site.site_id;
    const rows = [
      ...(await this.#executeBrowserCase()),
      ...(await this.#executeContentionCase()),
      ...(await this.#executeCargoCase(privateInput)),
    ];
    return rows;
  }

  async cleanup() {
    const failures = [];
    let membershipsAfter = true;
    let pagesAfter = true;
    let userAfter = true;
    try {
      if (this.#siteId !== null) {
        for (const resource of this.#membershipResources) {
          await this.#removeMembership(resource.userId, { cleanup: true });
        }
        for (const resource of this.#pageResources) {
          await this.#deletePage(resource.slug, { cleanup: true });
        }
        if (this.#registeredUserId !== null && this.#registeredSession !== null) {
          await this.#rpc("registered", "user_delete", {
            user: this.#registeredUserId,
            ip_address: "::1",
          }, { cleanup: true });
          const deleted = await this.#rpc("administrator", "user_get", { user: this.#registeredUserId }, { cleanup: true });
          if (deleted?.user_id !== this.#registeredUserId || typeof deleted.deleted_at !== "string" || deleted.deleted_at.length === 0) {
            throw new Error("issue 1060 registered user did not reach its deleted tombstone during cleanup");
          }
        }
      }
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "issue 1060 public cleanup failed");
    if (this.#siteId !== null) {
      for (const resource of this.#membershipResources) {
        if ((await this.#memberGet(resource.userId, { cleanup: true })) !== null) membershipsAfter = false;
        else this.#resources.release(resource.token, { member_get: null });
      }
      for (const resource of this.#pageResources) {
        if ((await this.#page(resource.slug, { cleanup: true })) !== null) pagesAfter = false;
        else this.#resources.release(resource.token, { page_get: null });
      }
      if (this.#registeredUserId !== null && this.#registeredSession !== null) {
        const user = await this.#rpc("administrator", "user_get", { user: this.#registeredUserId }, { cleanup: true });
        if (user?.user_id !== this.#registeredUserId || typeof user.deleted_at !== "string" || user.deleted_at.length === 0) userAfter = false;
        else if (this.#userResource !== null) this.#resources.release(this.#userResource, { user_get: { user_id: user.user_id, deleted_at: user.deleted_at } });
      }
    }
    return {
      public_absence_verified: membershipsAfter && pagesAfter && userAfter,
      memberships_absent: membershipsAfter,
      pages_absent: pagesAfter,
      user_absent: userAfter,
    };
  }

  verifyCase(caseId, observations) {
    if (!this.#plans.has(caseId)) throw new Error("issue 1060 case was not executed");
    const plan = this.#plans.get(caseId);
    if (caseId === OPEN43_ISSUE1060_CASE_IDS[0]) return verifyBrowserCase(caseId, observations, plan);
    if (caseId === OPEN43_ISSUE1060_CASE_IDS[1]) return verifyContentionCase(caseId, observations, plan);
    return verifyCargoCase(caseId, observations, plan);
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
    "install/local/wikidot-verification/src/open43-issue1060-register-join-browser-adapter.mjs",
    "install/local/wikidot-verification/src/open43-issue1060-register-join-create-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "framerail/src/lib/wikidot/wikidot-membership-actions.js",
    "framerail/src/lib/wikidot/wikidot-membership-action-request.js",
    "framerail/src/lib/server/load/register.ts",
    "framerail/src/lib/server/load/logout.ts",
    "framerail/src/routes/[x+2d]/register/+page.svelte",
    "framerail/src/routes/[x+2d]/login/+page.svelte",
    "framerail/src/routes/[slug]/[...extra]/page.svelte",
    "framerail/src/routes/[slug]/[...extra]/EditorPane.svelte",
    "deepwell/src/database/seeder/data.rs",
    "deepwell/src/endpoints/site_member.rs",
    "deepwell/src/endpoints/user.rs",
    "deepwell/src/services/membership/service.rs",
    "deepwell/src/services/render/membership_actions.rs",
    "deepwell/tests/role.rs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]),
]);

export function createOpen43Issue1060RegisterJoinCreateCandidateCaseSet({
  sessionFactory = (options) => new CandidateHttpSession(options),
  browserAdapterFactory = (options) => new Open43Issue1060RegisterJoinCreateBrowserAdapter(options),
  cargoRunner = defaultCargoRunner,
} = {}) {
  return Object.freeze({
    id: "open43-issue1060-register-join-create",
    caseIds: OPEN43_ISSUE1060_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      const candidate = requirePlainObject(candidateIdentity?.candidate, "issue 1060 candidate identity");
      const endpoint = requirePlainObject(candidate.endpoint, "issue 1060 candidate endpoint");
      if (endpoint.host !== SITE_HOST || endpoint.port === 443 || candidate.port_443_published !== false) {
        throw new Error(`issue 1060 requires an exact non-standing ${SITE_HOST} candidate`);
      }
      const baseInput = requirePlainObject(privateInput, "private issue 1060 candidate input");
      cargoEnv(privateInput);
      const sessions = Object.fromEntries(ACTORS.map((actor) => [actor, sessionFactory({
        candidateIdentity,
        privateInput: actorPrivateInput(privateInput, actor),
        signal,
      })]));
      const eligibleId = sessions.eligible.editorUserId;
      const administratorId = sessions.administrator.editorUserId;
      if (!Number.isSafeInteger(eligibleId) || !Number.isSafeInteger(administratorId) || eligibleId === administratorId) {
        throw new Error("issue 1060 private actors must have distinct safe user IDs");
      }
      const pageOrigin = sessions.administrator.pageOrigin;
      if (pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("issue 1060 session did not bind the candidate origin");
      const browser = browserAdapterFactory({
        browserContexts: candidateBrowserContexts,
        pageOrigin,
      });
      const execution = new Open43Issue1060Run({
        sessionFactory,
        sessions,
        browser,
        cargoRunner,
        resources,
        runId,
        candidateIdentity,
        baseInput,
      });
      const privateInputIdentity = {
        eligible_user_id: eligibleId,
        administrator_user_id: administratorId,
        eligible_session_sha256: sha256Value(sessions.eligible.privateInputIdentity),
        cargo_env_sha256: sha256Value(cargoEnv(privateInput)),
      };
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: [...new Map(ACTORS.flatMap((actor) => sessions[actor].requiredServiceBindings).map((binding) => [JSON.stringify(binding), binding])).values()],
        privateInputIdentity,
        browserCredentialPolicy: "none",
        plan: {
          schema: "wikijump.open43_issue1060_register_join_create_candidate_plan.v1",
          site_slug: SITE_SLUG,
          join_path: JOIN_PATH,
          join_source_sha256: sha256Text(JOIN_SOURCE),
          content_source_sha256: sha256Text(CONTENT_SOURCE),
          page_origin: pageOrigin,
          actor_user_ids: { eligible: eligibleId, administrator: administratorId },
          fresh_seed_commands: FRESH_SEED_COMMANDS,
          case_ids: OPEN43_ISSUE1060_CASE_IDS,
        },
        execute: () => execution.execute(baseInput),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup,
      });
    },
  });
}
