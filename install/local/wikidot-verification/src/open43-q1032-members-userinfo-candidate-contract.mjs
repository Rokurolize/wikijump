import { createHash } from "node:crypto";

import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_Q1032_CASE_IDS = Object.freeze([
  "Q1032_EXACT_CANDIDATE_DIRECTORY_MATRIX",
  "Q1032_MEMBERS_AJAX_EXACT_CANDIDATE",
  "Q1032_BROWSER_DIRECTORY_ACTIONS",
]);

export const OPEN43_Q1032_SAVED_DIRECTORY_SOURCE = "MEMBERS_START\n[[module Members]]\nMEMBERS_END\nSEARCH_START\n[[module SearchUsers]]\nSEARCH_END\nWHO_START\n[[module WhoInvited]]\nWHO_END";
export const OPEN43_Q1032_SAVED_DIRECTORY_SOURCE_SHA256 = "509ffeb30626c5007a60d8005ec9d0ea884b6f4cdec408448521e141181b087a";

export const OPEN43_Q1032_EVIDENCE = Object.freeze({
  members: Object.freeze({
    path: "install/local/wikidot-verification/artifacts/members-list-amc-live-20260810.json",
    sha256: "6f7be3f18a5e21397affbc33f3419ec67d3deca3648a524c76c42e4e9b16e3e7",
  }),
  userinfo: Object.freeze({
    path: "install/local/wikidot-verification/artifacts/static-account-modules-live-preview-and-pageview.json",
    sha256: "bde2f0e6ef4daf8fe9f52134aec967a24f9187503f066338b5365439b3dac628",
  }),
});

const USERINFO_NO_TARGET_BODY = "<div class=\"error-block\">No user specified.</div>";
const USERINFO_NO_TARGET_SHA256 = createHash("sha256")
  .update(USERINFO_NO_TARGET_BODY)
  .digest("hex");
const SEARCHUSERS_DISABLED_BODY = "<div class=\"error-block\">User search has been (temporarily) disabled. Sorry!</div>";
const SEARCHUSERS_DISABLED_SHA256 = createHash("sha256")
  .update(SEARCHUSERS_DISABLED_BODY)
  .digest("hex");
const MEMBERS_PARAMETERS = Object.freeze({ group: "", order: "joined", page: "1" });
const MEMBERS_AJAX_FORM = Object.freeze({ moduleName: "membership/MembersListModule", group: "", order: "joined", page: "1" });

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, name) {
  return requirePlainObject(value, name);
}

function textHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateOpen43Q1032PrivateInput(value) {
  const input = object(value, "Q1032 private input");
  expect(Number.isSafeInteger(input.site_id) && input.site_id > 0, "Q1032 site_id must be a positive safe integer");
  requireNonEmptyString(input.preview_title, "Q1032 preview_title");
  const saved = object(input.saved_page, "Q1032 saved_page");
  expect(Number.isSafeInteger(saved.page_id) && saved.page_id > 0, "Q1032 saved_page.page_id must be a positive safe integer");
  expect(Number.isSafeInteger(saved.revision_id) && saved.revision_id > 0, "Q1032 saved_page.revision_id must be a positive safe integer");
  requireNonEmptyString(saved.slug, "Q1032 saved_page.slug");
  requireSha256(input.saved_page_source_sha256, "Q1032 saved_page_source_sha256");
  expect(input.saved_page_source_sha256 === OPEN43_Q1032_SAVED_DIRECTORY_SOURCE_SHA256, "Q1032 saved directory source is not the fixed live matrix");
  return Object.freeze({
    site_id: input.site_id,
    preview_title: input.preview_title,
    saved_page: Object.freeze({ page_id: saved.page_id, revision_id: saved.revision_id, slug: saved.slug }),
    saved_page_source_sha256: input.saved_page_source_sha256,
  });
}

