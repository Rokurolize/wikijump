import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  CANDIDATE_CASE_SETS,
  candidateCaseSet,
  readPrivateCandidateCaseInput,
} from "./candidate-case-command.mjs";
import { withCandidateGlobalLease } from "./candidate-global-lease.mjs";
import { runCandidateCaseSet } from "./candidate-case-runner.mjs";
import {
  readJsonObject,
  sealJsonNoReplace,
  sha256File,
} from "./standing-browser-parity-util.mjs";

export const CANDIDATE_CAMPAIGN_RECEIPT_SCHEMA = "wikijump.candidate_campaign_run.v1";
const INPUT_RECEIPT_SCHEMA = "wikijump.compatibility_candidate_input_receipt.v2";
const Q1035_CASE_SET = "open43-q1035-sitechanges";
const MAX_PARALLEL_READ_ONLY = 8;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function executableRegistry(registry = CANDIDATE_CASE_SETS) {
  return Object.entries(registry)
    .filter(([, registered]) => registered.aliasOf === undefined)
    .map(([name, registered], index) => ({
      name,
      index,
      execution_class: registered.executionClass,
    }));
}

export function buildCandidateCampaignSchedule(registry = CANDIDATE_CASE_SETS) {
  const execution = executableRegistry(registry);
  const q1035 = execution.find(({ name }) => name === Q1035_CASE_SET);
  if (!q1035 || q1035.execution_class !== "read_only") {
    throw new Error("Q1035 must remain a read-only first-phase candidate case set");
  }
  const readOnly = execution.filter(
    ({ name, execution_class: executionClass }) =>
      executionClass === "read_only" && name !== Q1035_CASE_SET,
  );
  const exclusive = execution.filter(
    ({ execution_class: executionClass }) => executionClass === "exclusive",
  );
  if (execution.some(({ execution_class: executionClass }) => !new Set(["read_only", "exclusive"]).has(executionClass))) {
    throw new Error("candidate campaign registry has an unknown execution class");
  }
  return Object.freeze({ first: q1035, read_only: readOnly, exclusive });
}

function validateInputReceipt(receipt, registry = CANDIDATE_CASE_SETS) {
  requireObject(receipt, "candidate input receipt");
  if (receipt.schema !== INPUT_RECEIPT_SCHEMA || receipt.status !== "pass") {
    throw new Error("candidate input receipt is not a passing v2 receipt");
  }
  if (typeof receipt.output_private_dir !== "string" || !path.isAbsolute(receipt.output_private_dir)) {
    throw new Error("candidate input receipt output_private_dir must be absolute");
  }
  const mapping = requireObject(receipt.case_set_private_inputs, "candidate input receipt case_set_private_inputs");
  const expectedNames = executableRegistry(registry).map(({ name }) => name).sort((left, right) => left.localeCompare(right, "en"));
  const actualNames = Object.keys(mapping).sort((left, right) => left.localeCompare(right, "en"));
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error("candidate input receipt mapping does not exactly cover the execution case-set registry");
  }
  const available = new Set(receipt.private_files ?? []);
  for (const [caseSet, filename] of Object.entries(mapping)) {
    if (
      typeof filename !== "string" ||
      filename === "" ||
      path.basename(filename) !== filename ||
      !available.has(filename)
    ) {
      throw new Error(`candidate input receipt has an invalid private input for ${caseSet}`);
    }
  }
  return receipt;
}

function caseRunId(campaignRunId, caseSetName) {
  return `candidate-run-${sha256(`${campaignRunId}\0${caseSetName}`).slice(0, 12)}`;
}

async function ensureNewPrivateDirectory(directory) {
  const resolved = path.resolve(directory);
  try {
    await fs.mkdir(resolved, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`candidate campaign output already exists: ${resolved}`);
    throw error;
  }
  return resolved;
}

