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
  for (const selectedPath of selectedClassificationPaths) {
    const classificationText = await fs.readFile(selectedPath, "utf8");
    const classification = JSON.parse(classificationText);
    if (
      classification?.schema !==
      "wikijump_listpages_compat.preview_classification.v1"
    ) {
      throw new Error("preview classification schema is unsupported");
    }
    const classificationInput = {
      path: selectedPath,
      sha256: sha256(classificationText),
      differential_path: classification.inputs?.verdict_path ?? null,
      references_path: classification.inputs?.references_path ?? null,
      current_case_count: 0,
      stale_case_count: 0,
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
