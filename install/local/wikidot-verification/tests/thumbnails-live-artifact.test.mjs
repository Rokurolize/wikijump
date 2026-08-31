import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const casesPath = path.join(root, "install/local/wikidot-verification/fixtures/thumbnails-live/cases.json");
const artifactPath = path.join(root, "install/local/wikidot-verification/artifacts/thumbnails-live-20260810.json");
const scriptPath = path.join(root, "install/local/wikidot-verification/scripts/capture-thumbnails-live.mjs");
const integrationCommit = "ecef9b1a42f1b31eaa9ce4ef728f8b40c79fedd2";
const specificationPath = "docs/wikidot-specifications/specifications/platform/thumbnails.md";
const documentationSourceSha256 = "4673c5df579648bef01a104fd68da19852e02d722ecb585a2753385c2471582c";
const hashPattern = /^[0-9a-f]{64}$/u;
const allowedMethods = new Set(["GET", "HEAD"]);
const allowedSchemes = new Set(["http:", "https:"]);
const forbiddenKeyPattern = /(?:authorization|cookie|credential|password|secret|session|token|set-cookie)/iu;
const forbiddenValuePattern = /(?:\/home\/|wikijump-thumbnails-live-evidence-|WIKIDOT_SESSION_ID|set-cookie|authorization:|stack trace)/iu;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ownEntries(value, entries = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => ownEntries(item, entries));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      entries.push([key, item]);
      ownEntries(item, entries);
    }
  }
  return entries;
}

function flattenProbes(cases) {
  return cases.cases.flatMap((entry) => entry.probes.map((probe) => ({...probe, case: entry})));
}

