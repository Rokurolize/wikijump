#!/usr/bin/env node

import crypto from "node:crypto";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const scriptRelativePath = "install/local/wikidot-verification/scripts/capture-thumbnails-live.mjs";
const expectedSchema = "wikijump.thumbnails_live_cases.v1";
const expectedSurface = "catalog-feature:thumbnails";
const expectedHost = "thumbnail.wdfiles.com";
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const headerNames = ["content-type", "content-length", "cache-control", "etag", "last-modified", "expires", "age", "vary", "x-cache", "cf-cache-status", "via"];

class LiveBlock extends Error {
  constructor(reason, stage, details = {}) {
    super(reason);
    this.reason = reason;
    this.stage = stage;
    this.details = details;
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sourceIdentity() {
  const git = (args) => childProcess.execFileSync("git", args, {cwd: repositoryRoot, encoding: "utf8"}).trim();
  const commit = git(["rev-parse", "HEAD"]);
  const tree = git(["rev-parse", "HEAD^{tree}"]);
  if (git(["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("Capture requires a clean source checkout");
  return {commit, tree};
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value || !["--cases", "--output", "--integration-commit"].includes(name)) throw new Error(`Unknown or incomplete argument: ${name}`);
    if (values[name]) throw new Error(`Duplicate argument: ${name}`);
    values[name] = value;
  }
  for (const name of ["--cases", "--output", "--integration-commit"]) if (!values[name]) throw new Error(`Missing required argument: ${name}`);
  return {
    cases: path.resolve(values["--cases"]),
    output: path.resolve(values["--output"]),
    integrationCommit: values["--integration-commit"]
  };
}

function validateCases(cases, integrationCommit) {
  if (cases.schema !== expectedSchema || cases.surface_id !== expectedSurface) throw new Error("Unexpected thumbnail case-manifest identity");
  if (cases.integration_commit !== integrationCommit) throw new Error("Integration commit does not match the case manifest");
  if (cases.documented?.host !== expectedHost) throw new Error("Unexpected thumbnail host");
  if (JSON.stringify(cases.documented.site.sizes) !== JSON.stringify([160, 80, 40, 20])) throw new Error("Unexpected documented site sizes");
  if (JSON.stringify(cases.documented.theme.sizes) !== JSON.stringify([500, 240, 160, 80])) throw new Error("Unexpected documented theme sizes");
  const probes = cases.cases.flatMap((entry) => entry.probes.map((probe) => ({entry, probe})));
  if (probes.length === 0 || probes.length > cases.budgets.maximum_logical_probes || cases.budgets.maximum_logical_probes > 64) throw new Error("Logical probe budget is invalid");
  if (cases.budgets.maximum_http_transactions > 128 || cases.budgets.maximum_redirect_hops_per_probe > 5 || cases.budgets.timeout_ms_per_transaction > 15_000 || cases.budgets.maximum_body_bytes_per_response > 4 * 1024 * 1024 || cases.budgets.maximum_aggregate_body_bytes > 16 * 1024 * 1024) throw new Error("Network budget exceeds the lane envelope");
  const probeIds = probes.map(({probe}) => probe.probe_id);
  if (new Set(probeIds).size !== probeIds.length) throw new Error("Probe IDs must be unique");
  const allowedInitialHosts = new Set(cases.safety.allowed_initial_hosts);
  for (const {entry, probe} of probes) {
    if (!cases.safety.allowed_methods.includes(probe.method) || !["GET", "HEAD"].includes(probe.method)) throw new Error(`Unsafe method in ${probe.probe_id}`);
    if (!allowedInitialHosts.has(expectedHost)) throw new Error("Initial-host policy omits the thumbnail host");
    if (!["site", "theme"].includes(entry.route_family) || !["http", "https"].includes(entry.scheme)) throw new Error(`Invalid route declaration in ${entry.case_id}`);
    if (!/^[a-z0-9.-]+$/u.test(entry.identity) || !Number.isInteger(entry.size) || entry.size < 0) throw new Error(`Invalid route components in ${entry.case_id}`);
  }
  return probes;
}

function requestUrl(entry) {
  return `${entry.scheme}://${expectedHost}/thumbnail/${entry.route_family}/${entry.identity}/${entry.size}.jpg`;
}

function isUnsafeHostname(hostname) {
  const value = hostname.toLowerCase().replace(/\.$/u, "");
  return value === "localhost" || value === "0.0.0.0" || value === "::1" || /^(?:127\.|10\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(value) || /^(?:fc|fd|fe80)/u.test(value);
}

function validatePublicUrl(value, cases, initial) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new LiveBlock("unsafe_redirect", "redirect_policy", {url: sanitizedUrl(url)});
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) throw new LiveBlock("unsafe_redirect", "redirect_policy", {url: sanitizedUrl(url)});
  if (isUnsafeHostname(url.hostname)) throw new LiveBlock("unsafe_redirect", "redirect_policy", {url: sanitizedUrl(url)});
  const allowed = initial ? cases.safety.allowed_initial_hosts : cases.safety.authorized_redirect_hosts;
  if (!allowed.includes(url.hostname)) throw new LiveBlock("unsafe_redirect", "redirect_policy", {url: sanitizedUrl(url)});
  return url;
}

function sanitizedUrl(url) {
  const result = new URL(url.href);
  result.username = "";
  result.password = "";
  result.search = "";
  result.hash = "";
  return result.href;
}

function selectedHeaders(headers) {
  return Object.fromEntries(headerNames.map((name) => {
    const value = headers.get(name);
    return [name.replaceAll("-", "_"), {present: value !== null, value}];
  }));
}

function parseJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return {outcome: "not_jpeg", width: null, height: null};
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
      return {outcome: "parsed", width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3)};
    }
    offset += length;
  }
  return {outcome: "jpeg_dimensions_unavailable", width: null, height: null};
}

