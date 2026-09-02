#!/usr/bin/env node

import path from "node:path";

import {
  buildCandidateCaseSetManifest,
  verifyCandidateCaseSetManifest,
} from "./build-candidate-case-set-manifest.mjs";
import {runCliIfMain} from "../src/cli-entry.mjs";
import {
  CANDIDATE_CASE_AGGREGATE_SCHEMA,
  CANDIDATE_CASE_RECEIPT_SCHEMA,
} from "../src/candidate-case-runner.mjs";
import {
  assertCandidateIdentityFresh,
  validateCandidateParityIdentity,
} from "../src/standing-browser-parity-receipt.mjs";
import {
  readStableRegularFile,
  requireSha256,
  sealJsonNoReplace,
  sha256Value,
} from "../src/standing-browser-parity-util.mjs";

export const CANDIDATE_CAMPAIGN_AGGREGATE_SCHEMA =
  "wikijump.candidate_campaign_aggregate.v1";

const RUN_ID = /^candidate-run-[0-9a-f]{12}$/u;

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, expected, name) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())
  ) {
    fail(`${name} has missing or unknown fields`);
  }
}

async function readJson(filePath, name) {
  const file = await readStableRegularFile(path.resolve(filePath), name);
  try {
    return {
      value: JSON.parse(file.bytes.toString("utf8")),
      reference: {path: path.resolve(filePath), sha256: file.sha256},
    };
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
}

function sameStrings(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  );
}

async function verifyCaseArtifact(reference, expected) {
  exactKeys(reference, ["case_id", "path", "sha256"], "candidate case artifact reference");
  requireSha256(reference.sha256, "candidate case artifact SHA-256");
  const artifactPath = path.resolve(reference.path);
  const file = await readStableRegularFile(
    artifactPath,
    `candidate case artifact ${reference.case_id}`,
  );
  if (file.sha256 !== reference.sha256) {
    fail(`candidate case artifact identity moved: ${reference.case_id}`);
  }
  let value;
  try {
    value = JSON.parse(file.bytes.toString("utf8"));
  } catch (error) {
    fail(`candidate case artifact ${reference.case_id} is not valid JSON: ${error.message}`);
  }
  if (
    value?.schema !== CANDIDATE_CASE_RECEIPT_SCHEMA ||
    value.status !== "pass" ||
    value.run_id !== expected.runId ||
    value.candidate_case_set !== expected.caseSet ||
    value.case_id !== reference.case_id ||
    value.candidate_identity_sha256 !== expected.candidateIdentitySha256
  ) {
    fail(`candidate case artifact is not bound to the campaign identity: ${reference.case_id}`);
  }
  return {path: artifactPath, sha256: file.sha256};
}

async function verifyCleanupReceipt(receiptPath, receipt) {
  if (typeof receipt.cleanup_receipt !== "string" || receipt.cleanup_receipt === "") {
    fail(`candidate case set ${receipt.candidate_case_set} has no cleanup receipt`);
  }
  const cleanupPath = path.resolve(path.dirname(receiptPath), receipt.cleanup_receipt);
  if (path.dirname(cleanupPath) !== path.dirname(receiptPath)) {
    fail(`candidate case set ${receipt.candidate_case_set} cleanup receipt escapes its evidence directory`);
  }
  const cleanup = await readJson(cleanupPath, `candidate cleanup ${receipt.candidate_case_set}`);
  const value = cleanup.value;
  if (
    value?.schema !== "wikijump.candidate_case_cleanup.v1" ||
    value.status !== "pass" ||
    value.run_id !== receipt.run_id ||
    value.public_absence_verified !== true ||
    value.resources_released !== true ||
    value.vacant !== true ||
    value.browser_closed !== true
  ) {
    fail(`candidate case set ${receipt.candidate_case_set} cleanup is incomplete`);
  }
  return cleanup.reference;
}