async function parallelMap(items, concurrency, operation, controller) {
  let cursor = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (controller.signal.aborted) return;
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await operation(items[index]);
      } catch (error) {
        if (!controller.signal.aborted) controller.abort(error);
        throw error;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function defaultDependencies() {
  return {
    candidateCaseSet,
    readPrivateCandidateCaseInput,
    runCandidateCaseSet,
    withCandidateGlobalLease,
    now: () => new Date().toISOString(),
  };
}

export async function runCandidateCampaign({
  candidateIdentityPath,
  inputReceiptPath,
  outputDir,
  parallelReadOnly = 3,
  dependencies: overrides = {},
}) {
  if (!Number.isSafeInteger(parallelReadOnly) || parallelReadOnly < 1 || parallelReadOnly > MAX_PARALLEL_READ_ONLY) {
    throw new Error(`parallel read-only concurrency must be between 1 and ${MAX_PARALLEL_READ_ONLY}`);
  }
  const dependencies = { ...defaultDependencies(), ...overrides };
  const [candidateIdentity, candidateIdentitySha256, rawInputReceipt, inputReceiptSha256] = await Promise.all([
    readJsonObject(candidateIdentityPath, "candidate identity"),
    sha256File(candidateIdentityPath),
    readJsonObject(inputReceiptPath, "candidate input receipt"),
    sha256File(inputReceiptPath),
  ]);
  const inputReceipt = validateInputReceipt(rawInputReceipt);
  if (inputReceipt.candidate?.editable_identity_sha256 !== candidateIdentitySha256) {
    throw new Error("candidate input receipt is not bound to the supplied editable candidate identity");
  }
  const output = await ensureNewPrivateDirectory(outputDir);
  const schedule = buildCandidateCampaignSchedule();
  const campaignRunId = `candidate-run-${sha256(`${candidateIdentitySha256}\0${inputReceiptSha256}\0${output}`).slice(0, 12)}`;
  const controller = new AbortController();
  const privateInputs = new Map();
  const completed = [];
  const startedAt = Date.now();

  const runOne = async ({ name, index, execution_class: executionClass }) => {
    if (controller.signal.aborted) throw controller.signal.reason ?? new Error("candidate campaign aborted");
    const filename = inputReceipt.case_set_private_inputs[name];
    let privateInput = privateInputs.get(filename);
    if (!privateInput) {
      privateInput = await dependencies.readPrivateCandidateCaseInput(
        path.join(inputReceipt.output_private_dir, filename),
      );
      privateInputs.set(filename, privateInput);
    }
    const selectedCaseSet = await dependencies.candidateCaseSet(name);
    const caseOutput = path.join(output, `${String(index + 1).padStart(2, "0")}-${name}`);
    const runId = caseRunId(campaignRunId, name);
    const caseStarted = Date.now();
    const result = await dependencies.runCandidateCaseSet({
      candidateIdentity,
      candidateIdentitySha256,
      privateInput: privateInput.value,
      privateInputSha256: privateInput.sha256,
      outputDir: caseOutput,
      caseSet: selectedCaseSet,
      runId,
      signal: controller.signal,
    });
    const summary = Object.freeze({
      name,
      execution_class: executionClass,
      run_id: runId,
      output_dir: caseOutput,
      elapsed_ms: Date.now() - caseStarted,
      status: result.status ?? "pass",
    });
    completed.push(summary);
    return summary;
  };

  let failure = null;
  try {
    await dependencies.withCandidateGlobalLease(
      { runId: campaignRunId, evidenceDirectory: output },
      async () => {
        await runOne(schedule.first);
        await parallelMap(schedule.read_only, parallelReadOnly, runOne, controller);
        for (const item of schedule.exclusive) await runOne(item);
      },
    );
  } catch (error) {
    failure = error;
    if (!controller.signal.aborted) controller.abort(error);
  }

  const receipt = {
    schema: CANDIDATE_CAMPAIGN_RECEIPT_SCHEMA,
    status: failure === null ? "pass" : "fail",
    generated_at: dependencies.now(),
    campaign_run_id: campaignRunId,
    candidate_identity_sha256: candidateIdentitySha256,
    input_receipt_sha256: inputReceiptSha256,
    parallel_read_only: parallelReadOnly,
    schedule: {
      first: schedule.first.name,
      read_only: schedule.read_only.map(({ name }) => name),
      exclusive: schedule.exclusive.map(({ name }) => name),
    },
    completed: [...completed].sort((left, right) => left.name.localeCompare(right.name, "en")),
    elapsed_ms: Date.now() - startedAt,
    ...(failure === null ? {} : { error: failure?.message ?? String(failure) }),
  };
  const publication = await sealJsonNoReplace(path.join(output, "campaign-run.json"), receipt);
  if (publication.publication !== "created") throw new Error("candidate campaign receipt already exists");
  if (failure !== null) throw new Error(`candidate campaign failed: ${failure?.message ?? String(failure)}`);
  return { ...receipt, receipt_sha256: publication.sha256 };
}