async function boundedBody(response, method, state, budgets) {
  if (method === "HEAD" || response.status === 304 || !response.body) {
    if (response.body) await response.body.cancel();
    return Buffer.alloc(0);
  }
  const chunks = [];
  let count = 0;
  const reader = response.body.getReader();
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > budgets.maximum_body_bytes_per_response || state.aggregateBodyBytes + count > budgets.maximum_aggregate_body_bytes) {
      await reader.cancel();
      throw new LiveBlock("capture_budget_exceeded", "body_read", {body_bytes_before_abort: count});
    }
    chunks.push(Buffer.from(value));
  }
  state.aggregateBodyBytes += count;
  return Buffer.concat(chunks, count);
}

function networkBlock(error) {
  if (error instanceof LiveBlock) return error;
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return new LiveBlock("public_host_unreachable", "transaction_timeout", {stable_error_code: "timeout"});
  const code = error?.cause?.code ?? error?.code ?? "network_error";
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return new LiveBlock("dns_failure", "network", {stable_error_code: code});
  if (/^(?:ERR_TLS|CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO)/u.test(code)) return new LiveBlock("tls_failure", "network", {stable_error_code: code});
  return new LiveBlock("public_host_unreachable", "network", {stable_error_code: String(code)});
}

async function captureProbe(cases, entry, probe, state, prior) {
  const initialUrl = requestUrl(entry);
  if (probe.kind === "conditional") {
    const baseline = prior.get(probe.baseline_probe_id);
    const etag = baseline?.final.headers.etag.value;
    const modified = baseline?.final.headers.last_modified.value;
    if (!etag && !modified) {
      return {
        probe_id: probe.probe_id,
        case_id: entry.case_id,
        role: entry.role,
        route_family: entry.route_family,
        method: probe.method,
        probe_kind: probe.kind,
        request_url: initialUrl,
        attempted: false,
        transactions: 0,
        not_attempted_reason: "baseline_supplied_no_etag_or_last_modified"
      };
    }
  }

  let current = validatePublicUrl(initialUrl, cases, true);
  const redirects = [];
  const conditionalHeaders = {};
  if (probe.kind === "conditional") {
    const baseline = prior.get(probe.baseline_probe_id);
    if (baseline.final.headers.etag.value) conditionalHeaders["if-none-match"] = baseline.final.headers.etag.value;
    else conditionalHeaders["if-modified-since"] = baseline.final.headers.last_modified.value;
  }
  for (let redirectCount = 0; redirectCount <= cases.budgets.maximum_redirect_hops_per_probe; redirectCount += 1) {
    if (state.transactionCount >= cases.budgets.maximum_http_transactions) throw new LiveBlock("capture_budget_exceeded", "transaction_budget");
    state.transactionCount += 1;
    let response;
    try {
      response = await fetch(current, {
        method: probe.method,
        redirect: "manual",
        headers: conditionalHeaders,
        signal: AbortSignal.timeout(cases.budgets.timeout_ms_per_transaction)
      });
    } catch (error) {
      throw networkBlock(error);
    }
    if (redirectStatuses.has(response.status)) {
      if (redirectCount === cases.budgets.maximum_redirect_hops_per_probe) throw new LiveBlock("capture_budget_exceeded", "redirect_budget", {status: response.status});
      const location = response.headers.get("location");
      if (!location) throw new LiveBlock("unsafe_redirect", "redirect_policy", {status: response.status, stable_error_code: "missing_location"});
      const destination = new URL(location, current);
      const locationRecord = {url: sanitizedUrl(destination), sha256: sha256(location), had_query: destination.search !== ""};
      redirects.push({request_url: sanitizedUrl(current), status: response.status, location: locationRecord});
      if (destination.search) throw new LiveBlock("unsafe_redirect", "redirect_policy", {status: response.status, location: locationRecord});
      current = validatePublicUrl(destination, cases, false);
      continue;
    }
    const body = await boundedBody(response, probe.method, state, cases.budgets);
    const headers = selectedHeaders(response.headers);
    const normalizedMediaType = headers.content_type.value?.split(";", 1)[0].trim().toLowerCase() ?? null;
    const jpegParse = probe.method === "GET" && body.length > 0 ? parseJpegDimensions(body) : {outcome: "not_parsed", width: null, height: null};
    return {
      probe_id: probe.probe_id,
      case_id: entry.case_id,
      role: entry.role,
      route_family: entry.route_family,
      identity: entry.identity,
      size: entry.size,
      method: probe.method,
      probe_kind: probe.kind,
      request_url: initialUrl,
      attempted: true,
      transactions: redirects.length + 1,
      conditional_request: probe.kind === "conditional" ? {based_on_probe_id: probe.baseline_probe_id, validator: conditionalHeaders["if-none-match"] ? "etag" : "last_modified"} : null,
      redirect_chain: redirects,
      final: {
        url: sanitizedUrl(current),
        status: response.status,
        headers,
        normalized_media_type: normalizedMediaType,
        body_bytes: body.length,
        body_sha256: body.length > 0 ? sha256(body) : null,
        image_jpeg: normalizedMediaType === "image/jpeg" && jpegParse.outcome === "parsed",
        jpeg_parse: jpegParse
      }
    };
  }
  throw new LiveBlock("capture_budget_exceeded", "redirect_budget");
}