async function verifyCaseSetReceipt({
  receiptPath,
  expected,
  candidateIdentitySha256Set,
}) {
  const input = await readJson(receiptPath, `candidate aggregate ${expected.name}`);
  const receipt = input.value;
  if (
    receipt?.schema !== CANDIDATE_CASE_AGGREGATE_SCHEMA ||
    receipt.status !== "pass" ||
    receipt.candidate_case_set !== expected.name ||
    !RUN_ID.test(receipt.run_id ?? "") ||
    !candidateIdentitySha256Set.has(receipt.candidate_identity_sha256)
  ) {
    fail(`candidate aggregate ${expected.name} is not bound to the campaign identity`);
  }
  const candidateIdentitySha256 = receipt.candidate_identity_sha256;
  if (
    receipt.denominator?.count !== expected.case_ids.length ||
    !sameStrings(receipt.denominator?.case_ids, expected.case_ids) ||
    receipt.denominator?.sha256 !== sha256Value(expected.case_ids)
  ) {
    fail(`candidate aggregate ${expected.name} denominator drifted`);
  }
  if (receipt.runtime_identity?.stable !== true) {
    fail(`candidate aggregate ${expected.name} runtime identity is not stable`);
  }
  if (receipt.cleanup?.public_absence_verified !== true) {
    fail(`candidate aggregate ${expected.name} does not prove public cleanup`);
  }
  if (
    !Array.isArray(receipt.resources) ||
    receipt.resources.some((resource) => resource?.released !== true)
  ) {
    fail(`candidate aggregate ${expected.name} has unreleased resources`);
  }
  if (!Array.isArray(receipt.cases) || receipt.cases.length !== expected.case_ids.length) {
    fail(`candidate aggregate ${expected.name} case artifact count drifted`);
  }
  const caseIds = receipt.cases.map(({case_id: caseId}) => caseId);
  if (!sameStrings(caseIds, expected.case_ids) || new Set(caseIds).size !== caseIds.length) {
    fail(`candidate aggregate ${expected.name} case artifacts do not exactly cover its denominator`);
  }
  const cases = [];
  for (const reference of receipt.cases) {
    const verified = await verifyCaseArtifact(reference, {
      runId: receipt.run_id,
      caseSet: expected.name,
      candidateIdentitySha256,
    });
    cases.push({case_id: reference.case_id, ...verified});
  }
  const cleanup = await verifyCleanupReceipt(receiptPath, receipt);
  return {
    name: expected.name,
    case_ids: [...expected.case_ids],
    receipt: input.reference,
    cleanup,
    cases: cases.sort((left, right) => left.case_id.localeCompare(right.case_id, "en")),
  };
}