function verifyMembers(value) {
  const members = object(value, "Members observation");
  expect(members.rpc_status === "ok", "Members public RPC did not return ok");
  requireSha256(members.body_sha256, "Members body SHA-256");
  expect(Number.isSafeInteger(members.body_length) && members.body_length > 0, "Members body length is invalid");
  expect(Number.isSafeInteger(members.row_count) && members.row_count > 0, "Members public body has no rows");
  expect(members.markers?.table === true, "Members public body has no table");
  expect(members.markers?.pager === true, "Members public body has no page-one pager");
  expect(members.markers?.module_script === true, "Members public body has no MembersListModule script");
  return {
    body_sha256: members.body_sha256,
    row_count: members.row_count,
    public_markers_verified: true,
  };
}

function verifyUserInfo(value, actor) {
  const userinfo = object(value, `${actor} UserInfo observation`);
  expect(userinfo.rpc_status === "ok", `${actor} UserInfo preview did not return ok`);
  expect(userinfo.body_sha256 === USERINFO_NO_TARGET_SHA256, `${actor} UserInfo no-target body changed`);
  expect(userinfo.body_length === Buffer.byteLength(USERINFO_NO_TARGET_BODY), `${actor} UserInfo no-target body length changed`);
  return { body_sha256: userinfo.body_sha256, no_target_error_verified: true };
}

function verifySearchUsers(value, actor) {
  const searchusers = object(value, `${actor} SearchUsers observation`);
  expect(searchusers.rpc_status === "ok", `${actor} SearchUsers preview did not return ok`);
  expect(searchusers.body_sha256 === SEARCHUSERS_DISABLED_SHA256, `${actor} SearchUsers disabled body changed`);
  expect(searchusers.body_length === Buffer.byteLength(SEARCHUSERS_DISABLED_BODY), `${actor} SearchUsers disabled body length changed`);
  return { body_sha256: searchusers.body_sha256, disabled_error_verified: true };
}

export function verifyOpen43Q1032Case(caseId, observations) {
  expect(caseId === OPEN43_Q1032_CASE_IDS[0], `unsupported Q1032 case: ${caseId}`);
  const value = object(observations, `${caseId} observations`);
  const members = verifyMembers(value.members);
  const anonymous = verifyUserInfo(value.userinfo?.anonymous, "anonymous");
  const editor = verifyUserInfo(value.userinfo?.editor, "editor");
  expect(anonymous.body_sha256 === editor.body_sha256, "UserInfo actor boundary is not invariant for the no-target negative");
  const searchAnonymous = verifySearchUsers(value.searchusers?.anonymous, "anonymous");
  const searchEditor = verifySearchUsers(value.searchusers?.editor, "editor");
  expect(searchAnonymous.body_sha256 === searchEditor.body_sha256, "SearchUsers actor boundary is not invariant for the disabled state");
  return {
    verified: true,
    members,
    userinfo: { anonymous, editor, actor_invariant_no_target: true },
    searchusers: { anonymous: searchAnonymous, editor: searchEditor, actor_invariant_disabled: true },
  };
}

export function verifyOpen43Q1032Cleanup(proof, resources) {
  expect(proof?.public_absence_verified === true, "Q1032 read-only cleanup did not prove public absence");
  expect(proof.mutation_count === 0 && proof.cleanup_required === false, "Q1032 case performed or required mutation cleanup");
  expect(Array.isArray(resources) && resources.length === 0, "Q1032 read-only case recorded an unexpected resource");
  return { public_absence_verified: true, mutation_count: 0, resource_count: resources.length };
}

function verifyAjax(value) {
  const ajax = object(value, "Members Ajax observation");
  expect(ajax.http_status === 200, "Members Ajax connector did not return HTTP 200");
  expect(ajax.content_type === "text/plain; charset=UTF-8", "Members Ajax connector content type differs from the live envelope");
  requireSha256(ajax.response_body_sha256, "Members Ajax response body SHA-256");
  const json = object(ajax.json, "Members Ajax response envelope");
  expect(json.status === "ok", "Members Ajax envelope did not return ok");
  expect(typeof json.body === "string" && json.body.length > 0, "Members Ajax body is empty");
  expect(json.body.includes("<table"), "Members Ajax body has no table");
  expect(json.body.includes('<span class="pager-no">page 1 of '), "Members Ajax body has no page-one pager");
  expect(json.body.includes('OZONE.ajax.requestModule("membership/MembersListModule"'), "Members Ajax body has no MembersListModule script");
  expect(Array.isArray(json.jsInclude) && json.jsInclude.length === 0, "Members Ajax envelope changed jsInclude");
  expect(Array.isArray(json.cssInclude) && json.cssInclude.length === 0, "Members Ajax envelope changed cssInclude");
  expect(json.callbackIndex === null, "Members Ajax envelope changed callbackIndex");
  return {
    response_body_sha256: ajax.response_body_sha256,
    row_count: (json.body.match(/<tr\b/gu) ?? []).length,
    envelope_verified: true,
  };
}

