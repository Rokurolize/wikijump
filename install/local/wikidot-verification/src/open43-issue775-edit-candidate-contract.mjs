import {
  requirePlainObject,
  requireSha256,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_ISSUE775_CASE_IDS = Object.freeze([
  "A775_ACTOR_NAVIGATION_BROWSER",
]);

const ACTORS = Object.freeze([
  ["anonymous", false],
  ["editable_member", true],
  ["non_editable_member", false],
]);

function requireCapture(value, plan, label) {
  const capture = requirePlainObject(value, `${label} capture`);
  if (capture.capture_error !== undefined || capture.navigation_status !== 200 || capture.final_url !== plan.page_url) {
    throw new Error(`${label} did not capture the exact public page navigation`);
  }
  const first = requirePlainObject(capture.first_paint, `${label} first paint`);
  const settled = requirePlainObject(capture.document, `${label} settled document`);
  const firstDocument = requirePlainObject(first.document, `${label} first paint document`);
  for (const [name, document, screenshotValue] of [["first paint", firstDocument, first.screenshot], ["settled", settled, capture.settled_viewport_screenshot]]) {
    const screenshot = requirePlainObject(screenshotValue, `${label} ${name} screenshot`);
    if (typeof screenshot.path !== "string" || screenshot.path.length === 0) throw new Error(`${label} ${name} screenshot path is missing`);
    requireSha256(screenshot.sha256, `${label} ${name} screenshot SHA-256`);
  }
  return capture;
}

function requireState(value, expectedPath, editable, label, standaloneCount = 1, expectedOrigin = null) {
  const state = requirePlainObject(value, `${label} state`);
  if (expectedOrigin !== null && new URL(state.url).origin !== expectedOrigin) throw new Error(`${label} left the sealed candidate origin`);
  if (
    state.path !== expectedPath ||
    state.standalone_edit_count !== standaloneCount ||
    state.editor_count !== (editable ? 1 : 0) ||
    state.edit_route !== editable ||
    state.source_disclosure !== false ||
    typeof state.active_element !== "string"
  ) throw new Error(`${label} reached an unexpected public state`);
  return state;
}

function requireAction(value, expectedPath, editable, label, expectedOrigin) {
  const action = requirePlainObject(value, label);
  if (action.focused_control !== true || action.permission_response_count !== 1) throw new Error(`${label} did not exercise one focused permission-bound activation`);
  requireState(action.state, expectedPath, editable, label, 1, expectedOrigin);
  return action;
}

function requireHistory(value, pagePath, editable, label, expectedOrigin) {
  const history = requirePlainObject(value, label);
  requireState(history.back, editable ? pagePath : "/", false, `${label} back`, editable ? 1 : 0, expectedOrigin);
  requireState(history.forward, editable ? `${pagePath}/edit` : pagePath, editable, `${label} forward`, 1, expectedOrigin);
  return history;
}

export function verifyOpen43Issue775Case(caseId, observations, plan) {
  if (caseId !== OPEN43_ISSUE775_CASE_IDS[0]) throw new Error(`unknown issue 775 case: ${caseId}`);
  const value = requirePlainObject(observations, `${caseId} observations`);
  const page = requirePlainObject(value.page, `${caseId} page`);
  if (page.page_id !== plan.page_id || page.slug !== plan.page_slug || page.source_sha256 !== plan.source_sha256) throw new Error(`${caseId} page identity drifted`);
  const permissions = requirePlainObject(value.permissions, `${caseId} permissions`);
  const expectedOrigin = new URL(plan.page_url).origin;
  const actors = Array.isArray(value.actors) ? value.actors : null;
  if (actors === null || actors.length !== ACTORS.length || new Set(actors.map(({ actor }) => actor)).size !== ACTORS.length) throw new Error(`${caseId} actor matrix is incomplete or duplicated`);
  for (const [actor, editable] of ACTORS) {
    if (permissions[actor] !== editable) throw new Error(`${caseId} permission preflight is not bound to the expected actor`);
    const row = actors.find((candidate) => candidate.actor === actor);
    const initial = requirePlainObject(row.initial, `${caseId} ${actor} initial`);
    requireCapture(initial.capture, plan, `${caseId} ${actor} initial`);
    requireState(initial.state, plan.page_path, false, `${caseId} ${actor} initial`, 1, expectedOrigin);
    requireAction(row.click, editable ? `${plan.page_path}/edit` : plan.page_path, editable, `${caseId} ${actor} click`, expectedOrigin);
    requireAction(row.keyboard, editable ? `${plan.page_path}/edit` : plan.page_path, editable, `${caseId} ${actor} keyboard`, expectedOrigin);
    const double = requirePlainObject(row.double_activation, `${caseId} ${actor} double activation`);
    if (double.permission_response_count !== 1) throw new Error(`${caseId} ${actor} double activation was not suppressed`);
    requireState(double.state, editable ? `${plan.page_path}/edit` : plan.page_path, editable, `${caseId} ${actor} double activation`, 1, expectedOrigin);
    requireHistory(row.back_forward, plan.page_path, editable, `${caseId} ${actor} back-forward`, expectedOrigin);
  }
  return {
    verified: true,
    actor_count: actors.length,
    page_id: plan.page_id,
    source_sha256: plan.source_sha256,
  };
}

export function verifyOpen43Issue775Cleanup(proof) {
  const value = requirePlainObject(proof, "issue 775 cleanup proof");
  if (value.public_absence_verified !== true || value.page_after !== null) throw new Error("issue 775 cleanup did not prove public page absence");
  return { verified: true, public_absence_verified: true };
}