export async function aggregateCandidateCaseCampaign({
  candidateIdentityPath,
  candidateIdentityPaths = null,
  manifestPath,
  receiptPaths,
  now = new Date(),
}) {
  const identityPathList = candidateIdentityPaths ?? [candidateIdentityPath];
  if (!Array.isArray(identityPathList) || identityPathList.length === 0) {
    fail("candidate campaign requires at least one candidate identity projection");
  }
  const [identityInputs, manifestInput] = await Promise.all([
    Promise.all(identityPathList.map((identityPath, index) =>
      readJson(identityPath, `candidate parity identity projection ${index}`))),
    readJson(manifestPath, "candidate case set manifest"),
  ]);
  const identities = identityInputs.map(({value}) =>
    assertCandidateIdentityFresh(validateCandidateParityIdentity(value), {now}));
  const runtimeIdentity = (identity) => ({
    artifact_key: identity.artifact_key,
    build: identity.build,
    candidate: {
      owner: identity.candidate.owner,
      expires_at: identity.candidate.expires_at,
      compose_project: identity.candidate.compose_project,
      port_443_published: identity.candidate.port_443_published,
      wikijump_commit: identity.candidate.wikijump_commit,
      wikijump_tree: identity.candidate.wikijump_tree,
      ftml_sha: identity.candidate.ftml_sha,
      profile: identity.candidate.profile,
      source_clean: identity.candidate.source_clean,
      images: identity.candidate.images,
      config: identity.candidate.config,
      endpoint_transport: {
        scheme: identity.candidate.endpoint.scheme,
        port: identity.candidate.endpoint.port,
        resolved_addresses: identity.candidate.endpoint.resolved_addresses,
        local_connect_address: identity.candidate.endpoint.local_connect_address,
      },
    },
    evidence: identity.evidence,
  });
  const sealedRuntime = sha256Value(runtimeIdentity(identities[0]));
  for (const identity of identities.slice(1)) {
    if (sha256Value(runtimeIdentity(identity)) !== sealedRuntime) {
      fail("candidate campaign identity projections do not bind the same runtime");
    }
  }
  const identity = identities[0];
  const identityInput = identityInputs[0];
  const candidateIdentitySha256Set = new Set(identityInputs.map(({reference}) => reference.sha256));
  if (candidateIdentitySha256Set.size !== identityInputs.length) {
    fail("candidate campaign has duplicate candidate identity projections");
  }
  verifyCandidateCaseSetManifest(manifestInput.value);
  const expectedManifest = buildCandidateCaseSetManifest();
  if (JSON.stringify(manifestInput.value) !== JSON.stringify(expectedManifest)) {
    fail("candidate case set manifest is not the current source-owned manifest");
  }
  const expected = new Map(manifestInput.value.case_sets.map((row) => [row.name, row]));
  if (!Array.isArray(receiptPaths) || receiptPaths.length !== expected.size) {
    fail(`candidate campaign requires exactly ${expected.size} execution case-set receipts`);
  }

  const seen = new Map();
  const runIds = new Set();
  for (const receiptPath of receiptPaths) {
    const input = await readJson(receiptPath, "candidate campaign case-set receipt");
    const name = input.value?.candidate_case_set;
    if (!expected.has(name) || seen.has(name)) {
      fail(`candidate campaign has an unknown or duplicate case-set receipt: ${name}`);
    }
    if (!RUN_ID.test(input.value?.run_id ?? "")) fail("candidate campaign run ID is invalid");
    runIds.add(input.value.run_id);
    seen.set(name, path.resolve(receiptPath));
  }
  for (const name of expected.keys()) {
    if (!seen.has(name)) fail(`candidate campaign is missing case-set receipt: ${name}`);
  }

  const caseSets = [];
  for (const row of manifestInput.value.case_sets) {
    caseSets.push(
      await verifyCaseSetReceipt({
        receiptPath: seen.get(row.name),
        expected: row,
        candidateIdentitySha256Set,
      }),
    );
  }
  const allCases = caseSets.flatMap(({name, cases}) =>
    cases.map((entry) => ({case_set: name, ...entry})),
  );
  if (new Set(allCases.map(({case_id: caseId}) => caseId)).size !== allCases.length) {
    fail("candidate campaign case IDs are not globally single-owner");
  }
  return {
    schema: CANDIDATE_CAMPAIGN_AGGREGATE_SCHEMA,
    status: "pass",
    run_id: `candidate-run-${sha256Value([...receiptPaths].sort()).slice(0, 12)}`,
    case_set_run_ids: [...runIds].sort(),
    candidate_identity: identityInput.reference,
    candidate_identity_projections: identityInputs.map(({reference}) => reference),
    candidate: {
      artifact_key: identity.artifact_key,
      wikijump_commit: identity.candidate.wikijump_commit,
      wikijump_tree: identity.candidate.wikijump_tree,
      ftml_sha: identity.candidate.ftml_sha,
    },
    case_set_manifest: manifestInput.reference,
    execution_case_set_count: caseSets.length,
    case_count: allCases.length,
    case_sets: caseSets,
    cases: allCases.sort((left, right) => left.case_id.localeCompare(right.case_id, "en")),
  };
}

function parseArgs(argv) {
  const args = {candidateIdentities: [], receipts: []};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    if (flag === "--candidate-identity") args.candidateIdentities.push(path.resolve(value));
    else if (flag === "--manifest") args.manifest = path.resolve(value);
    else if (flag === "--receipt") args.receipts.push(path.resolve(value));
    else if (flag === "--output") args.output = path.resolve(value);
    else fail(`unknown option: ${flag}`);
  }
  for (const name of ["manifest", "output"]) {
    if (!args[name]) fail(`--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  if (args.candidateIdentities.length === 0) fail("at least one --candidate-identity is required");
  if (args.receipts.length === 0) fail("at least one --receipt is required");
  return args;
}

function usage() {
  return "Usage: aggregate-candidate-case-campaign.mjs --candidate-identity FILE [--candidate-identity FILE ...] --manifest FILE --receipt FILE [--receipt FILE ...] --output FILE";
}

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout(usage());
    return 0;
  }
  const aggregate = await aggregateCandidateCaseCampaign({
    candidateIdentityPaths: args.candidateIdentities,
    manifestPath: args.manifest,
    receiptPaths: args.receipts,
  });
  const publication = await sealJsonNoReplace(args.output, aggregate);
  if (publication.publication !== "created") fail(`candidate campaign aggregate already exists: ${args.output}`);
  stdout(JSON.stringify({
    schema: aggregate.schema,
    status: aggregate.status,
    run_id: aggregate.run_id,
    case_sets: aggregate.execution_case_set_count,
    cases: aggregate.case_count,
    output: publication.path,
    sha256: publication.sha256,
  }));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    return 1;
  },
});
