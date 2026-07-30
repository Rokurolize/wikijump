import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./syntax-differential.mjs";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SOURCE_DIRECTORY, "../../../..");

export const LISTPAGES_CORPUS_REPLAY_SCOPE_PATH = path.join(
  REPOSITORY_ROOT,
  "install/local/wikidot-verification/artifacts/listpages-corpus-replay-scope.json",
);
export const LISTPAGES_CORPUS_REPLAY_SCOPE_SCHEMA =
  "wikijump_listpages_compat.corpus_replay_scope.v1";

function requireSha256(value, name) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256`);
  }
  return value;
}

function replayKey(invocation) {
  return invocation.execution_context === "literal"
    ? invocation.context_replay_source_sha256
    : invocation.source_sha256;
}

export async function validateListPagesCorpusReplayScope({
  scopePath,
  invocationsText,
  invocations,
}) {
  if (path.resolve(scopePath) !== LISTPAGES_CORPUS_REPLAY_SCOPE_PATH) {
    throw new Error(
      "authoritative replay requires the repository-pinned campaign scope",
    );
  }
  const scopeText = await fs.readFile(scopePath, "utf8");
  const scope = JSON.parse(scopeText);
  if (
    scope?.schema !== LISTPAGES_CORPUS_REPLAY_SCOPE_SCHEMA ||
    scope.campaign_issue !== 968 ||
    scope.invocations?.path !==
      "install/local/wikidot-verification/artifacts/listpages-campaign-matrix/corpus-invocation-cases.jsonl" ||
    scope.replay_key_contract?.executable !== "source_sha256" ||
    scope.replay_key_contract?.literal !== "context_replay_source_sha256" ||
    scope.live_reference_contract?.required_replay_key_coverage !==
      "exactly-once" ||
    scope.completion_contract?.authoritative_only !== true
  ) {
    throw new Error("ListPages campaign scope contract is invalid");
  }
  const expected = scope.invocations;
  const invocationIds = new Set(invocations.map(({ id }) => id));
  const replayKeys = new Set(invocations.map(replayKey));
  if (
    sha256(invocationsText) !==
      requireSha256(expected.sha256, "campaign invocation hash") ||
    invocations.length !== expected.invocation_count ||
    invocationIds.size !== expected.unique_invocation_id_count ||
    replayKeys.size !== expected.unique_replay_key_count ||
    invocations[0]?.id !== expected.first_invocation_id ||
    invocations.at(-1)?.id !== expected.last_invocation_id ||
    scope.completion_contract.classified_invocation_count !==
      expected.invocation_count
  ) {
    throw new Error(
      "authoritative invocation input differs from the pinned campaign scope",
    );
  }
  for (const artifact of scope.source_artifacts ?? []) {
    if (
      typeof artifact.path !== "string" ||
      path.isAbsolute(artifact.path) ||
      artifact.path.includes("..")
    ) {
      throw new Error("campaign source artifact path is invalid");
    }
    const contents = await fs.readFile(
      path.join(REPOSITORY_ROOT, artifact.path),
      "utf8",
    );
    if (sha256(contents) !== requireSha256(
      artifact.sha256,
      `campaign source artifact ${artifact.path}`,
    )) {
      throw new Error(`campaign source artifact changed: ${artifact.path}`);
    }
  }
  return {
    path: scopePath,
    sha256: sha256(scopeText),
    invocation_sha256: expected.sha256,
    invocation_count: expected.invocation_count,
    unique_replay_key_count: expected.unique_replay_key_count,
    live_reference_contract: scope.live_reference_contract,
    completion_contract: scope.completion_contract,
  };
}
