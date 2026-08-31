import { createHash } from "node:crypto";

import { parse as parseDevalue } from "devalue";

import { isPlainObject, requireNonEmptyString, requireSha256, sha256Value } from "./standing-browser-parity-util.mjs";

const SHA512 = /^[0-9a-f]{128}$/u;
const ACTION_EVENTS = Object.freeze([
  ["framerail", "fileUpload", "POST"],
  ["deepwell", "page_get_files", "POST"],
  ["wws", "action-original-get", "GET"],
  ["wws", "action-original-head", "HEAD"],
  ["wws", "action-resized-get", "GET"],
  ["wws", "action-resized-head", "HEAD"],
]);

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, name) {
  expect(isPlainObject(value), `${name} must be an object`);
  return value;
}

function integer(value, name) {
  expect(Number.isSafeInteger(value), `${name} must be an integer`);
  return value;
}

function bytesFromBase64(value, name) {
  const text = requireNonEmptyString(value, name);
  const bytes = Buffer.from(text, "base64");
  expect(bytes.length > 0 && bytes.toString("base64") === text, `${name} must be canonical non-empty base64`);
  return bytes;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function missingRoute(value, name) {
  const route = object(value, name);
  const head = object(route.head, `${name}.head`);
  const wikidotMissingOriginal = route.status === 200
    && route.content_type === "text/html; charset=utf-8"
    && route.body_sha256 === "eabe424dd70c56173c2cfcfe8ca6b328ef2077d6ce9b3243540148a2d76f20ab";
  expect((route.status === 404 || wikidotMissingOriginal) && head.status === 404 && head.body_size === 0, `${name} must be absent through GET and HEAD`);
  return { get_status: route.status, head_status: 404 };
}

function matchingRow(inventory, fileName, name) {
  expect(Array.isArray(inventory), `${name} must be an array`);
  const rows = inventory.filter((row) => row?.name === fileName);
  expect(rows.length === 1, `${name} must contain exactly one ${fileName} row`);
  return rows[0];
}

function fileRow(value, fileName, input, plan, name) {
  const row = object(value, name);
  const result = {
    file_id: integer(row.file_id, `${name}.file_id`),
    revision_id: integer(row.revision_id, `${name}.revision_id`),
    revision_user_id: integer(row.revision_user_id, `${name}.revision_user_id`),
    name: requireNonEmptyString(row.name, `${name}.name`),
    mime: requireNonEmptyString(row.mime, `${name}.mime`),
    size: integer(row.size, `${name}.size`),
    s3_hash: requireNonEmptyString(row.s3_hash, `${name}.s3_hash`),
  };
  expect(SHA512.test(result.s3_hash), `${name}.s3_hash must be a lowercase SHA-512`);
  expect(result.revision_user_id === plan.editor_user_id, `${name} does not bind the fixed editor actor`);
  expect(result.name === fileName && result.mime === input.inventoryMime && result.size === input.bytes.length, `${name} does not match the fixed public file identity`);
  return result;
}

function headMatches(route, etag, name) {
  const head = object(route.head, `${name}.head`);
  expect(head.status === 200 && head.etag === etag && head.body_size === 0, `${name} HEAD did not preserve GET identity without a body`);
}

function download(value, input, row, name) {
  const route = object(value, name);
  expect(route.status === 200 && String(route.content_type).startsWith(input.mime), `${name} returned the wrong status or content type`);
  const bytes = bytesFromBase64(route.body_base64, `${name}.body_base64`);
  const bodySha256 = requireSha256(route.body_sha256, `${name}.body_sha256`);
  expect(sha256(bytes) === bodySha256 && bodySha256 === input.sha256 && bytes.length === input.bytes.length, `${name} returned bytes outside the fixed input`);
  const etag = `"${row.s3_hash}"`;
  expect(route.etag === etag, `${name} ETag does not bind the active blob`);
  headMatches(route, etag, name);
  return { body_sha256: bodySha256, etag };
}

function localIconCase(observations, plan) {
  const value = object(observations, "M756 local icon observation");
  const file = fileRow(value.file, plan.file_names.action_upload, plan.inputs.initial, plan, "M756 local icon file");
  const expectedSource = `/local--files/${encodeURIComponent(plan.page_slug)}/${encodeURIComponent(plan.file_names.action_upload)}`;
  expect(value.configured_source === expectedSource && value.site?.favicon_source === expectedSource, "M756 configured favicon source is not the run-owned local file");
  const route = object(value.route, "M756 local icon route");
  expect(route.source === expectedSource, "M756 local icon source path drifted");
  expect(route.favicon?.status === 302 && new URL(route.favicon.location, "https://candidate.invalid").pathname === expectedSource, "M756 favicon route did not redirect to the configured local file");
  expect(route.source_on_page_host?.status === 302 && new URL(route.source_on_page_host.location).hostname.endsWith(".wjfiles.localhost"), "M756 local-file page-host route did not cross to the candidate files origin");
  const legacy = download(route.legacy_on_files_host, plan.inputs.initial, file, "M756 anonymous legacy local-file bytes");
  const original = download(route.original, plan.inputs.initial, file, "M756 anonymous local icon bytes");
  expect(legacy.body_sha256 === original.body_sha256 && legacy.etag === original.etag, "M756 legacy and canonical file routes do not bind the same public blob");
  return { source: expectedSource, body_sha256: original.body_sha256, anonymous_visibility_verified: true, route_identity_verified: true };
}

function resized(value, row, plan, name) {
  const route = object(value, name);
  expect(route.status === 200 && String(route.content_type).startsWith("image/jpeg"), `${name} did not return JPEG`);
  const bytes = bytesFromBase64(route.body_base64, `${name}.body_base64`);
  expect(bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, `${name} did not return JPEG bytes`);
  const bodySha256 = requireSha256(route.body_sha256, `${name}.body_sha256`);
  expect(sha256(bytes) === bodySha256, `${name} body hash does not bind its public bytes`);
  const etag = `"wikijump-jpeg-v1-${row.revision_id}-${row.s3_hash}-${plan.resized_variant}"`;
  expect(route.etag === etag, `${name} ETag does not bind the active file revision`);
  headMatches(route, etag, name);
  return { body_sha256: bodySha256, etag };
}

function actionResult(value, type, name) {
  const action = object(value, name);
  const body = requireNonEmptyString(action.response_body, `${name}.response_body`);
  expect(action.http_status === 200 && String(action.content_type).startsWith("application/json"), `${name} did not return HTTP JSON`);
  expect(sha256(Buffer.from(body)) === action.response_body_sha256, `${name} response hash does not bind its public bytes`);
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(`${name} is not a serialized SvelteKit ActionResult`);
  }
  expect(isPlainObject(result) && result.type === type && Number.isSafeInteger(result.status) && typeof result.data === "string", `${name} is not a serialized SvelteKit ActionResult`);
  try {
    parseDevalue(result.data);
  } catch {
    throw new Error(`${name} ActionResult data is not valid devalue`);
  }
  expect(type === "success" ? result.status === 200 : result.status >= 400, `${name} serialized the wrong action outcome`);
  return { action_type: result.type, action_status: result.status, response_body_sha256: action.response_body_sha256 };
}

