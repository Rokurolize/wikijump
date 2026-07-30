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
export const LISTPAGES_CORPUS_REPLAY_SCOPE_SHA256 =
  "c5e988bc067efa566b13816dd1c3dbe88ff3b887ef2f1d7792fd3b9fb71fe555";

const EXPECTED_INVOCATIONS = Object.freeze({
  path:
    "install/local/wikidot-verification/artifacts/listpages-campaign-matrix/corpus-invocation-cases.jsonl",
  sha256: "f7b66809eefcc619add10cf03c38b1c5bbb3436c578d23ed763ef41e0447ea67",
  invocation_count: 23964,
  unique_invocation_id_count: 23964,
  unique_replay_key_count: 18996,
  first_invocation_id: "05command:archived:images-team-main:L25:B685",
  last_invocation_id: "zh-tr:zh999-contest:L112:B3710",
});
const EXPECTED_SOURCE_ARTIFACTS = Object.freeze([
  [
    "install/local/wikidot-verification/artifacts/listpages-campaign-inventory/campaign-inventory.json",
    "a1eedf51ba705443183c596dd546987eff8313f29d71bd981ee73b3fdfb1f277",
  ],
  [
    "install/local/wikidot-verification/artifacts/listpages-campaign-matrix/matrix-summary.json",
    "505b0e1ae39a95a89ba081d24f96ae2e49c0ddb0bfd6b605f53199f97beb2565",
  ],
  [
    "install/local/wikidot-verification/src/listpages-campaign-inventory.mjs",
    "48c24c4fd49e36ef35c3bf1930118e05c053484eadcce5ec49091135ccbeff7a",
  ],
  [
    "install/local/wikidot-verification/src/listpages-campaign-matrix.mjs",
    "58790422a782cb9d14b45533e89b4b163b757fd41eff01d9028d772509eb8d42",
  ],
]);
const EXPECTED_COLLECTOR_ARTIFACTS = Object.freeze([
  [
    "install/local/wikidot-verification/scripts/capture_wikidot_preview_references.py",
    "3734a71e06b026d881dcd9e415f0cb8dc1365d3599dea0f8717fcb1eb8516b11",
  ],
  [
    "install/local/wikidot-verification/requirements.txt",
    "45717e5351f7eb1c46431dd44bf15db9777dbbc4fa40026931bd2e6458b2fcc9",
  ],
  [
    "install/local/wikidot-verification/src/syntax-differential.mjs",
    "73d590888cffadb2032b3ebc090f8207c11187f575a4a806a2cec2cf07f67c2d",
  ],
]);
const EXPECTED_REFERENCE_SHA256 =
  "591a02b209dd156c25e7eab0e12a8a123eac5daf0d1fd99b8b5629ea3cb39792";

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
  readFile = fs.readFile,
}) {
  if (path.resolve(scopePath) !== LISTPAGES_CORPUS_REPLAY_SCOPE_PATH) {
    throw new Error(
      "authoritative replay requires the repository-pinned campaign scope",
    );
  }
  const scopeText = await readFile(scopePath, "utf8");
  const scope = JSON.parse(scopeText);
  if (
    sha256(scopeText) !== LISTPAGES_CORPUS_REPLAY_SCOPE_SHA256 ||
    scope?.schema !== LISTPAGES_CORPUS_REPLAY_SCOPE_SCHEMA ||
    scope.campaign_issue !== 968 ||
    JSON.stringify(scope.invocations) !== JSON.stringify(EXPECTED_INVOCATIONS) ||
    scope.replay_key_contract?.executable !== "source_sha256" ||
    scope.replay_key_contract?.literal !== "context_replay_source_sha256" ||
    scope.live_reference_contract?.required_replay_key_coverage !==
      "exactly-once" ||
    scope.live_reference_contract?.sha256 !== EXPECTED_REFERENCE_SHA256 ||
    scope.live_reference_contract?.row_count !==
      EXPECTED_INVOCATIONS.unique_replay_key_count ||
    scope.completion_contract?.authoritative_only !== true
  ) {
    throw new Error("ListPages campaign scope contract is invalid");
  }
  const expected = EXPECTED_INVOCATIONS;
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
  for (const [kind, actual, expectedArtifacts] of [
    ["source", scope.source_artifacts, EXPECTED_SOURCE_ARTIFACTS],
    ["collector", scope.collector_artifacts, EXPECTED_COLLECTOR_ARTIFACTS],
  ]) {
    if (
      !Array.isArray(actual) ||
      JSON.stringify(actual.map(({ path, sha256 }) => [path, sha256])) !==
        JSON.stringify(expectedArtifacts)
    ) {
      throw new Error(`campaign ${kind} artifact set is invalid`);
    }
    for (const artifact of actual) {
      if (
        typeof artifact.path !== "string" ||
        path.isAbsolute(artifact.path) ||
        artifact.path.includes("..")
      ) {
        throw new Error("campaign source artifact path is invalid");
      }
      const contents = await readFile(
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
