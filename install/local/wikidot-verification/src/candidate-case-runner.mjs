import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { collectCandidateSourceExecutionIdentity } from "./candidate-source-execution-identity.mjs";
import { assertCandidateIdentityFresh, validateCandidateParityIdentity } from "./standing-browser-parity-receipt.mjs";
import { assertStableCandidateRuntimeIdentity, observeCandidateRuntimeIdentity } from "./standing-browser-runtime-identity.mjs";
import {
  createPrivateEmptyDirectory,
  requirePlainObject,
  requireSha256,
  sealJsonNoReplace,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const CANDIDATE_CASE_RECEIPT_SCHEMA = "wikijump.candidate_case_receipt.v1";
export const CANDIDATE_CASE_AGGREGATE_SCHEMA = "wikijump.candidate_case_aggregate.v1";

const CASE_ID = /^[A-Z][A-Z0-9_]+$/u;
const RUN_ID = /^candidate-case-[0-9a-f]{12}$/u;

function validateCaseSet(value) {
  const caseSet = requirePlainObject(value, "CandidateCaseSet");
  if (!/^[a-z][a-z0-9-]+$/u.test(caseSet.id ?? "") || typeof caseSet.prepareRun !== "function") throw new Error("CandidateCaseSet must have an id and prepareRun");
  if (!Array.isArray(caseSet.caseIds) || caseSet.caseIds.length === 0 || caseSet.caseIds.some((id) => !CASE_ID.test(id)) || new Set(caseSet.caseIds).size !== caseSet.caseIds.length) throw new Error("CandidateCaseSet caseIds must be non-empty and unique");
  return caseSet;
}

function validatePreparedRun(value) {
  const run = requirePlainObject(value, "prepared CandidateCaseSet run");
  if (!Array.isArray(run.sourceFiles) || run.sourceFiles.some((file) => typeof file !== "string" || path.isAbsolute(file)) || new Set(run.sourceFiles).size !== run.sourceFiles.length) throw new Error("prepared run sourceFiles must be unique repository-relative paths");
  if (!Array.isArray(run.runtimeBindings)) throw new Error("prepared run runtimeBindings must be an array");
  requirePlainObject(run.privateInputIdentity, "prepared run privateInputIdentity");
  requirePlainObject(run.plan, "prepared run plan");
  for (const method of ["execute", "cleanup", "verifyCase", "verifyCleanup"]) if (typeof run[method] !== "function") throw new Error(`prepared run ${method} must be a function`);
  return run;
}

async function seal(destination, value) {
  const result = await sealJsonNoReplace(destination, value);
  if (result.publication !== "created") throw new Error(`candidate case artifact already exists: ${destination}`);
  return { path: path.resolve(destination), sha256: result.sha256 };
}

class RunResources {
  #entries = [];

  register(kind, identity) {
    if (!/^[a-z][a-z0-9-]*$/u.test(kind)) throw new Error("run resource kind is invalid");
    requirePlainObject(identity, "run resource identity");
    const entry = { sequence: this.#entries.length + 1, kind, identity: structuredClone(identity), released: false, release_proof: null };
    this.#entries.push(entry);
    return Object.freeze({ sequence: entry.sequence, kind });
  }

  release(token, proof) {
    const entry = this.#entries[token?.sequence - 1];
    if (!entry || entry.kind !== token.kind || entry.released) throw new Error("run resource release token is unknown or already released");
    requirePlainObject(proof, "run resource cleanup proof");
    entry.released = true;
    entry.release_proof = structuredClone(proof);
  }

  snapshot() { return structuredClone(this.#entries); }
}

function reconcile(caseIds, rows) {
  if (!Array.isArray(rows)) throw new Error("CandidateCaseSet execute result must be an array");
  const result = new Map();
  for (const row of rows) {
    requirePlainObject(row, "candidate case observation record");
    if (Object.hasOwn(row, "status") || Object.hasOwn(row, "verdict")) throw new Error("producer-authored status or verdict is forbidden");
    if (!caseIds.includes(row.case_id)) throw new Error(`candidate case observation is outside the denominator: ${row.case_id}`);
    if (result.has(row.case_id)) throw new Error(`candidate case observation is duplicated: ${row.case_id}`);
    result.set(row.case_id, requirePlainObject(row.observations, `${row.case_id} observations`));
  }
  for (const caseId of caseIds) if (!result.has(caseId)) throw new Error(`candidate case observation is missing: ${caseId}`);
  return result;
}

function verifiedCase(value, caseId) {
  const verification = requirePlainObject(value, `${caseId} verification`);
  if (verification.verified !== true) throw new Error(`${caseId} verification must explicitly set verified true`);
  return verification;
}

function defaultDependencies() {
  return {
    collectExecutionIdentity: collectCandidateSourceExecutionIdentity,
    observeRuntimeIdentity: observeCandidateRuntimeIdentity,
    assertStableRuntimeIdentity: assertStableCandidateRuntimeIdentity,
    runId: () => `candidate-case-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    now: () => new Date().toISOString(),
  };
}

export async function runCandidateCaseSet({ candidateIdentity: rawIdentity, candidateIdentitySha256, privateInput, privateInputSha256, outputDir, caseSet: rawCaseSet, signal = null, dependencies: overrides = {} }) {
  const identity = assertCandidateIdentityFresh(validateCandidateParityIdentity(rawIdentity));
  requireSha256(candidateIdentitySha256, "candidate identity SHA-256");
  requireSha256(privateInputSha256, "private input SHA-256");
  const caseSet = validateCaseSet(rawCaseSet);
  const dependencies = { ...defaultDependencies(), ...overrides };
  const runId = dependencies.runId();
  if (!RUN_ID.test(runId)) throw new Error("candidate case run ID is invalid");

  const output = path.resolve(outputDir);
  await createPrivateEmptyDirectory(output);
  const caseDirectory = path.join(output, "cases");
  await fs.mkdir(caseDirectory, { mode: 0o700 });
  const resources = new RunResources();
  const run = validatePreparedRun(await caseSet.prepareRun({ runId, candidateIdentity: identity, candidateIdentitySha256, privateInput, privateInputSha256, signal, resources }));
  if (resources.snapshot().length !== 0) throw new Error("CandidateCaseSet prepareRun must be side-effect-free");
  const executionIdentity = await dependencies.collectExecutionIdentity(identity, run.sourceFiles);
  const denominator = { count: caseSet.caseIds.length, case_ids: [...caseSet.caseIds], sha256: sha256Value(caseSet.caseIds) };
  const plan = {
    schema: "wikijump.candidate_case_run_plan.v1",
    run_id: runId,
    candidate_case_set: caseSet.id,
    denominator,
    candidate_identity_sha256: candidateIdentitySha256,
    private_input_sha256: privateInputSha256,
    private_input_identity: run.privateInputIdentity,
    execution_identity_sha256: sha256Value(executionIdentity),
    case_set_plan: run.plan,
  };
  const planSeal = await seal(path.join(output, "run-plan.json"), plan);
  const runtimeOptions = { identity, identitySha256: candidateIdentitySha256, requiredServiceBindings: run.runtimeBindings };
  const runtimeBefore = await dependencies.observeRuntimeIdentity(runtimeOptions);

  let rawCases = null;
  let cleanupProof = null;
  let operationError = null;
  let cleanupError = null;
  try {
    if (signal?.aborted) throw signal.reason ?? new Error("candidate case run was aborted");
    rawCases = await run.execute();
  } catch (error) {
    operationError = error;
  } finally {
    try { cleanupProof = await run.cleanup(); } catch (error) { cleanupError = error; }
  }

  const resourceSnapshot = resources.snapshot();
  if (cleanupProof !== null) await seal(path.join(output, "cleanup.json"), { schema: "wikijump.candidate_case_cleanup.v1", run_id: runId, proof: cleanupProof, resources: resourceSnapshot });
  let verifiedCleanup = null;
  let cleanupVerificationError = null;
  try {
    if (resourceSnapshot.some((resource) => !resource.released)) throw new Error("run resource record contains unreleased resources");
    verifiedCleanup = run.verifyCleanup(cleanupProof, resourceSnapshot);
    if (verifiedCleanup?.public_absence_verified !== true) throw new Error("CandidateCaseSet cleanup did not prove public absence");
  } catch (error) {
    cleanupVerificationError = error;
  }

  let runtimeAfter = null;
  let runtimeError = null;
  try {
    runtimeAfter = await dependencies.observeRuntimeIdentity(runtimeOptions);
    dependencies.assertStableRuntimeIdentity(runtimeBefore, runtimeAfter, identity, { identitySha256: candidateIdentitySha256, requiredServiceBindings: run.runtimeBindings });
  } catch (error) { runtimeError = error; }
  const failures = [operationError, cleanupError, cleanupVerificationError, runtimeError].filter(Boolean);
  if (failures.length) throw new AggregateError(failures, cleanupError || cleanupVerificationError ? "candidate case execution or cleanup failed" : "candidate case execution failed");

  const observations = reconcile(caseSet.caseIds, rawCases);
  const verifiedCases = caseSet.caseIds.map((caseId) => ({
    caseId,
    observations: observations.get(caseId),
    verification: verifiedCase(run.verifyCase(caseId, observations.get(caseId)), caseId),
  }));
  const cases = [];
  for (const { caseId, observations: caseObservations, verification } of verifiedCases) {
    const receipt = {
      schema: CANDIDATE_CASE_RECEIPT_SCHEMA,
      status: "pass",
      generated_at: dependencies.now(),
      run_id: runId,
      candidate_case_set: caseSet.id,
      case_id: caseId,
      candidate_identity_sha256: candidateIdentitySha256,
      private_input_sha256: privateInputSha256,
      run_plan_sha256: planSeal.sha256,
      execution_identity_sha256: sha256Value(executionIdentity),
      runtime_before_sha256: sha256Value(runtimeBefore),
      runtime_after_sha256: sha256Value(runtimeAfter),
      cleanup: verifiedCleanup,
      observations: caseObservations,
      verification,
    };
    cases.push({ case_id: caseId, ...(await seal(path.join(caseDirectory, `${caseId}.json`), receipt)) });
  }
  const aggregate = {
    schema: CANDIDATE_CASE_AGGREGATE_SCHEMA,
    status: "pass",
    generated_at: dependencies.now(),
    run_id: runId,
    candidate_case_set: caseSet.id,
    candidate_identity_sha256: candidateIdentitySha256,
    private_input_sha256: privateInputSha256,
    denominator,
    run_plan: planSeal,
    execution_identity: executionIdentity,
    runtime_identity: { before: runtimeBefore, after: runtimeAfter, stable: true },
    cleanup: verifiedCleanup,
    resources: resourceSnapshot,
    cases,
  };
  await seal(path.join(output, "candidate-case-receipt.json"), aggregate);
  return aggregate;
}
