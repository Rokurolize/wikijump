import {
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

const CASE_IDS = ["S758_CREATE_INITIAL", "S758_CREATE_SETTLED"];
const freeze = (value) => Object.freeze(value);

export const OPEN43_SETTINGS_LIFECYCLE_CASE_IDS = freeze(CASE_IDS);

export const OPEN43_SETTINGS_LIFECYCLE_CASE_MANIFEST = freeze([
  freeze({
    case_id: "S758_CREATE_INITIAL",
    issue: 758,
    phase: "create_initial",
    public_seam: "missing_page_editor_submit",
    required_observations: freeze(["assigned_slug", "redirect_url", "title", "first_paint"]),
  }),
  freeze({
    case_id: "S758_CREATE_SETTLED",
    issue: 758,
    phase: "create_settled",
    public_seam: "page_history_reload_and_follow_up_create",
    required_observations: freeze(["history", "reload", "next_create", "disable", "cache_identity", "allocator_after_second", "allocator_after_disabled"]),
  }),
]);

const manifestById = new Map(OPEN43_SETTINGS_LIFECYCLE_CASE_MANIFEST.map((row) => [row.case_id, row]));

function object(value, label) {
  return requirePlainObject(value, label);
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

function sha(value, label) {
  requireSha256(value, label);
  return value;
}

function pageSlug(category, next) {
  return category === "_default" ? String(next) : `${category}:${next}`;
}

function pageUrl(origin, slug) {
  return new URL(`/${encodeURIComponent(slug)}`, origin).href;
}

function allocator(value, label) {
  const state = object(value, label);
  if (typeof state.enabled !== "boolean") throw new Error(`${label}.enabled must be boolean`);
  return {
    enabled: state.enabled,
    next: integer(state.next, `${label}.next`),
    sha256: sha(state.sha256, `${label}.sha256`),
  };
}

function response(value, label) {
  const result = object(value, label);
  integer(result.http_status, `${label}.http_status`);
  nonEmpty(result.action_type, `${label}.action_type`);
  sha(result.response_body_sha256, `${label}.response_body_sha256`);
  return result;
}

function capture(value, label, expectedUrl, expectedTitle, expectedBody) {
  const result = object(value, label);
  if (
    result.navigation_status !== 200 ||
    result.input_url !== expectedUrl ||
    result.final_url !== expectedUrl ||
    !Array.isArray(result.failures) ||
    result.failures.length !== 0 ||
    !Array.isArray(result.request_gate_aborts) ||
    result.request_gate_aborts.length !== 0
  ) throw new Error(`${label} did not bind one successful navigation`);
  const firstPaint = object(result.first_paint, `${label}.first_paint`);
  if (firstPaint.phase !== "domcontentloaded_immediate_observation") throw new Error(`${label}.first_paint has the wrong phase`);
  if (firstPaint.title !== undefined && firstPaint.title !== expectedTitle) throw new Error(`${label}.first_paint title is wrong`);
  if (firstPaint.content !== expectedBody) throw new Error(`${label}.first_paint content is wrong`);
  const screenshot = object(firstPaint.screenshot, `${label}.first_paint.screenshot`);
  nonEmpty(screenshot.path, `${label}.first_paint.screenshot.path`);
  sha(screenshot.sha256, `${label}.first_paint.screenshot.sha256`);
  const settled = object(result.settled, `${label}.settled`);
  if (settled.phase !== "settled" || settled.resource_completion !== "complete" || settled.content !== expectedBody) throw new Error(`${label}.settled is incomplete`);
  return result;
}

function pageIdentity(value, label) {
  const page = object(value, label);
  integer(page.page_id, `${label}.page_id`);
  integer(page.revision_id, `${label}.revision_id`);
  if (page.page_id <= 0 || page.revision_id <= 0) throw new Error(`${label} must bind positive public identities`);
  nonEmpty(page.slug, `${label}.slug`);
  nonEmpty(page.title, `${label}.title`);
  return page;
}

export function verifyOpen43SettingsLifecycleCase(caseId, rawObservations, plan) {
  const manifest = manifestById.get(caseId);
  if (!manifest) throw new Error(`unknown Open43 settings lifecycle case: ${caseId}`);
  const observations = object(rawObservations, `${caseId} observations`);
  const fixedPlan = object(plan, "S758 candidate plan");
  const category = nonEmpty(fixedPlan.category_slug, "S758 candidate plan.category_slug");
  const origin = nonEmpty(fixedPlan.page_origin, "S758 candidate plan.page_origin");
  const firstTitle = nonEmpty(fixedPlan.first_title, "S758 candidate plan.first_title");
  const secondTitle = nonEmpty(fixedPlan.second_title, "S758 candidate plan.second_title");
  const firstBody = nonEmpty(fixedPlan.first_body, "S758 candidate plan.first_body");
  const secondBody = nonEmpty(fixedPlan.second_body, "S758 candidate plan.second_body");
  const before = allocator(observations.allocator_before, `${caseId}.allocator_before`);
  const afterFirst = allocator(caseId === "S758_CREATE_INITIAL" ? observations.allocator_after : observations.allocator_after_first, `${caseId}.allocator_after_first`);
  const firstAssignedSlug = pageSlug(category, before.next);
  const firstUrl = pageUrl(origin, firstAssignedSlug);
  const first = object(observations.first_create, `${caseId}.first_create`);
  if (first.assigned_slug !== firstAssignedSlug || first.redirect_url !== firstUrl || first.title !== firstTitle) throw new Error(`${caseId} first create identity is wrong`);
  capture(first.capture, `${caseId}.first_create.capture`, firstUrl, firstTitle, firstBody);
  pageIdentity(first.page, `${caseId}.first_create.page`);
  if (first.page.slug !== first.assigned_slug || first.page.title !== first.title) throw new Error(`${caseId} first page identity does not follow the assigned slug`);
  if (response(first.action, `${caseId}.first_create.action`).http_status !== 200) throw new Error(`${caseId} first create did not return a successful public action`);
  if (first.category_slug !== category) throw new Error(`${caseId} first create used the wrong category`);
  if (before.enabled !== true || afterFirst.enabled !== true || afterFirst.next !== before.next + 1) throw new Error(`${caseId} did not prove one allocator advance`);

  if (caseId === "S758_CREATE_INITIAL") {
    return { verified: true, case_id: caseId, first_assigned_slug: first.assigned_slug, first_paint_sha256: first.capture.first_paint.screenshot.sha256 };
  }

  const history = object(observations.history, `${caseId}.history`);
  if (history.url !== `${firstUrl}#_history` || history.status !== 200 || !Number.isSafeInteger(history.row_count) || history.row_count < 1) throw new Error(`${caseId} history did not bind the first assigned page`);
  const reload = object(observations.reload, `${caseId}.reload`);
  if (reload.url !== firstUrl || reload.status !== 200) throw new Error(`${caseId} reload did not return the first page`);
  const afterSecond = allocator(observations.allocator_after_second, `${caseId}.allocator_after_second`);
  const afterDisabled = allocator(observations.allocator_after_disabled, `${caseId}.allocator_after_disabled`);
  const secondAssignedSlug = pageSlug(category, afterFirst.next);
  const secondUrl = pageUrl(origin, secondAssignedSlug);
  const next = object(observations.next_create, `${caseId}.next_create`);
  if (next.assigned_slug !== secondAssignedSlug || next.redirect_url !== secondUrl || next.title !== secondTitle || next.category_slug !== category) throw new Error(`${caseId} next create identity is wrong`);
  capture(next.capture, `${caseId}.next_create.capture`, secondUrl, secondTitle, secondBody);
  pageIdentity(next.page, `${caseId}.next_create.page`);
  if (next.page.slug !== next.assigned_slug || next.page.title !== next.title || response(next.action, `${caseId}.next_create.action`).http_status !== 200) throw new Error(`${caseId} next page identity is wrong`);
  if (afterSecond.enabled !== true || afterSecond.next !== afterFirst.next + 1) throw new Error(`${caseId} did not prove the second allocator advance`);
  const disable = object(observations.disable, `${caseId}.disable`);
  if (response(disable.action, `${caseId}.disable.action`).http_status !== 200 || disable.enabled !== false || disable.requested_slug !== fixedPlan.disabled_requested_slug) throw new Error(`${caseId} disable behavior is not proven`);
  const disabledCreate = object(disable.create, `${caseId}.disable.create`);
  const disabledUrl = pageUrl(origin, disable.requested_slug);
  if (disabledCreate.assigned_slug !== disable.requested_slug || disabledCreate.redirect_url !== disabledUrl || disabledCreate.title !== fixedPlan.disabled_title || disabledCreate.category_slug !== category || response(disabledCreate.action, `${caseId}.disable.create.action`).http_status !== 200) throw new Error(`${caseId} disabled create did not preserve the requested slug`);
  capture(disabledCreate.capture, `${caseId}.disable.create.capture`, disabledUrl, fixedPlan.disabled_title, fixedPlan.disabled_body);
  pageIdentity(disabledCreate.page, `${caseId}.disable.create.page`);
  if (disabledCreate.page.slug !== disable.requested_slug || disabledCreate.page.title !== fixedPlan.disabled_title || afterDisabled.enabled !== false || afterDisabled.next !== afterSecond.next) throw new Error(`${caseId} disabled create changed the allocator`);
  const cache = object(observations.cache_identity, `${caseId}.cache_identity`);
  sha(cache.first, `${caseId}.cache_identity.first`);
  sha(cache.reload, `${caseId}.cache_identity.reload`);
  sha(cache.second, `${caseId}.cache_identity.second`);
  if (cache.first !== cache.reload || cache.first === cache.second) throw new Error(`${caseId} cache identity is not bound to page state`);
  return { verified: true, case_id: caseId, first_assigned_slug: first.assigned_slug, second_assigned_slug: next.assigned_slug };
}

export function verifyOpen43SettingsLifecycleCleanup(proof, resources) {
  const cleanup = object(proof, "S758 cleanup proof");
  if (cleanup.public_absence_verified !== true || cleanup.run_owned_state_absent !== true || cleanup.disposable_candidate_discarded !== true) throw new Error("S758 cleanup did not prove disposal of run-owned state");
  if (!Array.isArray(cleanup.run_owned_page_ids) || cleanup.run_owned_page_ids.length !== 0) throw new Error("S758 cleanup left run-owned pages");
  if (!Array.isArray(resources) || resources.some((resource) => resource.released !== true)) throw new Error("S758 cleanup left an unreleased resource");
  return { verified: true, public_absence_verified: true, run_owned_state_absent: true, disposable_candidate_discarded: true, resource_count: resources.length };
}

export function settingsLifecycleManifestSha256() {
  return sha256Value(OPEN43_SETTINGS_LIFECYCLE_CASE_MANIFEST);
}