function verifyAjaxEnvelopeShape(value, label) {
  const ajax = object(value, `${label} Ajax observation`);
  expect(ajax.http_status === 200, `${label} Ajax connector did not return HTTP 200`);
  expect(ajax.content_type === "text/plain; charset=UTF-8", `${label} Ajax connector content type differs from the live envelope`);
  requireSha256(ajax.response_body_sha256, `${label} Ajax response body SHA-256`);
  const json = object(ajax.json, `${label} Ajax response envelope`);
  expect(Array.isArray(json.jsInclude) && json.jsInclude.length === 0, `${label} Ajax envelope changed jsInclude`);
  expect(Array.isArray(json.cssInclude) && json.cssInclude.length === 0, `${label} Ajax envelope changed cssInclude`);
  expect(json.callbackIndex === null, `${label} Ajax envelope changed callbackIndex`);
  return {
    status: json.status,
    response_body_sha256: ajax.response_body_sha256,
    body_has_table: typeof json.body === "string" && json.body.includes("<table"),
    body_has_pager: typeof json.body === "string" && json.body.includes('<span class="pager-no">'),
    body_has_module_script: typeof json.body === "string" && json.body.includes('OZONE.ajax.requestModule("membership/MembersListModule"'),
    envelope_shape_verified: true,
  };
}

export function verifyOpen43Q1032AjaxCase(caseId, observations) {
  expect(caseId === OPEN43_Q1032_CASE_IDS[1], `unsupported Q1032 case: ${caseId}`);
  const value = object(observations, `${caseId} observations`);
  expect(JSON.stringify(value.request_form) === JSON.stringify(MEMBERS_AJAX_FORM), "Members Ajax request shape changed");
  const ajax = verifyAjax(value.response);

  const pages = value.pages;
  expect(Array.isArray(pages) && pages.length === 4, "Members Ajax page matrix drifted");
  for (const row of pages) {
    const page = object(row, "Members Ajax page matrix row");
    if (page.page === 0 || page.page === 1) {
      const verified = verifyAjaxEnvelopeShape(page.response, `page ${page.page}`);
      expect(verified.status === "ok" && verified.body_has_table && verified.body_has_pager && verified.body_has_module_script, `page ${page.page} did not return the live table matrix`);
    } else {
      const verified = verifyAjaxEnvelopeShape(page.response, `page ${page.page}`);
      expect(verified.status === "ok", `page ${page.page} did not return an ok envelope`);
    }
  }

  const outOfRange = object(value.out_of_range, "Members Ajax out-of-range boundary");
  expect(outOfRange.page === 1468, "Members Ajax out-of-range page drifted");
  const outOfRangeVerified = verifyAjaxEnvelopeShape(outOfRange.response, "out-of-range");
  expect(outOfRangeVerified.status === "ok", "Members Ajax out-of-range boundary did not return the live ok envelope");
  expect(outOfRangeVerified.body_has_table === false && outOfRangeVerified.body_has_pager === false && outOfRangeVerified.body_has_module_script === false, "Members Ajax out-of-range boundary did not return the live empty No users body");

  const matrix = value.actor_matrix;
  expect(Array.isArray(matrix) && matrix.length === 3, "Members Ajax actor matrix drifted");
  const matrixShapes = matrix.map((row) => {
    const actor = object(row, "Members Ajax actor matrix row");
    const verified = verifyAjaxEnvelopeShape(actor.response, `actor ${actor.actor}`);
    expect(verified.status === "ok", `actor ${actor.actor} did not return an ok envelope`);
    return JSON.stringify({ status: verified.status, table: verified.body_has_table, pager: verified.body_has_pager, script: verified.body_has_module_script });
  });
  expect(new Set(matrixShapes).size === 1, "Members Ajax actor matrix is not actor-invariant");

  const missing = object(value.missing_identity, "Members Ajax missing-identity boundary");
  expect(missing.envelope.json?.status === "ok", "Members Ajax missing-identity envelope drifted");
  expect(typeof missing.envelope.json?.body === "string" && missing.envelope.json.body.includes("No user specified."), "Members Ajax missing-identity error block drifted");

  return {
    verified: true,
    ajax,
    pages_matrix_verified: true,
    out_of_range_verified: true,
    actor_matrix_invariant: true,
    missing_identity_verified: true,
  };
}

