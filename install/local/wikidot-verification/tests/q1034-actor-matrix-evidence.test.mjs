import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactUrl = new URL(
  "../artifacts/q1034-actor-matrix-live-20260914.json",
  import.meta.url,
);

const ARTIFACT_SHA256 =
  "070cc26cdd232e5c6deb89357b97a14582cbb5f88ded78af78d8f1079cb39961";

async function readArtifact() {
  const bytes = await readFile(artifactUrl);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    ARTIFACT_SHA256,
    "retained Q1034 actor-matrix evidence must be byte-identical to the sealed capture summary",
  );
  return JSON.parse(bytes.toString("utf8"));
}

test("Q1034 actor and mutation matrix is sealed for live actors", async () => {
  const artifact = await readArtifact();

  assert.equal(artifact.schema, "wikijump.q1034_actor_matrix_live_observation.v1");
  assert.equal(artifact.site, "sandbox-for-codex");
  assert.equal(artifact.stages.create, "observed", "create");
  assert.equal(artifact.stages.edit, "observed", "edit");
  assert.equal(artifact.stages.delete, "observed", "delete");
  assert.equal(
    artifact.stages.concurrent,
    "observed (overlapping edit/read windows)",
    "concurrent",
  );
  assert.match(artifact.stages.restore, /closest terminal behavior/);
});

test("Q1034 gaps are the unobservable identity classes, not the live matrix", async () => {
  const artifact = await readArtifact();

  assert.ok(
    artifact.unobservable.some((row) => row.includes("imported-user")),
    "imported-user gap must be recorded",
  );
  assert.ok(
    artifact.unobservable.some((row) => row.includes("deleted-user")),
    "deleted-user gap must be recorded",
  );
});

test("Q1034 capture leaves no live state debt", async () => {
  const artifact = await readArtifact();

  assert.deepEqual(artifact.cleanup.terminal_thread_ids, [8290537, 8290538]);
  assert.equal(artifact.cleanup.live_state_debt, false);
  assert.equal(artifact.credentials_in_evidence, false);
});
