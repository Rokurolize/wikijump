import { createHash } from "node:crypto";

import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_Q1032_CASE_IDS = Object.freeze([
  "Q1032_EXACT_CANDIDATE_DIRECTORY_MATRIX",
]);

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

const USERINFO_NO_TARGET_BODY = "\n\n<div class=\"error-block\">No user specified.</div>";
const USERINFO_NO_TARGET_SHA256 = createHash("sha256")
  .update(USERINFO_NO_TARGET_BODY)
  .digest("hex");
const SEARCHUSERS_DISABLED_BODY = "\n\n<div class=\"error-block\">User search has been (temporarily) disabled. Sorry!</div>";
const SEARCHUSERS_DISABLED_SHA256 = createHash("sha256")
  .update(SEARCHUSERS_DISABLED_BODY)
  .digest("hex");
const MEMBERS_PARAMETERS = Object.freeze({ group: "", order: "joined", page: "1" });

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
  return input;
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

export { MEMBERS_PARAMETERS, SEARCHUSERS_DISABLED_SHA256, USERINFO_NO_TARGET_BODY, USERINFO_NO_TARGET_SHA256 };