function verifyDirectoryState(state, label) {
  const value = object(state, `Q1032 ${label}`);
  expect(value.members_table === true, `Q1032 ${label} members table is missing`);
  expect(value.members_pager === true, `Q1032 ${label} members page-one pager is missing`);
  expect(value.members_script === true, `Q1032 ${label} members module script is missing`);
  expect(value.searchusers_disabled === true, `Q1032 ${label} SearchUsers disabled state is missing`);
  expect(value.whoinvited_form === true, `Q1032 ${label} WhoInvited form shell is missing`);
  expect(Number.isSafeInteger(value.printuser_count) && value.printuser_count > 0, `Q1032 ${label} printuser rows are missing`);
  expect(value.printuser_listener === true, `Q1032 ${label} printuser userInfo listener is missing`);
  return {
    members_table: value.members_table,
    members_pager: value.members_pager,
    members_script: value.members_script,
    searchusers_disabled: value.searchusers_disabled,
    whoinvited_form: value.whoinvited_form,
    printuser_count: value.printuser_count,
    printuser_listener: value.printuser_listener,
  };
}

function isExpectedDirectoryCspImageFailure(value) {
  if (
    value?.failure !== "csp" ||
    value?.method !== "GET" ||
    value?.resource_type !== "image" ||
    typeof value?.url !== "string"
  ) return false;
  let url;
  try {
    url = new URL(value.url);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.wikidot.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) return false;
  if (url.pathname === "/avatar.php") return url.search.startsWith("?userid=");
  if (url.pathname === "/userkarma.php") return url.search.startsWith("?u=");
  return false;
}

export function verifyOpen43Q1032BrowserDirectoryCase(caseId, observations, plan) {
  expect(caseId === OPEN43_Q1032_CASE_IDS[2], `unsupported Q1032 case: ${caseId}`);
  const value = object(observations, `${caseId} observations`);
  const saved = object(value.saved_page, "Q1032 browser saved page");
  expect(saved.slug === plan.saved_page.slug, "Q1032 browser saved slug changed");
  expect(saved.status === 200, "Q1032 browser saved page did not return 200");
  expect(saved.url === `${plan.page_origin}/${plan.saved_page.slug}`, "Q1032 browser saved URL is wrong");
  const initial = verifyDirectoryState(value.initial, "initial directory state");
  const settled = verifyDirectoryState(value.settled, "settled directory state");
  expect(Array.isArray(value.request_methods) && value.request_methods.every((method) => ["GET", "HEAD", "OPTIONS"].includes(method)), "Q1032 browser issued a mutating request");
  expect(Array.isArray(value.failed_requests), "Q1032 browser failed-request observation is malformed");
  expect(value.failed_requests.every(isExpectedDirectoryCspImageFailure), "Q1032 browser observed an unexpected failed request");
  expect(value.mutation_detected === false, "Q1032 browser mutation was detected");
  return { verified: true, saved_page_slug: saved.slug, initial, settled, expected_csp_image_failures: value.failed_requests.length };
}

export { MEMBERS_AJAX_FORM, MEMBERS_PARAMETERS, SEARCHUSERS_DISABLED_SHA256, USERINFO_NO_TARGET_BODY, USERINFO_NO_TARGET_SHA256 };