function mutationCase(observations, plan) {
  const upload = object(observations.after_upload, "after_upload");
  const first = fileRow(matchingRow(upload.inventory, plan.file_names.action_upload, "after_upload.inventory"), plan.file_names.action_upload, plan.inputs.initial, plan, "after_upload.file");
  download(upload.original, plan.inputs.initial, first, "uploaded original");

  const rename = object(observations.after_rename, "after_rename");
  const renamed = fileRow(matchingRow(rename.inventory, plan.file_names.renamed, "after_rename.inventory"), plan.file_names.renamed, plan.inputs.initial, plan, "after_rename.file");
  expect(renamed.file_id === first.file_id && renamed.revision_id !== first.revision_id && renamed.s3_hash === first.s3_hash, "rename did not produce the next revision of the same blob");
  missingRoute(rename.old_original, "renamed old original");
  download(rename.new_original, plan.inputs.initial, renamed, "renamed original");

  const revision = object(observations.after_revision, "after_revision");
  const revised = fileRow(matchingRow(revision.inventory, plan.file_names.renamed, "after_revision.inventory"), plan.file_names.renamed, plan.inputs.revision, plan, "after_revision.file");
  expect(revised.file_id === first.file_id && revised.revision_id !== renamed.revision_id && revised.s3_hash !== renamed.s3_hash, "revision did not change the active public blob identity");
  download(revision.original, plan.inputs.revision, revised, "revised original");

  const deleted = object(observations.after_delete, "after_delete");
  expect(Array.isArray(deleted.inventory) && !deleted.inventory.some((row) => row?.name === plan.file_names.renamed), "deleted file remained in the next authorized inventory");
  missingRoute(deleted.original, "deleted original");
  missingRoute(deleted.resized, "deleted resized");
  return { file_id: first.file_id, upload_revision_id: first.revision_id, rename_revision_id: renamed.revision_id, replacement_revision_id: revised.revision_id };
}

function resizedCase(observations, plan) {
  const initial = object(observations.initial, "resized.initial");
  const first = fileRow(initial.file, plan.file_names.action_upload, plan.inputs.initial, plan, "resized.initial.file");
  download(initial.original, plan.inputs.initial, first, "initial original");
  const initialResized = resized(initial.resized, first, plan, "initial resized");

  const rename = object(observations.after_rename, "resized.after_rename");
  const renamed = fileRow(rename.file, plan.file_names.renamed, plan.inputs.initial, plan, "resized.after_rename.file");
  missingRoute(rename.old_original, "renamed old original");
  missingRoute(rename.old_resized, "renamed old resized");
  download(rename.new_original, plan.inputs.initial, renamed, "renamed new original");
  const renamedResized = resized(rename.new_resized, renamed, plan, "renamed new resized");
  expect(renamedResized.body_sha256 === initialResized.body_sha256 && renamedResized.etag !== initialResized.etag, "rename did not preserve derivative bytes under a new revision ETag");

  const revision = object(observations.after_revision, "resized.after_revision");
  const revised = fileRow(revision.file, plan.file_names.renamed, plan.inputs.revision, plan, "resized.after_revision.file");
  download(revision.original, plan.inputs.revision, revised, "revised original");
  const revisedResized = resized(revision.resized, revised, plan, "revised resized");
  expect(revisedResized.body_sha256 !== initialResized.body_sha256 && revisedResized.etag !== initialResized.etag, "replacement left the resized blob identity stale");
  const deleted = object(observations.after_delete, "resized.after_delete");
  missingRoute(deleted.original, "deleted original");
  missingRoute(deleted.resized, "deleted resized");
  return { initial_etag: initialResized.etag, renamed_etag: renamedResized.etag, replacement_etag: revisedResized.etag };
}

