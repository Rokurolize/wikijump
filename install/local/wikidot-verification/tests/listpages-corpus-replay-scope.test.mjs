import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import test from "node:test";

import {
  LISTPAGES_CORPUS_REPLAY_SCOPE_PATH,
  validateListPagesCorpusReplayScope,
  verifyExactListPagesSourceCommit,
} from "../src/listpages-corpus-replay-scope.mjs";

const INVOCATIONS = new URL(
  "../artifacts/listpages-campaign-matrix/corpus-invocation-cases.jsonl",
  import.meta.url,
);

test("historical ListPages reads reject a non-commit object identity", async () => {
  const repositoryRoot = new URL("../../../../", import.meta.url);
  const tree = execFileSync(
    "/usr/bin/git",
    ["-C", repositoryRoot.pathname, "rev-parse", "HEAD^{tree}"],
    { encoding: "utf8" },
  ).trim();
  await assert.rejects(
    verifyExactListPagesSourceCommit(tree),
    /must be an exact commit/u,
  );
});

test("repository campaign scope binds every current ListPages invocation and replay key", async () => {
  const invocationsText = await fs.readFile(INVOCATIONS, "utf8");
  const invocations = invocationsText
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const scope = await validateListPagesCorpusReplayScope({
    scopePath: LISTPAGES_CORPUS_REPLAY_SCOPE_PATH,
    invocationsText,
    invocations,
  });

  assert.equal(scope.invocation_count, 23964);
  assert.equal(scope.unique_replay_key_count, 18996);
  assert.match(scope.sha256, /^[0-9a-f]{64}$/u);

  await assert.rejects(
    validateListPagesCorpusReplayScope({
      scopePath: LISTPAGES_CORPUS_REPLAY_SCOPE_PATH,
      invocationsText: invocationsText
        .split(/\r?\n/u)
        .slice(0, -2)
        .join("\n"),
      invocations: invocations.slice(0, -1),
    }),
    /differs from the pinned campaign scope/,
  );

  const scopeText = await fs.readFile(
    LISTPAGES_CORPUS_REPLAY_SCOPE_PATH,
    "utf8",
  );
  const rewritten = JSON.parse(scopeText);
  rewritten.invocations.invocation_count -= 1;
  await assert.rejects(
    validateListPagesCorpusReplayScope({
      scopePath: LISTPAGES_CORPUS_REPLAY_SCOPE_PATH,
      invocationsText,
      invocations,
      readFile: async (filePath, encoding) =>
        filePath === LISTPAGES_CORPUS_REPLAY_SCOPE_PATH
          ? `${JSON.stringify(rewritten)}\n`
          : fs.readFile(filePath, encoding),
    }),
    /campaign scope contract is invalid/,
  );

  const missingArtifact = JSON.parse(scopeText);
  missingArtifact.collector_artifacts.pop();
  await assert.rejects(
    validateListPagesCorpusReplayScope({
      scopePath: LISTPAGES_CORPUS_REPLAY_SCOPE_PATH,
      invocationsText,
      invocations,
      readFile: async (filePath, encoding) =>
        filePath === LISTPAGES_CORPUS_REPLAY_SCOPE_PATH
          ? `${JSON.stringify(missingArtifact)}\n`
          : fs.readFile(filePath, encoding),
    }),
    /campaign scope contract is invalid/,
  );
});
