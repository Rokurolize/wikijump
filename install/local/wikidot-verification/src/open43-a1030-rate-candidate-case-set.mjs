import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { Open43A1030RateBrowserAdapter } from "./open43-a1030-rate-browser-adapter.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requirePlainObject,
  sha256Text,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_A1030_CASE_IDS = Object.freeze([
  "A1030_CENTRAL_RUST_MATRIX",
  "A1030_TWO_TRANSACTION_CONTENTION",
  "A1030_EXACT_CANDIDATE_BROWSER",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);
const ACTORS = Object.freeze(["administrator", "editor"]);
const CARGO_TIMEOUT_MS = 1_800_000;
const RATE_SOURCE = "[[module Rate]]";
const RUST_MATRIX_COMMANDS = Object.freeze([
  Object.freeze([
    "cargo", "test", "--manifest-path", "deepwell/Cargo.toml",
    "--lib", "services::render::rate_actions::tests", "--", "--nocapture",
  ]),
  Object.freeze([
    "cargo", "test", "--manifest-path", "deepwell/Cargo.toml",
    "--test", "page", "saved_rate_sidecar_binds_exact_revision_and_mutates_idempotently",
    "--", "--exact", "--nocapture",
  ]),
  Object.freeze([
    "cargo", "test", "--manifest-path", "deepwell/Cargo.toml",
    "--test", "vote_authorization", "vote_mutations_require_route_target_view_permission",
    "--", "--exact", "--nocapture",
  ]),
  Object.freeze([
    "node", "--test",
    "framerail/tests/wikidot-legacy-actions.test.js",
    "framerail/tests/wikidot-legacy-action-request.test.js",
    "framerail/tests/page-vote-request-context.test.js",
  ]),
]);
const CONTENTION_COMMANDS = Object.freeze([
  Object.freeze([
    "cargo", "test", "--manifest-path", "deepwell/Cargo.toml",
    "--test", "vote_concurrency", "concurrent_vote_mutations_leave_one_current_vote_and_consistent_aggregate",
    "--", "--exact", "--nocapture",
  ]),
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function actorPrivateInput(input, actor) {
  const value = requirePlainObject(input, "private A1030 candidate input");
  const selected = requirePlainObject(value.actors?.[actor], `private A1030 ${actor} actor`);
  return { ...value, actors: { editor: selected } };
}

function cargoEnv(input) {
  const value = requirePlainObject(input, "private A1030 candidate input");
  const env = requirePlainObject(value.cargo_env, "private A1030 cargo_env");
  for (const [name, entry] of Object.entries(env)) {
    if (typeof entry !== "string" || entry.length === 0 || /\r|\n/u.test(entry)) {
      throw new Error(`private A1030 cargo_env.${name} must be a single-line non-empty string`);
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

function pageSlug(runId, kind) {
  return `${kind}-a1030-${runId.slice("candidate-run-".length)}:holder`;
}

function pagePath(pageSlugValue) {
  return `/${encodeURIComponent(pageSlugValue)}`;
}

function verifyRegistry(value, name, expectedActions) {
  const registry = requirePlainObject(value, `${name} registry`);
  if (!Number.isSafeInteger(registry.page_id) || !Number.isSafeInteger(registry.revision_id)) {
    throw new Error(`${name} registry identity drifted`);
  }
  if (!Array.isArray(registry.actions) || registry.actions.length !== expectedActions) {
    throw new Error(`${name} registry action count drifted`);
  }
  return {
    page_id: registry.page_id,
    revision_id: registry.revision_id,
    actions: registry.actions,
  };
}

function requirePointState(value, label, score) {
  if (value.present !== true || value.score !== score) throw new Error(`A1030 point ${label} state drifted`);
  if (value.rateup_count !== 1 || value.ratedown_count !== 1 || value.cancel_count !== 1) {
    throw new Error(`A1030 point ${label} control count drifted`);
  }
  if (value.source_disclosure === true) throw new Error(`A1030 point ${label} disclosed Rate source`);
  return { score: value.score, controls_verified: true };
}

function requireStarState(value, label, score) {
  if (value.present !== true || value.hidden_score !== score || value.data_rating !== score) {
    throw new Error(`A1030 star ${label} state drifted`);
  }
  if (value.star_image_count !== 5) throw new Error(`A1030 star ${label} raty image count drifted`);
  if (value.source_disclosure === true) throw new Error(`A1030 star ${label} disclosed Rate source`);
  return { score: value.hidden_score, raty_verified: true };
}

function requireInitialCapture(value, label) {
  const capture = requirePlainObject(value, `${label} initial capture`);
  if (
    capture.navigation_status !== 200 ||
    capture.first_paint !== true ||
    capture.settled !== true ||
    capture.failure_count !== 0
  ) {
    throw new Error(`${label} initial browser capture did not prove both browser phases cleanly`);
  }
  return capture;
}

function requireNavigation(value, label, score) {
  const navigation = requirePlainObject(value, `${label} navigation`);
  if (
    navigation.back_path !== "/" ||
    navigation.forward_score !== score ||
    navigation.replay_request_count !== 0
  ) {
    throw new Error(`${label} back-forward navigation replayed or lost Rate state`);
  }
  return navigation;
}

function requireCsrf(value, label, score) {
  const csrf = requirePlainObject(value, `${label} CSRF observation`);
  if (csrf.http_status !== 403 || csrf.score_after !== score) {
    throw new Error(`${label} wrong-origin request was not rejected without mutation`);
  }
  return csrf;
}

function requireCache(value, label, score) {
  const cache = requirePlainObject(value, `${label} cache observation`);
  if (
    !Number.isSafeInteger(cache.reload_attempts) ||
    cache.reload_attempts < 1 ||
    !Number.isSafeInteger(cache.elapsed_ms) ||
    cache.elapsed_ms < 0 ||
    cache.score !== score
  ) {
    throw new Error(`${label} bounded cache visibility proof drifted`);
  }
  return cache;
}

function verifyBrowserCase(caseId, observations, plan) {
  const value = requirePlainObject(observations, `${caseId} observations`);
  const point = requirePlainObject(value.point, `${caseId} point mode`);
  const star = requirePlainObject(value.star, `${caseId} star mode`);

  requireInitialCapture(point.initial_capture, "A1030 point");
  requirePointState(point.initial, "initial", "0");
  requirePointState(point.busy, "busy", "0");
  if (point.busy.busy !== true || point.keyboard_focus !== true) {
    throw new Error(`A1030 point keyboard activation did not preserve focus and expose a busy interval`);
  }
  if (point.double_suppressed !== true) throw new Error(`A1030 point repeated activation was not suppressed`);
  requirePointState(point.keyboard, "keyboard", "+1");
  requirePointState(point.repeated, "repeated", "+1");
  requirePointState(point.changed, "changed", "-1");
  requirePointState(point.canceled, "canceled", "0");
  requirePointState(point.reloaded, "reloaded", "0");
  for (const state of [point.keyboard, point.repeated, point.changed, point.canceled, point.reloaded]) {
    if (state.busy === true || state.error_popup_visible === true) throw new Error(`A1030 point interval left a busy or error state`);
  }
  requireNavigation(point.navigation, "A1030 point", "0");
  requireCsrf(point.csrf, "A1030 point", "0");
  requirePointState(point.error, "error", "0");
  if (point.error.busy === true || point.error.error_popup_visible !== true) throw new Error(`A1030 point failure did not settle into the public error surface`);
  requireCache(point.cache, "A1030 point", "0");
  if (point.forged?.payload_type !== "failure") throw new Error(`A1030 point forged rate request was not rejected`);
  if (!Number.isSafeInteger(point.mutation_request_count) || point.mutation_request_count < 6) {
    throw new Error(`A1030 point mutation request count drifted`);
  }

  requireInitialCapture(star.initial_capture, "A1030 star");
  requireStarState(star.initial, "initial", "0");
  requireStarState(star.busy, "busy", "0");
  if (star.busy.busy !== true) throw new Error(`A1030 star click did not expose a busy interval`);
  if (star.focusable_image_count !== 0 || star.tabindex_attribute_count !== 0) {
    throw new Error(`A1030 star DOM invented a keyboard-focus affordance absent from the Wikidot oracle`);
  }
  if (star.double_suppressed !== true) throw new Error(`A1030 star repeated activation was not suppressed`);
  requireStarState(star.clicked, "clicked", "4");
  requireStarState(star.repeated, "repeated", "4");
  requireStarState(star.changed, "changed", "3");
  requireStarState(star.reloaded, "reloaded", "3");
  for (const state of [star.clicked, star.repeated, star.changed, star.reloaded]) {
    if (state.busy === true || state.error_popup_visible === true) throw new Error(`A1030 star interval left a busy or error state`);
  }
  requireNavigation(star.navigation, "A1030 star", "3");
  requireCsrf(star.csrf, "A1030 star", "3");
  requireStarState(star.error, "error", "3");
  if (star.error.busy === true || star.error.error_popup_visible !== true) throw new Error(`A1030 star failure did not settle into the public error surface`);
  requireCache(star.cache, "A1030 star", "3");
  if (star.forged?.payload_type !== "failure") throw new Error(`A1030 star forged rate request was not rejected`);
  if (!Number.isSafeInteger(star.mutation_request_count) || star.mutation_request_count < 5) {
    throw new Error(`A1030 star mutation request count drifted`);
  }

  return {
    verified: true,
    point_mode: {
      keyboard_activation: true,
      busy_interval: true,
      repeated_activation_suppressed: true,
      repeated_click_idempotent: true,
      change_and_cancel_committed: true,
      navigation_restored: true,
      csrf_rejected: true,
      error_surface: true,
      reload_cache_consistent: true,
      forged_rejected: true,
    },
    star_mode: {
      raty_click_committed: true,
      observed_non_focusable_images: true,
      busy_interval: true,
      repeated_activation_suppressed: true,
      repeated_click_idempotent: true,
      change_committed: true,
      navigation_restored: true,
      csrf_rejected: true,
      error_surface: true,
      reload_cache_consistent: true,
      forged_rejected: true,
    },
  };
}

function verifyCommandResults(results, commands, caseId) {
  if (!Array.isArray(results) || results.length !== commands.length) throw new Error(`${caseId} command matrix result count drifted`);
  results.forEach((result, index) => {
    const row = requirePlainObject(result, `${caseId} command result ${index}`);
    if (JSON.stringify(row.command) !== JSON.stringify(commands[index])) throw new Error(`${caseId} command ${index} drifted`);
    if (row.exit_code !== 0 || row.spawn_error !== undefined) throw new Error(`${caseId} command ${index} failed`);
  });
  return { verified: true, command_count: results.length, exit_statuses: results.map(({ exit_code }) => exit_code) };
}

function verifyCleanup(proof, resources) {
  const value = requirePlainObject(proof, "A1030 cleanup proof");
  if (
    value.public_absence_verified !== true ||
    value.pages_absent !== true ||
    value.rating_restored !== true ||
    !Array.isArray(resources) ||
    resources.length !== 2 ||
    resources.some((resource) => resource.released !== true)
  ) {
    throw new Error("A1030 cleanup did not prove public absence and resource release");
  }
  return { verified: true, public_absence_verified: true, pages_absent: true, rating_restored: true };
}

class Open43A1030Run {
  #sessionFactory;
  #sessions;
  #browser;
  #cargoRunner;
  #resources;
  #runId;
  #candidateIdentity;
  #baseInput;
  #siteId = null;
  #pointSlug = null;
  #starSlug = null;
  #pointCategory = null;
  #starCategory = null;
  #pointPage = null;
  #starPage = null;
  #pageResources = [];
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
    this.#pointSlug = pageSlug(runId, "point");
    this.#starSlug = pageSlug(runId, "star");
    this.#pointCategory = this.#pointSlug.split(":", 1)[0];
    this.#starCategory = this.#starSlug.split(":", 1)[0];
  }

  async #rpc(actor, method, params = {}, { siteId = this.#siteId, cleanup = false } = {}) {
    return await this.#sessions[actor].rpc(method, params, {
      actor: "editor",
      siteId: siteId ?? undefined,
      cleanup,
    });
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
      revision_comments: "Open43 A1030 candidate cleanup",
      user_id: this.#sessions.administrator.editorUserId,
      ip_address: "127.0.0.1",
    }, { cleanup });
    if ((await this.#page(slug, { cleanup })) !== null) throw new Error(`A1030 page removal did not clear ${slug}`);
  }

  async #setCategoryRating(category, ratingType, enabled, { cleanup = false } = {}) {
    await this.#rpc("administrator", "category_update", {
      site: this.#siteId,
      category,
      user_id: this.#sessions.administrator.editorUserId,
      rating_enabled: enabled,
      rating_permission: "registered",
      rating_type: ratingType,
      ip_address: "127.0.0.1",
    }, { siteId: this.#siteId, cleanup });
  }

  async #createRateFixture(slug, category, ratingType) {
    const created = await this.#rpc("administrator", "page_create", {
      site_id: this.#siteId,
      slug,
      title: `candidate-case-owner:${slug}`,
      alt_title: null,
      wikitext: RATE_SOURCE,
      layout: "wikidot",
      user_id: this.#sessions.administrator.editorUserId,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 A1030 Rate fixture",
    });
    if (!Number.isSafeInteger(created?.page_id) || !Number.isSafeInteger(created.revision_id) || created.slug !== slug) {
      throw new Error(`A1030 page_create did not return a public Rate fixture identity for ${slug}`);
    }
    const pageCategory = await this.#rpc("administrator", "category_get", {
      site: this.#siteId,
      category,
    }, { siteId: this.#siteId });
    if (!Number.isSafeInteger(pageCategory?.category_id)) throw new Error(`A1030 category_get did not return ${category}`);
    await this.#setCategoryRating(category, ratingType, true);
    await this.#rpc("administrator", "page_rerender", {
      site_id: this.#siteId,
      category_id: pageCategory.category_id,
      page_id: created.page_id,
    }, { siteId: this.#siteId });
    const viewed = await this.#rpc("editor", "page_view", {
      site_id: this.#siteId,
      session_token: this.#sessions.editor.editorSessionToken,
      route: { slug, extra: "" },
      locales: ["en-US", "en"],
    });
    const registry = verifyRegistry(viewed?.data?.rate_actions, slug, ratingType === "plus_minus" ? 3 : 5);
    return { created, registry, category_id: pageCategory.category_id };
  }

  async #executeBrowserCase() {
    const point = await this.#createRateFixture(this.#pointSlug, this.#pointCategory, "plus_minus");
    this.#pointPage = point.created;
    this.#pageResources.push({ slug: point.created.slug, token: this.#resources.register("page", {
      page_id: point.created.page_id,
      site_id: this.#siteId,
      slug: point.created.slug,
      source_sha256: sha256Text(RATE_SOURCE),
    }) });
    const star = await this.#createRateFixture(this.#starSlug, this.#starCategory, "stars");
    this.#starPage = star.created;
    this.#pageResources.push({ slug: star.created.slug, token: this.#resources.register("page", {
      page_id: star.created.page_id,
      site_id: this.#siteId,
      slug: star.created.slug,
      source_sha256: sha256Text(RATE_SOURCE),
    }) });
    const browser = await this.#browser.run({
      pointPath: pagePath(this.#pointSlug),
      starPath: pagePath(this.#starSlug),
      pointRegistry: point.registry,
      starRegistry: star.registry,
      session: this.#sessions.editor,
    });
    this.#plans.set(OPEN43_A1030_CASE_IDS[2], {
      point_slug: this.#pointSlug,
      star_slug: this.#starSlug,
      point_registry: point.registry,
      star_registry: star.registry,
    });
    return [{
      case_id: OPEN43_A1030_CASE_IDS[2],
      observations: {
        point_slug: this.#pointSlug,
        star_slug: this.#starSlug,
        point: browser.point,
        star: browser.star,
      },
    }];
  }

  async #executeCommandMatrix(privateInput) {
    const cargoResults = await this.#cargoRunner({
      commands: [...RUST_MATRIX_COMMANDS, ...CONTENTION_COMMANDS],
      cwd: new URL(REPOSITORY_ROOT).pathname,
      env: cargoEnv(privateInput),
      timeoutMs: CARGO_TIMEOUT_MS,
    });
    const rustMatrix = cargoResults.slice(0, RUST_MATRIX_COMMANDS.length);
    const contention = cargoResults.slice(RUST_MATRIX_COMMANDS.length);
    this.#plans.set(OPEN43_A1030_CASE_IDS[0], {});
    this.#plans.set(OPEN43_A1030_CASE_IDS[1], {});
    return [
      {
        case_id: OPEN43_A1030_CASE_IDS[0],
        observations: { results: rustMatrix, cargo_env_sha256: sha256Value(cargoEnv(privateInput)) },
      },
      {
        case_id: OPEN43_A1030_CASE_IDS[1],
        observations: { results: contention, cargo_env_sha256: sha256Value(cargoEnv(privateInput)) },
      },
    ];
  }

  async execute(privateInput) {
    const sessionUsers = {};
    for (const actor of ACTORS) {
      const session = await this.#rpc(actor, "session_get", [this.#sessions[actor].editorSessionToken], { siteId: null });
      if (session?.user_id !== this.#sessions[actor].editorUserId) throw new Error(`A1030 ${actor} session identity drifted`);
      sessionUsers[actor] = session.user_id;
    }
    if (sessionUsers.administrator === sessionUsers.editor) throw new Error("A1030 private actors are not distinct");
    const site = await this.#rpc("administrator", "site_get", { site: SITE_SLUG }, { siteId: null });
    if (!Number.isSafeInteger(site?.site_id) || site.slug !== SITE_SLUG) throw new Error("A1030 editable candidate site is missing");
    this.#siteId = site.site_id;
    const rows = [
      ...(await this.#executeBrowserCase()),
      ...(await this.#executeCommandMatrix(privateInput)),
    ];
    return rows;
  }

  async cleanup() {
    const failures = [];
    let pagesAfter = true;
    let ratingAfter = true;
    try {
      if (this.#siteId !== null) {
        if (this.#pointSlug !== null) await this.#deletePage(this.#pointSlug, { cleanup: true });
        if (this.#starSlug !== null) await this.#deletePage(this.#starSlug, { cleanup: true });
        if (this.#pointCategory !== null) await this.#setCategoryRating(this.#pointCategory, "plus_minus", false, { cleanup: true });
        if (this.#starCategory !== null) await this.#setCategoryRating(this.#starCategory, "stars", false, { cleanup: true });
      }
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, "A1030 public cleanup failed");
    if (this.#siteId !== null) {
      for (const resource of this.#pageResources) {
        if ((await this.#page(resource.slug, { cleanup: true })) !== null) pagesAfter = false;
        else this.#resources.release(resource.token, { page_get: null });
      }
    }
    return {
      public_absence_verified: pagesAfter && ratingAfter,
      pages_absent: pagesAfter,
      rating_restored: ratingAfter,
    };
  }

  verifyCase(caseId, observations) {
    if (!this.#plans.has(caseId)) throw new Error("A1030 case was not executed");
    const plan = this.#plans.get(caseId);
    if (caseId === OPEN43_A1030_CASE_IDS[2]) return verifyBrowserCase(caseId, observations, plan);
    if (caseId === OPEN43_A1030_CASE_IDS[0]) return verifyCommandResults(observations.results, RUST_MATRIX_COMMANDS, caseId);
    return verifyCommandResults(observations.results, CONTENTION_COMMANDS, caseId);
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
    "install/local/wikidot-verification/src/open43-a1030-rate-browser-adapter.mjs",
    "install/local/wikidot-verification/src/open43-a1030-rate-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    "framerail/src/lib/wikidot/wikidot-legacy-actions.js",
    "framerail/src/lib/wikidot/wikidot-legacy-action-request.js",
    "framerail/src/routes/[slug]/[...extra]/page.svelte",
    "framerail/src/routes/[slug]/[...extra]/VotePane.svelte",
    "deepwell/src/endpoints/vote.rs",
    "deepwell/src/endpoints/category.rs",
    "deepwell/src/endpoints/page.rs",
    "deepwell/src/services/vote/service.rs",
    "deepwell/src/services/score/service.rs",
    "deepwell/src/services/render/rate_actions.rs",
    "deepwell/tests/vote.rs",
    "deepwell/tests/vote_authorization.rs",
    "deepwell/tests/vote_concurrency.rs",
    "deepwell/tests/page.rs",
    "framerail/tests/wikidot-legacy-actions.test.js",
    "framerail/tests/wikidot-legacy-action-request.test.js",
    "framerail/tests/page-vote-request-context.test.js",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]),
]);

export function createOpen43A1030RateCandidateCaseSet({
  sessionFactory = (options) => new CandidateHttpSession(options),
  browserAdapterFactory = (options) => new Open43A1030RateBrowserAdapter(options),
  cargoRunner = defaultCargoRunner,
} = {}) {
  return Object.freeze({
    id: "open43-a1030-rate",
    caseIds: OPEN43_A1030_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources, candidateBrowserContexts }) {
      const candidate = requirePlainObject(candidateIdentity?.candidate, "A1030 candidate identity");
      const endpoint = requirePlainObject(candidate.endpoint, "A1030 candidate endpoint");
      if (endpoint.host !== SITE_HOST || endpoint.port === 443 || candidate.port_443_published !== false) {
        throw new Error(`A1030 requires an exact non-standing ${SITE_HOST} candidate`);
      }
      const baseInput = requirePlainObject(privateInput, "private A1030 candidate input");
      cargoEnv(privateInput);
      const sessions = Object.fromEntries(ACTORS.map((actor) => [actor, sessionFactory({
        candidateIdentity,
        privateInput: actorPrivateInput(privateInput, actor),
        signal,
      })]));
      const editorId = sessions.editor.editorUserId;
      const administratorId = sessions.administrator.editorUserId;
      if (!Number.isSafeInteger(editorId) || !Number.isSafeInteger(administratorId) || editorId === administratorId) {
        throw new Error("A1030 private actors must have distinct safe user IDs");
      }
      const pageOrigin = sessions.administrator.pageOrigin;
      if (pageOrigin !== candidatePageOrigin(candidateIdentity)) throw new Error("A1030 session did not bind the candidate origin");
      const browser = browserAdapterFactory({
        browserContexts: candidateBrowserContexts,
        pageOrigin,
      });
      const execution = new Open43A1030Run({
        sessionFactory,
        sessions,
        browser,
        cargoRunner,
        resources,
        runId,
      });
      const privateInputIdentity = {
        editor_user_id: editorId,
        administrator_user_id: administratorId,
        editor_session_sha256: sha256Value(sessions.editor.privateInputIdentity),
        cargo_env_sha256: sha256Value(cargoEnv(privateInput)),
      };
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: [...new Map(ACTORS.flatMap((actor) => sessions[actor].requiredServiceBindings).map((binding) => [JSON.stringify(binding), binding])).values()],
        privateInputIdentity,
        browserCredentialPolicy: { mode: "private-actor-storage-states", storage_state_count: 1, private_input_identity_sha256: sha256Value(privateInputIdentity) },
        plan: {
          schema: "wikijump.open43_a1030_rate_candidate_plan.v1",
          site_slug: SITE_SLUG,
          rate_source_sha256: sha256Text(RATE_SOURCE),
          page_origin: pageOrigin,
          actor_user_ids: { editor: editorId, administrator: administratorId },
          rust_matrix_commands: RUST_MATRIX_COMMANDS,
          contention_commands: CONTENTION_COMMANDS,
          case_ids: OPEN43_A1030_CASE_IDS,
        },
        execute: () => execution.execute(baseInput),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => execution.verifyCase(caseId, observations),
        verifyCleanup,
      });
    },
  });
}
