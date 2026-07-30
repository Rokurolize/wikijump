import fs from "node:fs/promises";

import { sha256 } from "./syntax-differential.mjs";

export const LISTPAGES_CORPUS_REPLAY_RECONCILIATION_SCHEMA =
  "wikijump_listpages_compat.corpus_replay_reconciliation.v1";

const NON_ACTIONABLE_DISPOSITIONS = new Set([
  "none",
  "replay-synchronized-fixture",
]);

function readJsonlText(text) {
  if (!text.trim()) return [];
  return text
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function validateSourceIdentity(row, kind) {
  if (
    typeof row.source !== "string" ||
    typeof row.source_sha256 !== "string" ||
    sha256(row.source) !== row.source_sha256
  ) {
    throw new Error(`${kind} ${row.id ?? row.case_id} source identity is invalid`);
  }
}

function replaySourceHash(invocation) {
  if (invocation.execution_context !== "literal") {
    return invocation.source_sha256;
  }
  if (
    typeof invocation.context_replay_source !== "string" ||
    typeof invocation.context_replay_source_sha256 !== "string" ||
    sha256(invocation.context_replay_source) !==
      invocation.context_replay_source_sha256
  ) {
    throw new Error(
      `literal corpus invocation ${invocation.id} replay source identity is invalid`,
    );
  }
  return invocation.context_replay_source_sha256;
}

function isDirectCapture(invocation, classified) {
  return classified.case_id === invocation.id ||
    (
      invocation.execution_context === "literal" &&
      classified.case_id === `${invocation.id}:literal-context`
    );
}

export async function reconcileListPagesCorpusReplay({
  invocationsPath,
  classificationPath = null,
  classificationPaths = null,
  authoritative = false,
}) {
  const selectedClassificationPaths = classificationPaths ??
    (classificationPath ? [classificationPath] : []);
  if (selectedClassificationPaths.length === 0) {
    throw new Error("at least one preview classification is required");
  }
  const invocationsText = await fs.readFile(invocationsPath, "utf8");
  const invocations = readJsonlText(invocationsText);

  const invocationIds = new Set();
  const invocationSourceHashes = new Set();
  for (const invocation of invocations) {
    validateSourceIdentity(invocation, "corpus invocation");
    if (invocationIds.has(invocation.id)) {
      throw new Error(`duplicate corpus invocation ID ${invocation.id}`);
    }
    invocationIds.add(invocation.id);
    invocationSourceHashes.add(replaySourceHash(invocation));
  }

  const classificationsBySource = new Map();
  const classificationCaseKeys = new Set();
  const classificationInputs = [];
  let authoritativeRuntimeIdentitySha256 = null;
  let authoritativeRuntimeProofSha256 = null;
  for (const selectedPath of selectedClassificationPaths) {
    const classificationText = await fs.readFile(selectedPath, "utf8");
    const classification = JSON.parse(classificationText);
    if (
      classification?.schema !==
      "wikijump_listpages_compat.preview_classification.v1"
    ) {
      throw new Error("preview classification schema is unsupported");
    }
    if (authoritative) {
      const authority = classification.inputs?.authority;
      if (
        authority?.mode !== "authoritative" ||
        authority.completion_eligible !== true
      ) {
        throw new Error(
          "authoritative reconciliation requires authoritative classifications",
        );
      }
      const verdictPath = classification.inputs?.verdict_path;
      const verdictSha256 = classification.inputs?.verdict_sha256;
      if (
        typeof verdictPath !== "string" ||
        !/^[0-9a-f]{64}$/u.test(verdictSha256 ?? "")
      ) {
        throw new Error("authoritative classification has no verdict binding");
      }
      const verdictText = await fs.readFile(verdictPath, "utf8");
      if (sha256(verdictText) !== verdictSha256) {
        throw new Error("preview verdict changed after classification");
      }
      const verdict = JSON.parse(verdictText);
      if (
        verdict.inputs?.authority?.mode !== "authoritative" ||
        verdict.inputs.authority.completion_eligible !== true
      ) {
        throw new Error("classification verdict is not authoritative");
      }
      if (
        verdict.inputs.runtime_identity_sha256 !==
          authority.runtime_identity_sha256 ||
        verdict.inputs.runtime_proof_sha256 !== authority.runtime_proof_sha256
      ) {
        throw new Error(
          "classification runtime identity chain differs from its verdict",
        );
      }
      const referencesText = await fs.readFile(
        classification.inputs.references_path,
        "utf8",
      );
      if (
        sha256(referencesText) !== classification.inputs.references_sha256 ||
        classification.inputs.references_sha256 !==
          verdict.inputs.references_sha256
      ) {
        throw new Error(
          "live references changed after preview classification",
        );
      }
      for (const [kind, pathField, hashField] of [
        [
          "runtime identity",
          "runtime_identity_path",
          "runtime_identity_sha256",
        ],
        ["runtime proof", "runtime_proof_path", "runtime_proof_sha256"],
      ]) {
        const currentText = await fs.readFile(
          verdict.inputs[pathField],
          "utf8",
        );
        if (sha256(currentText) !== verdict.inputs[hashField]) {
          throw new Error(`${kind} changed after preview classification`);
        }
      }
      authoritativeRuntimeIdentitySha256 ??=
        authority.runtime_identity_sha256;
      authoritativeRuntimeProofSha256 ??= authority.runtime_proof_sha256;
      if (
        authoritativeRuntimeIdentitySha256 !==
          authority.runtime_identity_sha256 ||
        authoritativeRuntimeProofSha256 !== authority.runtime_proof_sha256
      ) {
        throw new Error(
          "authoritative classification shards use different runtime identities",
        );
      }
    }
    const classificationInput = {
      path: selectedPath,
      sha256: sha256(classificationText),
      differential_path: classification.inputs?.verdict_path ?? null,
      references_path: classification.inputs?.references_path ?? null,
      current_case_count: 0,
      stale_case_count: 0,
      authority: classification.inputs?.authority ?? {
        mode: "diagnostic",
        completion_eligible: false,
      },
    };
    for (const row of classification.cases ?? []) {
      validateSourceIdentity(row, "preview classification");
      if (!invocationSourceHashes.has(row.source_sha256)) {
        classificationInput.stale_case_count += 1;
        continue;
      }
      classificationInput.current_case_count += 1;
      const caseKey = `${row.case_id}\0${row.source_sha256}`;
      if (classificationCaseKeys.has(caseKey)) {
        throw new Error(
          `duplicate preview classification case/source ${row.case_id}`,
        );
      }
      if (classificationsBySource.has(row.source_sha256)) {
        throw new Error(
          `duplicate preview classification for exact source ${row.source_sha256}`,
        );
      }
      classificationCaseKeys.add(caseKey);
      classificationsBySource.set(row.source_sha256, row);
    }
    classificationInputs.push(classificationInput);
  }

  const cases = invocations.map((invocation) => {
    const replaySourceSha256 = replaySourceHash(invocation);
    const classified = classificationsBySource.get(replaySourceSha256);
    if (!classified) {
      throw new Error(
        `missing live/local classification for corpus replay source ${replaySourceSha256} (${invocation.id})`,
      );
    }
    return {
      case_id: invocation.id,
      source_sha256: invocation.source_sha256,
      replay_source_sha256: replaySourceSha256,
      semantic_cluster_key: invocation.semantic_cluster_key,
      representative_case_id: classified.case_id,
      direct_live_capture: isDirectCapture(invocation, classified),
      verification_status: "classified",
      differential_status: classified.differential_status,
      classification: classified.classification,
      disposition: classified.disposition,
      rationale: classified.rationale,
      provenance: invocation.provenance,
    };
  });

  for (const [sourceHash, classified] of classificationsBySource) {
    if (!invocationSourceHashes.has(sourceHash)) {
      throw new Error(
        `preview classification ${classified.case_id} is not a corpus source`,
      );
    }
  }

  const differentialStatuses = {};
  const classifications = {};
  const dispositions = {};
  for (const row of cases) {
    increment(differentialStatuses, row.differential_status);
    increment(classifications, row.classification);
    increment(dispositions, row.disposition);
  }

  const actionableCases = cases.filter(
    (row) => !NON_ACTIONABLE_DISPOSITIONS.has(row.disposition),
  );
  const actionableSourceHashes = new Set(
    actionableCases.map((row) => row.replay_source_sha256),
  );

  return {
    schema: LISTPAGES_CORPUS_REPLAY_RECONCILIATION_SCHEMA,
    generated_at: new Date().toISOString(),
    inputs: {
      authority: authoritative
        ? {
            mode: "authoritative",
            completion_eligible: true,
            runtime_identity_sha256: authoritativeRuntimeIdentitySha256,
            runtime_proof_sha256: authoritativeRuntimeProofSha256,
          }
        : {
            mode: "diagnostic",
            completion_eligible: false,
          },
      invocations_path: invocationsPath,
      invocations_sha256: sha256(invocationsText),
      classifications: classificationInputs,
      classification_path:
        classificationInputs.length === 1 ? classificationInputs[0].path : null,
      classification_sha256:
        classificationInputs.length === 1 ? classificationInputs[0].sha256 : null,
      differential_path:
        classificationInputs.length === 1
          ? classificationInputs[0].differential_path
          : null,
      references_path:
        classificationInputs.length === 1
          ? classificationInputs[0].references_path
          : null,
    },
    cases,
    actionable_case_ids: actionableCases.map((row) => row.case_id),
    summary: {
      invocation_count: invocations.length,
      unique_source_count: invocationSourceHashes.size,
      exact_source_duplicate_count:
        invocations.length - invocationSourceHashes.size,
      directly_captured_invocation_count: cases.filter(
        (row) => row.direct_live_capture,
      ).length,
      classified_invocation_count: cases.length,
      unresolved_invocation_count: 0,
      actionable_unique_source_count: actionableSourceHashes.size,
      actionable_invocation_count: actionableCases.length,
      differential_statuses: differentialStatuses,
      classifications,
      dispositions,
      exit_code: actionableCases.length > 0 ? 1 : 0,
    },
  };
}

export async function writeListPagesCorpusReplayReconciliation(
  reconciliation,
  outputPath,
) {
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(reconciliation, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}