function assertSafeUrl(value, expectedInitialHost = false) {
  const url = new URL(value);
  assert.ok(allowedSchemes.has(url.protocol), value);
  assert.equal(url.username, "", value);
  assert.equal(url.password, "", value);
  assert.equal(url.search, "", value);
  assert.equal(url.hash, "", value);
  assert.ok(url.port === "" || (url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"), value);
  assert.doesNotMatch(url.hostname, /^(?:localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/iu);
  if (expectedInitialHost) assert.equal(url.hostname, "thumbnail.wdfiles.com");
}

function validateCases(cases) {
  assert.equal(cases.schema, "wikijump.thumbnails_live_cases.v1");
  assert.equal(cases.surface_id, "catalog-feature:thumbnails");
  assert.equal(cases.integration_commit, integrationCommit);
  assert.equal(cases.authority.specification_path, specificationPath);
  assert.equal(cases.authority.documentation_source_sha256, documentationSourceSha256);
  assert.equal(cases.authority.inventory_total, 893);
  assert.equal(cases.documented.host, "thumbnail.wdfiles.com");
  assert.equal(cases.documented.site.url_template, "http://thumbnail.wdfiles.com/thumbnail/site/<site_domain_name>/<size>.jpg");
  assert.equal(cases.documented.theme.url_template, "http://thumbnail.wdfiles.com/thumbnail/theme/<theme_name>/<size>.jpg");
  assert.deepEqual(cases.documented.site.sizes, [160, 80, 40, 20]);
  assert.deepEqual(cases.documented.theme.sizes, [500, 240, 160, 80]);
  assert.deepEqual(cases.safety.allowed_methods, ["GET", "HEAD"]);
  assert.deepEqual(cases.safety.allowed_initial_hosts, ["thumbnail.wdfiles.com"]);
  assert.equal(cases.safety.anonymous, true);
  assert.equal(cases.safety.possible_cache_fill_acknowledged, true);
  assert.ok(cases.budgets.maximum_logical_probes <= 64);
  assert.ok(cases.budgets.maximum_http_transactions <= 128);
  assert.ok(cases.budgets.maximum_redirect_hops_per_probe <= 5);
  assert.ok(cases.budgets.timeout_ms_per_transaction <= 15_000);
  assert.ok(cases.budgets.maximum_body_bytes_per_response <= 4 * 1024 * 1024);
  assert.ok(cases.budgets.maximum_aggregate_body_bytes <= 16 * 1024 * 1024);

  const caseIds = cases.cases.map(({case_id}) => case_id);
  assert.equal(new Set(caseIds).size, caseIds.length);
  const probes = flattenProbes(cases);
  assert.ok(probes.length <= cases.budgets.maximum_logical_probes);
  assert.equal(new Set(probes.map(({probe_id}) => probe_id)).size, probes.length);
  for (const {case: entry, method} of probes) {
    assert.ok(allowedMethods.has(method));
    assert.ok(["site", "theme"].includes(entry.route_family));
    assert.ok(["positive", "missing-identity-control", "invalid-size-control"].includes(entry.role));
    assert.ok(["http", "https"].includes(entry.scheme));
    if (entry.role === "positive") assert.ok(cases.documented[entry.route_family].sizes.includes(entry.size));
  }

  for (const family of ["site", "theme"]) {
    const familyCases = cases.cases.filter(({route_family}) => route_family === family);
    const positives = familyCases.filter(({role}) => role === "positive");
    assert.equal(new Set(positives.map(({identity}) => identity)).size, 2);
    assert.deepEqual([...new Set(positives.map(({size}) => size))].sort((a, b) => a - b), [...cases.documented[family].sizes].sort((a, b) => a - b));
    for (const positive of positives) assert.deepEqual(new Set(positive.probes.map(({method}) => method)), new Set(["GET", "HEAD"]));
    assert.ok(positives.some(({scheme}) => scheme === "http"));
    assert.ok(positives.some(({scheme}) => scheme === "https"));
    assert.ok(familyCases.filter(({role}) => role === "missing-identity-control").length >= 2);
    assert.ok(familyCases.filter(({role}) => role === "invalid-size-control").length >= 2);
    assert.equal(cases.identities.filter((identity) => identity.route_family === family && identity.known_positive).length, 2);
    for (const identity of cases.identities.filter((item) => item.route_family === family && item.known_positive)) assert.ok(identity.provenance.length > 0);
  }
}

function validateArtifact(cases, artifact) {
  if (!artifact.capture_source) {
    assert.equal(artifact.outcome, "blocked");
    assert.equal(artifact.evidence_complete, false);
    return "historical-unbound";
  }
  assert.equal(artifact.schema, "wikijump.thumbnails_live_evidence.v1");
  assert.match(artifact.capture_source.commit, /^[0-9a-f]{40}$/u);
  assert.match(artifact.capture_source.tree, /^[0-9a-f]{40}$/u);
  assert.equal(artifact.surface_id, "catalog-feature:thumbnails");
  assert.equal(artifact.integration_commit, integrationCommit);
  assert.equal(artifact.authority.specification_path, specificationPath);
  assert.equal(artifact.authority.documentation_source_sha256, documentationSourceSha256);
  assert.equal(artifact.authority.inventory_total, 893);
  assert.equal(artifact.capture_script.path, "install/local/wikidot-verification/scripts/capture-thumbnails-live.mjs");
  assert.equal(artifact.capture_script.sha256, sha256(fs.readFileSync(scriptPath)));
  assert.equal(artifact.case_manifest.path, "install/local/wikidot-verification/fixtures/thumbnails-live/cases.json");
  assert.equal(artifact.case_manifest.sha256, sha256(fs.readFileSync(casesPath)));
  assert.match(artifact.captured_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u);
  assert.deepEqual(artifact.documented, cases.documented);
  assert.deepEqual(artifact.network_budgets, cases.budgets);
  assert.equal(artifact.safety.thumbnail_requests_anonymous, true);
  assert.equal(artifact.safety.authorization_sent, false);
  assert.equal(artifact.safety.cookies_sent, false);
  assert.equal(artifact.safety.browser_used, false);
  assert.equal(artifact.safety.sandbox_content_mutated, false);
  assert.equal(artifact.safety.wikijump_runtime_queried, false);
  assert.equal(artifact.safety.possible_cache_fill_acknowledged, true);
  assert.ok(["complete", "blocked"].includes(artifact.outcome));

  const entries = ownEntries(artifact);
  for (const [key, value] of entries) {
    const safeNegativeDeclaration = (key === "authorization_sent" || key === "cookies_sent") && value === false;
    if (!safeNegativeDeclaration) assert.doesNotMatch(key, forbiddenKeyPattern);
    if (typeof value === "string") assert.doesNotMatch(value, forbiddenValuePattern);
  }
  assert.equal(JSON.stringify(artifact).includes("raw_body"), false);
  assert.equal(JSON.stringify(artifact).includes("image_bytes"), false);

  const declaredProbes = flattenProbes(cases);
  const declaredIds = new Set(declaredProbes.map(({probe_id}) => probe_id));
  const accounted = [...artifact.observations, ...artifact.unattempted_probes];
  assert.equal(accounted.length, declaredProbes.length);
  assert.equal(new Set(accounted.map(({probe_id}) => probe_id)).size, accounted.length);
  assert.deepEqual([...new Set(accounted.map(({probe_id}) => probe_id))].sort(), [...declaredIds].sort());
  assert.ok(artifact.capture_counts.logical_probe_count <= cases.budgets.maximum_logical_probes);
  assert.ok(artifact.capture_counts.transaction_count <= cases.budgets.maximum_http_transactions);
  assert.ok(artifact.capture_counts.aggregate_body_bytes <= cases.budgets.maximum_aggregate_body_bytes);

  const probeById = new Map(declaredProbes.map((probe) => [probe.probe_id, probe]));
  for (const observation of artifact.observations) {
    const declared = probeById.get(observation.probe_id);
    assert.ok(declared, observation.probe_id);
    assert.equal(observation.case_id, declared.case.case_id);
    assert.equal(observation.route_family, declared.case.route_family);
    assert.equal(observation.method, declared.method);
    assertSafeUrl(observation.request_url, true);
    if (observation.attempted === false) {
      assert.equal(observation.transactions, 0);
      assert.ok(observation.not_attempted_reason);
      continue;
    }
    assert.equal(observation.attempted, true);
    assert.ok(observation.redirect_chain.length <= cases.budgets.maximum_redirect_hops_per_probe);
    for (const hop of observation.redirect_chain) {
      assertSafeUrl(hop.request_url);
      assertSafeUrl(hop.location.url);
      assert.match(hop.location.sha256, hashPattern);
    }
    assert.ok(Number.isInteger(observation.final.status));
    assertSafeUrl(observation.final.url);
    assert.equal(typeof observation.final.headers.content_type.present, "boolean");
    assert.equal(typeof observation.final.headers.etag.present, "boolean");
    assert.equal(typeof observation.final.headers.last_modified.present, "boolean");
    assert.ok(observation.final.body_bytes <= cases.budgets.maximum_body_bytes_per_response);
    if (observation.method === "HEAD") {
      assert.equal(observation.final.body_bytes, 0);
      assert.equal(observation.final.body_sha256, null);
    } else if (observation.final.body_bytes > 0) {
      assert.match(observation.final.body_sha256, hashPattern);
    }
    if (declared.case.role === "positive" && observation.method === "GET" && observation.final.image_jpeg) {
      assert.equal(observation.final.normalized_media_type, "image/jpeg");
      assert.ok(observation.final.body_bytes > 0);
      assert.match(observation.final.body_sha256, hashPattern);
      assert.equal(observation.final.jpeg_parse.outcome, "parsed");
      assert.ok(Number.isInteger(observation.final.jpeg_parse.width) && observation.final.jpeg_parse.width > 0);
      assert.ok(Number.isInteger(observation.final.jpeg_parse.height) && observation.final.jpeg_parse.height > 0);
    }
  }

  for (const family of ["site", "theme"]) {
    const summary = artifact.rule_summaries[family];
    assert.ok(["established", "unestablished", "incomplete"].includes(summary.status));
    assert.ok(summary.positive_observation_count >= 0);
    assert.ok(summary.negative_boundary_observation_count >= 0);
  }

  if (artifact.outcome === "complete") {
    assert.equal(artifact.evidence_complete, true);
    assert.equal(artifact.blocker, null);
    for (const family of ["site", "theme"]) {
      const summary = artifact.rule_summaries[family];
      assert.equal(summary.status, "established");
      assert.ok(summary.positive_observation_count >= 2);
      assert.ok(summary.negative_boundary_observation_count >= 2);
    }
    assert.equal(artifact.unattempted_probes.length, 0);
  } else {
    assert.equal(artifact.evidence_complete, false);
    assert.ok(artifact.blocker && typeof artifact.blocker.reason === "string" && artifact.blocker.reason.length > 0);
    assert.ok(typeof artifact.blocker.stage === "string" && artifact.blocker.stage.length > 0);
    for (const family of ["site", "theme"]) assert.notEqual(artifact.rule_summaries[family].status, "established");
    assert.doesNotMatch(JSON.stringify(artifact), /(?:implemented|accepted|candidate-passed|standing-passed|promotable)\s*[:=]\s*true/iu);
  }
}

test("thumbnail live artifact is internally valid and preserves COMPLETE or BLOCKED meaning", () => {
  assert.ok(fs.existsSync(artifactPath), `required frozen artifact is absent: ${artifactPath}`);
  const cases = readJson(casesPath);
  const artifact = readJson(artifactPath);
  validateCases(cases);
  assert.ok(["historical-unbound", undefined].includes(validateArtifact(cases, artifact)));
  const boundArtifact = structuredClone(artifact);
  boundArtifact.capture_source = {commit: "0".repeat(40), tree: "0".repeat(40)};
  boundArtifact.capture_script.sha256 = sha256(fs.readFileSync(scriptPath));
  validateArtifact(cases, boundArtifact);

  const swappedSizes = structuredClone(cases);
  [swappedSizes.documented.site.sizes, swappedSizes.documented.theme.sizes] = [swappedSizes.documented.theme.sizes, swappedSizes.documented.site.sizes];
  assert.throws(() => validateCases(swappedSizes));

  const belowThreshold = structuredClone(boundArtifact);
  belowThreshold.outcome = "complete";
  belowThreshold.evidence_complete = true;
  belowThreshold.blocker = null;
  belowThreshold.unattempted_probes = [];
  belowThreshold.rule_summaries.site.status = "established";
  belowThreshold.rule_summaries.site.positive_observation_count = 1;
  belowThreshold.rule_summaries.site.negative_boundary_observation_count = 1;
  assert.throws(() => validateArtifact(cases, belowThreshold));

  const headHash = structuredClone(boundArtifact);
  const headObservation = headHash.observations.find(({method, attempted}) => method === "HEAD" && attempted);
  if (headObservation) {
    headObservation.final.body_sha256 = "0".repeat(64);
    assert.throws(() => validateArtifact(cases, headHash));
  }

  const credentialField = structuredClone(boundArtifact);
  credentialField.capture_policy = {cookie_value: "forbidden"};
  assert.throws(() => validateArtifact(cases, credentialField));

  const blockerMissing = structuredClone(boundArtifact);
  blockerMissing.outcome = "blocked";
  blockerMissing.evidence_complete = false;
  blockerMissing.blocker = null;
  blockerMissing.rule_summaries.site.status = "unestablished";
  blockerMissing.rule_summaries.theme.status = "unestablished";
  assert.throws(() => validateArtifact(cases, blockerMissing));

  const blockedEstablished = structuredClone(boundArtifact);
  blockedEstablished.outcome = "blocked";
  blockedEstablished.evidence_complete = false;
  blockedEstablished.blocker = {reason: "insufficient_rule_boundary", stage: "rule_evaluation"};
  blockedEstablished.rule_summaries.site.status = "established";
  assert.throws(() => validateArtifact(cases, blockedEstablished));
});