function responseSignature(observation) {
  const final = observation.final;
  return [final.status, final.normalized_media_type, final.body_sha256, final.jpeg_parse.width, final.jpeg_parse.height].join("|");
}

function summarizeRules(cases, observations) {
  const summaries = {};
  for (const family of ["site", "theme"]) {
    const primaryGets = observations.filter((observation) => observation.route_family === family && observation.method === "GET" && observation.attempted && !["repeat", "conditional"].includes(observation.probe_kind));
    const positives = primaryGets.filter(({role, final}) => role === "positive" && final.image_jpeg);
    const positiveSignatures = new Set(positives.map(responseSignature));
    const controls = primaryGets.filter(({role}) => role !== "positive");
    const boundaries = controls.filter((observation) => !positiveSignatures.has(responseSignature(observation)));
    const expectedPositiveCases = cases.cases.filter((entry) => entry.route_family === family && entry.role === "positive").length;
    const status = positives.length === expectedPositiveCases && positives.length >= 2 && boundaries.length >= 2 ? "established" : "unestablished";
    summaries[family] = {
      status,
      rule: status === "established" ? "Authority-backed identities at documented sizes returned bounded JPEG observations distinguishable by full response signature from at least two varied controls." : "The required documented-positive and independently varied control boundary was not established.",
      positive_observation_count: positives.length,
      expected_positive_observation_count: expectedPositiveCases,
      negative_boundary_observation_count: boundaries.length,
      negative_control_observation_count: controls.length,
      positive_probe_ids: positives.map(({probe_id}) => probe_id),
      boundary_probe_ids: boundaries.map(({probe_id}) => probe_id)
    };
  }
  return summaries;
}

