import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const artifactUrl = new URL(
  "../artifacts/listpages-random-idle-cache-live-20260730.json",
  import.meta.url,
);

async function readArtifact() {
  return JSON.parse(await readFile(artifactUrl, "utf8"));
}

test("ListPages random live evidence preserves the sliding idle-cache proof", async () => {
  const artifact = await readArtifact();
  const window = artifact.same_key_sliding_idle_window;

  assert.equal(artifact.schema, "wikijump.wikidot_live_observation.v1");
  assert.equal(artifact.provenance.authenticated, false);
  assert.equal(artifact.provenance.mutated, false);
  assert.equal(artifact.verdict, "passed");
  assert.deepEqual(
    artifact.cases.map(({ case_id }) => case_id),
    [
      "listpages-random-sliding-idle-window",
      "listpages-random-module-body-key",
      "listpages-random-idle-expiration",
      "listpages-random-independent-pager-pages",
    ],
  );
  assert.equal(window.observed_unix_seconds.at(-1) - window.observed_unix_seconds[0], 165);
  assert.ok(window.span_seconds > 120);
  assert.ok(window.maximum_inter_observation_gap_seconds < 60);
  assert.equal(window.html_sha256.length, 64);
});

test("ListPages random live evidence binds body, idle expiry, and pager state", async () => {
  const artifact = await readArtifact();
  const bodyRows = artifact.module_body_is_part_of_key.requests.map(({ rows }) => rows.join("|"));

  assert.equal(new Set(bodyRows).size, bodyRows.length);
  assert.ok(artifact.idle_expiration.idle_seconds >= 60);
  for (const key of artifact.idle_expiration.keys) {
    assert.notDeepEqual(key.after, key.before, key.body_suffix);
  }
  assert.equal(artifact.pagination.request.page_parameter, "p");
  assert.equal(artifact.pagination.trials.length, 6);
  for (const trial of artifact.pagination.trials) {
    assert.ok(trial.overlap.length > 0, `trial ${trial.trial}`);
    assert.ok(trial.concat_unique < 20, `trial ${trial.trial}`);
  }
});
