import { createHash } from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const CASE_RESULTS = new Set(["accepted", "rejected", "unchanged", "unknown"]);

function fail(message) {
  throw new Error(message);
}

function object(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function string(value, name) {
  if (typeof value !== "string") fail(`${name} must be a string`);
  return value;
}

function nonEmptyString(value, name) {
  const result = string(value, name);
  if (result.length === 0) fail(`${name} must not be empty`);
  return result;
}

function integer(value, name) {
  if (!Number.isSafeInteger(value)) fail(`${name} must be a safe integer`);
  return value;
}

function hash(value, name) {
  const result = nonEmptyString(value, name);
  if (!SHA256.test(result)) fail(`${name} must be a lowercase SHA-256`);
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function payloadBytes(caseDefinition) {
  return Buffer.from(nonEmptyString(caseDefinition.payload_utf8, `${caseDefinition.case_id}.payload_utf8`), "utf8");
}

function exactCaseDefinitions(fixture) {
  if (!Array.isArray(fixture.cases) || !Array.isArray(fixture.case_order) || fixture.cases.length !== fixture.case_order.length) fail("upload policy fixture case denominator is invalid");
  const cases = fixture.cases;
  const byId = new Map();
  for (const [index, value] of cases.entries()) {
    const current = object(value, `fixture.cases[${index}]`);
    const caseId = nonEmptyString(current.case_id, `fixture.cases[${index}].case_id`);
    if (byId.has(caseId)) fail(`upload policy fixture repeats case ${caseId}`);
    if (fixture.case_order[index] !== caseId) fail("upload policy fixture case order drifted");
    const sourceFilename = nonEmptyString(current.source_filename, `${caseId}.source_filename`);
    if (current.override_name !== null && typeof current.override_name !== "string") fail(`${caseId}.override_name must be a string or null`);
    payloadBytes(current);
    byId.set(caseId, { case_id: caseId, source_filename: sourceFilename, override_name: current.override_name, payload_utf8: current.payload_utf8 });
  }
  return { cases, byId };
}

export function validateOpen43M1062UploadPolicyFixture(fixture) {
  object(fixture, "upload policy fixture");
  if (fixture.schema !== "wikidot.live.open43.m1062.upload-policy.cases.v1") fail("unsupported upload policy fixture schema");
  if (fixture.site !== "sandbox-for-codex") fail("upload policy fixture site is outside the allowlisted mutation sandbox");
  if (!Array.isArray(fixture.target_surface_ids) || fixture.target_surface_ids.length !== 1 || fixture.target_surface_ids[0] !== "open43-audit-case:M1062_DUPLICATE_AND_UNICODE_POLICY") fail("upload policy fixture target surface drifted");
  const preflight = object(fixture.preflight, "upload policy fixture preflight");
  if (preflight.browser_forbidden !== true || preflight.database_forbidden !== true || preflight.mutation_requires_explicit_flag !== true || preflight.must_start_with_empty_inventory !== true || preflight.must_finish_with_no_run_owned_page !== true) fail("upload policy fixture weakened a safety boundary");
  if (preflight.max_uploads !== fixture.case_order.length) fail("upload policy fixture upload budget does not equal its denominator");
  const { cases } = exactCaseDefinitions(fixture);
  if (cases.length !== 5 || cases[0].source_filename !== "same-name.txt" || cases[1].source_filename !== "same-name.txt" || cases[2].source_filename !== "資料.txt" || cases[3].override_name !== "" || cases[4].override_name !== "override-name.txt") fail("upload policy fixture does not cover the bounded naming matrix");
  if (!Array.isArray(fixture.observation_contract) || fixture.observation_contract.length < 4) fail("upload policy fixture observation contract is incomplete");
  return fixture;
}

function inventory(value, name) {
  if (!Array.isArray(value)) fail(`${name} must be an array`);
  return value.map((entry, index) => {
    const row = object(entry, `${name}[${index}]`);
    return {
      file_id: integer(row.file_id, `${name}[${index}].file_id`),
      name: nonEmptyString(row.name, `${name}[${index}].name`),
      url: nonEmptyString(row.url, `${name}[${index}].url`),
      mime_type: nonEmptyString(row.mime_type, `${name}[${index}].mime_type`),
      size: integer(row.size, `${name}[${index}].size`),
    };
  });
}

function response(value, name) {
  const current = object(value, name);
  const status = integer(current.http_status, `${name}.http_status`);
  if (status < 100 || status > 599) fail(`${name}.http_status is outside the HTTP range`);
  if (current.content_type !== null) string(current.content_type, `${name}.content_type`);
  if (current.location !== null) string(current.location, `${name}.location`);
  integer(current.body_size, `${name}.body_size`);
  if (current.body_size < 0) fail(`${name}.body_size must not be negative`);
  hash(current.body_sha256, `${name}.body_sha256`);
  return current;
}

function verifyCase(entry, expected, index) {
  const current = object(entry, `artifact.cases[${index}]`);
  if (current.case_id !== expected.case_id) fail("upload policy artifact case order drifted");
  const request = object(current.request, `${expected.case_id}.request`);
  if (request.source_filename !== expected.source_filename || request.override_name !== expected.override_name) fail(`${expected.case_id} request naming inputs drifted`);
  const bytes = payloadBytes(expected);
  if (request.byte_length !== bytes.length || request.payload_sha256 !== sha256(bytes)) fail(`${expected.case_id} request bytes do not bind the fixture payload`);
  response(current.response, `${expected.case_id}.response`);
  inventory(current.inventory_before, `${expected.case_id}.inventory_before`);
  inventory(current.inventory_after, `${expected.case_id}.inventory_after`);
  if (!Array.isArray(current.new_file_ids) || current.new_file_ids.some((value) => !Number.isSafeInteger(value))) fail(`${expected.case_id}.new_file_ids is invalid`);
  if (!CASE_RESULTS.has(current.result)) fail(`${expected.case_id}.result is not a bounded observation classification`);
  if (!Array.isArray(current.displayed_names) || current.displayed_names.some((value) => typeof value !== "string")) fail(`${expected.case_id}.displayed_names is invalid`);
}

function secretFree(value) {
  const serialized = JSON.stringify(value);
  if (/(?:WIKIDOT_(?:USERNAME|PASSWORD|EMAIL|SESSION_ID)|wikidot_token7|lock[_-]?(?:id|secret)|csrf|set-cookie|authorization|cookie\s*:)/iu.test(serialized)) fail("upload policy artifact contains credential or session material");
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(serialized)) fail("upload policy artifact contains an email address");
}

export function verifyOpen43M1062UploadPolicyArtifact(fixture, artifact, { fixtureSha256 = null, producerSha256 = null } = {}) {
  validateOpen43M1062UploadPolicyFixture(fixture);
  object(artifact, "upload policy artifact");
  if (artifact.schema !== "wikidot.live.open43.m1062.upload-policy.v1") fail("unsupported upload policy artifact schema");
  if (!new Set(["observed", "blocked", "failed"]).has(artifact.status)) fail("upload policy artifact status is invalid");
  nonEmptyString(artifact.run_id, "artifact.run_id");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/u.test(artifact.run_id)) fail("artifact.run_id is invalid");
  if (artifact.site !== fixture.site) fail("upload policy artifact site drifted");
  if (JSON.stringify(artifact.target_surface_ids) !== JSON.stringify(fixture.target_surface_ids)) fail("upload policy artifact target surface drifted");
  const source = object(artifact.source_identity, "artifact.source_identity");
  if (!SHA1.test(source.wikijump_commit)) fail("artifact.source_identity.wikijump_commit is invalid");
  if (fixtureSha256 !== null && artifact.fixture_sha256 !== fixtureSha256) fail("upload policy artifact fixture hash drifted");
  if (producerSha256 !== null && artifact.producer_sha256 !== producerSha256) fail("upload policy artifact producer hash drifted");
  if (!Array.isArray(artifact.promoted_rules) || artifact.promoted_rules.length !== 0) fail("upload policy verifier cannot promote an unreviewed naming rule");
  const cleanup = object(artifact.cleanup, "artifact.cleanup");
  if (cleanup.verified !== true || cleanup.page_absent !== true || !Array.isArray(cleanup.remaining_run_owned_objects) || cleanup.remaining_run_owned_objects.length !== 0) fail("upload policy artifact does not prove run-owned cleanup");
  if (artifact.status === "blocked") {
    if (artifact.mutation_performed !== false || !Array.isArray(artifact.cases) || artifact.cases.length !== 0) fail("blocked upload policy evidence must contain no mutation observations");
    nonEmptyString(artifact.blocked_reason, "artifact.blocked_reason");
    secretFree(artifact);
    return { verified: true, status: "blocked", policy_promoted: false };
  }
  if (artifact.status === "failed") fail("failed upload policy evidence is not an acceptance artifact");
  if (artifact.mutation_performed !== true || !Array.isArray(artifact.cases) || artifact.cases.length !== fixture.cases.length) fail("observed upload policy evidence is incomplete");
  const { byId } = exactCaseDefinitions(fixture);
  for (const [index, entry] of artifact.cases.entries()) verifyCase(entry, byId.get(fixture.case_order[index]), index);
  const baseline = inventory(artifact.baseline_inventory, "artifact.baseline_inventory");
  if (baseline.length !== 0) fail("upload policy run did not start with an empty file inventory");
  if (artifact.policy_observations !== "recorded_without_promotion") fail("upload policy observations were assigned an unsupported authority level");
  secretFree(artifact);
  return { verified: true, status: "observed", policy_promoted: false, case_count: artifact.cases.length };
}