function cacheSummary(observations, baselineId, repeatId, conditionalId) {
  const baseline = observations.find(({probe_id}) => probe_id === baselineId);
  const repeat = observations.find(({probe_id}) => probe_id === repeatId);
  const conditional = observations.find(({probe_id}) => probe_id === conditionalId);
  return {
    baseline_probe_id: baselineId,
    repeat_probe_id: repeatId,
    conditional_probe_id: conditionalId,
    repeated_body_hash_equal: Boolean(baseline?.final.body_sha256 && repeat?.final.body_sha256 && baseline.final.body_sha256 === repeat.final.body_sha256),
    baseline_etag_present: baseline?.final.headers.etag.present ?? false,
    baseline_last_modified_present: baseline?.final.headers.last_modified.present ?? false,
    conditional_attempted: conditional?.attempted ?? false,
    conditional_status: conditional?.final?.status ?? null
  };
}

async function publishArtifact(output, artifact) {
  await fs.stat(output).then(() => { throw new Error(`Refusing to overwrite existing output: ${output}`); }, (error) => { if (error.code !== "ENOENT") throw error; });
  await fs.mkdir(path.dirname(output), {recursive: true});
  const temporary = `${output}.tmp-${process.pid}`;
  const text = `${JSON.stringify(artifact, null, 2)}\n`;
  await fs.writeFile(temporary, text, {flag: "wx"});
  await fs.rename(temporary, output);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const casesBytes = await fs.readFile(args.cases);
  const cases = JSON.parse(casesBytes);
  const declaredProbes = validateCases(cases, args.integrationCommit);
  const capturedSource = sourceIdentity();
  await fs.stat(args.output).then(() => { throw new Error(`Refusing to overwrite existing output: ${args.output}`); }, (error) => { if (error.code !== "ENOENT") throw error; });

  const state = {transactionCount: 0, aggregateBodyBytes: 0};
  const observations = [];
  const prior = new Map();
  let liveBlock = null;
  let blockedProbeId = null;
  for (const {entry, probe} of declaredProbes) {
    try {
      const observation = await captureProbe(cases, entry, probe, state, prior);
      observations.push(observation);
      prior.set(probe.probe_id, observation);
    } catch (error) {
      liveBlock = networkBlock(error);
      blockedProbeId = probe.probe_id;
      liveBlock.details = {
        ...liveBlock.details,
        attempted_routes: [{
          case_id: entry.case_id,
          route_family: entry.route_family,
          method: probe.method,
          public_url: requestUrl(entry),
          timestamp: new Date().toISOString(),
          status: liveBlock.details.status ?? null,
          stable_error_code: liveBlock.details.stable_error_code ?? null
        }]
      };
      break;
    }
  }

  let rules = summarizeRules(cases, observations);
  if (!liveBlock && Object.values(rules).some(({status}) => status !== "established")) liveBlock = new LiveBlock("insufficient_rule_boundary", "rule_evaluation");
  if (liveBlock) {
    rules = Object.fromEntries(Object.entries(rules).map(([family, summary]) => [family, {...summary, status: "unestablished"}]));
  }
  const accountedIds = new Set(observations.map(({probe_id}) => probe_id));
  const unattempted = declaredProbes.filter(({probe}) => !accountedIds.has(probe.probe_id)).map(({entry, probe}) => ({
    probe_id: probe.probe_id,
    case_id: entry.case_id,
    route_family: entry.route_family,
    method: probe.method,
    reason: probe.probe_id === blockedProbeId ? `capture_stopped_at_${liveBlock.reason}` : `capture_stopped_after_${liveBlock?.reason ?? "unknown"}`
  }));
  const captureCommand = `node ${scriptRelativePath} --cases install/local/wikidot-verification/fixtures/thumbnails-live/cases.json --output install/local/wikidot-verification/artifacts/thumbnails-live-20260810.json --integration-commit ${args.integrationCommit}`;
  const artifact = {
    schema: "wikijump.thumbnails_live_evidence.v1",
    surface_id: expectedSurface,
    integration_commit: args.integrationCommit,
    captured_at: new Date().toISOString(),
    capture_script: {path: scriptRelativePath, sha256: sha256(await fs.readFile(fileURLToPath(import.meta.url)))},
    capture_source: capturedSource,
    case_manifest: {path: path.relative(repositoryRoot, args.cases), sha256: sha256(casesBytes)},
    authority: cases.authority,
    inventory_identity: {total: 893, role: "frozen provenance only"},
    capture_command: captureCommand,
    node_version: process.version,
    documented: cases.documented,
    network_budgets: cases.budgets,
    safety: {
      thumbnail_requests_anonymous: true,
      authorization_sent: false,
      cookies_sent: false,
      browser_used: false,
      sandbox_content_mutated: false,
      wikijump_runtime_queried: false,
      application_state_mutation: false,
      possible_cache_fill_acknowledged: true,
      possible_cache_fill_note: "Anonymous public reads may cause ordinary origin generation or CDN cache fill; no site, theme, page, file, setting, account, or permission was changed."
    },
    capture_policy: {
      methods: ["GET", "HEAD"],
      manual_redirects: true,
      request_bodies_sent: false,
      raw_response_bodies_retained: false,
      response_header_allowlist: headerNames,
      initial_host: expectedHost
    },
    identities: cases.identities,
    observations,
    unattempted_probes: unattempted,
    cache_observations: {
      site: cacheSummary(observations, "site-sfuga-160-get-baseline", "site-sfuga-160-get-repeat", "site-sfuga-160-get-conditional"),
      theme: cacheSummary(observations, "theme-curvature-240-get-baseline", "theme-curvature-240-get-repeat", "theme-curvature-240-get-conditional")
    },
    rule_summaries: rules,
    capture_counts: {
      logical_probe_count: declaredProbes.length,
      attempted_probe_count: observations.filter(({attempted}) => attempted).length,
      transaction_count: state.transactionCount,
      aggregate_body_bytes: state.aggregateBodyBytes
    },
    outcome: liveBlock ? "blocked" : "complete",
    evidence_complete: liveBlock === null,
    blocker: liveBlock ? {
      reason: liveBlock.reason,
      stage: liveBlock.stage,
      attempted_routes: liveBlock.details.attempted_routes ?? [],
      stable_error_code: liveBlock.details.stable_error_code ?? null,
      unattempted_probe_count: unattempted.length,
      compatibility_conclusion: "unestablished"
    } : null
  };
  await publishArtifact(args.output, artifact);
  process.exitCode = liveBlock ? 2 : 0;
}

main().catch((error) => {
  process.stderr.write(`capture-thumbnails-live: ${error.message}\n`);
  process.exitCode = 1;
});