function serializableActionCase(observations, plan) {
  const successful = actionResult(observations.successful_action, "success", "successful multipart action");
  const failed = actionResult(observations.failed_action, "failure", "failed multipart action");
  expect(Array.isArray(observations.inventory_before_failed_action) && Array.isArray(observations.inventory_after_failed_action), "failed action inventories must be arrays");
  expect(sha256Value(observations.inventory_before_failed_action) === sha256Value(observations.inventory_after_failed_action), "failed multipart action changed the public inventory");
  missingRoute(observations.failed_route, "failed multipart route");
  matchingRow(observations.inventory_after_failed_action, plan.file_names.action_upload, "failed action post-inventory");
  const failedPut = object(observations.failed_put, "failed PUT cleanup");
  expect(requireNonEmptyString(failedPut.upload_error, "failed PUT cleanup.upload_error"), "failed PUT did not fail");
  expect(Array.isArray(failedPut.adapter_events) && failedPut.adapter_events.length === 4, "failed PUT cleanup event denominator is wrong");
  const expectedEvents = [
    ["deepwell", "page_edit_permission", "POST", 200],
    ["deepwell", "blob_upload", "POST", 200],
    ["object-store", "presigned_put", "PUT", null],
    ["deepwell", "blob_cancel", "POST", 200],
  ];
  failedPut.adapter_events.forEach((event, index) => {
    const [service, operation, method, status] = expectedEvents[index];
    expect(event?.sequence === index + 1 && event.service === service && event.operation === operation && event.method === method, "failed PUT cleanup events are wrong or out of order");
    if (status === null) expect(event.response_status < 200 || event.response_status >= 300, "failed PUT unexpectedly succeeded");
    else expect(event.response_status === status, "failed PUT cleanup response status is wrong");
  });
  expect(failedPut.adapter_events.every((event) => event.operation !== "file_create"), "failed PUT attempted file_create");
  return { successful, failed, failed_action_left_inventory_unchanged: true, failed_put_cancelled_without_file_create: true };
}

function uploadOrderCase(observations, plan) {
  const before = object(observations.before_action, "before_action");
  expect(Array.isArray(before.inventory) && before.inventory.length === 0, "upload file was publicly visible before the action");
  missingRoute(before.original, "pre-action original");
  actionResult(observations.action, "success", "ordered multipart action");
  const after = object(observations.after_action, "after_action");
  const row = fileRow(matchingRow(after.inventory, plan.file_names.action_upload, "after_action.inventory"), plan.file_names.action_upload, plan.inputs.initial, plan, "after_action.file");
  download(after.original, plan.inputs.initial, row, "post-action original");
  resized(after.resized, row, plan, "post-action resized");
  expect(Array.isArray(observations.adapter_events) && observations.adapter_events.length === ACTION_EVENTS.length, "ordered action event denominator is wrong");
  observations.adapter_events.forEach((event, index) => {
    const [service, operation, method] = ACTION_EVENTS[index];
    expect(event?.sequence === index + 1 && event.service === service && event.operation === operation && event.method === method && event.response_status === 200, "ordered action adapter events are wrong or out of order");
  });
  expect(observations.event_scope === "adapter-issued-external-requests-only", "upload order evidence overclaims server-internal observation");
  return { external_request_order_verified: true, public_visibility_observed_only_after_action_response: true, internal_order_owner: "framerail/tests/page-file-upload-lifecycle.test.js" };
}

export function verifyOpen43MediaCase(caseId, observations, plan) {
  object(observations, `${caseId} observations`);
  let verification;
  if (caseId === "M756_LOCAL_ROUTE_BYTES") verification = localIconCase(observations, plan);
  else if (caseId === "M1039_MUTATION_TO_NEXT_READ") verification = mutationCase(observations, plan);
  else if (caseId === "M1043_RESIZED_BLOB_IDENTITY") verification = resizedCase(observations, plan);
  else if (caseId === "M1062_SERIALIZABLE_ACTION_RESPONSE") verification = serializableActionCase(observations, plan);
  else if (caseId === "M1062_UPLOAD_TRANSACTION_ORDER") verification = uploadOrderCase(observations, plan);
  else throw new Error(`unsupported Open43 media case: ${caseId}`);
  return { verified: true, ...verification };
}
