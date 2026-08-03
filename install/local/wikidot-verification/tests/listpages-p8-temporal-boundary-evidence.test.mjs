import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactUrl = new URL(
  "../artifacts/listpages-p8-temporal-boundary-live-20260730.json",
  import.meta.url,
);

async function readArtifact() {
  return JSON.parse(await readFile(artifactUrl, "utf8"));
}

function outcomesBySize(records, size) {
  return new Set(
    records
      .filter((record) => record.template_body_bytes === size)
      .map((record) => record.success),
  );
}

test("ListPages P8 evidence proves a temporal boundary rather than a fixed byte cap", async () => {
  const artifact = await readArtifact();

  assert.equal(artifact.schema, "wikijump.wikidot_live_observation.v1");
  assert.equal(
    artifact.observation_id,
    "listpages-p8-temporal-boundary-live-20260730",
  );
  assert.deepEqual(artifact.feature_ids, ["module-listpages"]);
  assert.equal(artifact.property_axis, "P8");
  assert.equal(artifact.provenance.site, "www");
  assert.equal(artifact.provenance.authenticated, false);
  assert.equal(artifact.provenance.mutated, false);
  assert.deepEqual(
    artifact.provenance.source_artifacts.map(({ sha256 }) => sha256),
    [
      "efc8e5f242c6f88fb5993557ba7759bd28cea16a2b6ce9b46349a406603d5611",
      "1ec9b242a60f0abe3722a5bb1331a9677ec128012391bb09c1e33b1566c57d67",
      "b5c8a28d1e050b3f3113bfc2513dbaa92346b60219a11e53bd6e4672ce9ec69b",
    ],
  );
  assert.deepEqual(
    artifact.cases.map(({ case_id }) => case_id),
    [
      "listpages-p8-template-complete-success",
      "listpages-p8-template-same-size-mixed-outcome",
      "listpages-p8-template-gateway-timeout",
      "listpages-p8-module-count-through-2048",
      "listpages-p8-module-count-4096-timeout",
      "listpages-p8-atomic-failure",
    ],
  );

  assert.deepEqual(outcomesBySize(artifact.template_body_trials, 245760), new Set([true, false]));
  assert.deepEqual(outcomesBySize(artifact.template_body_trials, 249856), new Set([true, false]));
  assert.deepEqual(
    artifact.derived_observations.same_size_mixed_outcome_bytes,
    [245760, 249856],
  );
});

test("ListPages P8 evidence requires complete successes and non-partial 504 failures", async () => {
  const artifact = await readArtifact();
  const successfulTemplates = artifact.template_body_trials.filter(
    ({ success }) => success,
  );
  const failedTemplates = artifact.template_body_trials.filter(
    ({ success }) => !success,
  );
  const successfulModuleRuns = artifact.module_count_trials.filter(
    ({ success }) => success,
  );
  const failedModuleRuns = artifact.module_count_trials.filter(
    ({ success }) => !success,
  );

  assert.ok(successfulTemplates.length > 0);
  for (const record of successfulTemplates) {
    assert.equal(record.http_status, 200);
    assert.equal(record.wikidot_status, "ok");
    assert.equal(record.begin_count, 1);
    assert.equal(record.end_count, 1);
    assert.match(record.body_sha256, /^[0-9a-f]{64}$/u);
  }

  assert.ok(successfulModuleRuns.length > 0);
  for (const record of successfulModuleRuns) {
    assert.equal(record.http_status, 200);
    assert.equal(record.wikidot_status, "ok");
    assert.equal(record.matched_markers, record.module_count);
    assert.match(record.body_sha256, /^[0-9a-f]{64}$/u);
  }

  for (const record of [...failedTemplates, ...failedModuleRuns]) {
    assert.equal(record.exception_type, "AMCHttpStatusCodeException");
    assert.equal(record.exception_message, "AMC request failed: 504");
    assert.ok(record.elapsed_ms >= 27000 && record.elapsed_ms <= 30000);
    assert.equal(Object.hasOwn(record, "body_bytes"), false);
    assert.equal(Object.hasOwn(record, "body_sha256"), false);
    assert.equal(Object.hasOwn(record, "wikidot_status"), false);
  }
});

test("ListPages P8 evidence distinguishes live observations from local safety invariants", async () => {
  const artifact = await readArtifact();
  const moduleRuns = new Map(
    artifact.module_count_trials.map((record) => [record.module_count, record]),
  );

  assert.equal(moduleRuns.get(2048).success, true);
  assert.equal(moduleRuns.get(2048).matched_markers, 2048);
  assert.equal(moduleRuns.get(4096).success, false);
  assert.equal(
    artifact.derived_observations.largest_successful_module_count,
    2048,
  );
  assert.equal(artifact.derived_observations.timed_out_module_count, 4096);

  assert.deepEqual(artifact.wikijump_safety_invariants, {
    classification: "deterministic-safety-invariants-not-live-hard-limits",
    maximum_modules_per_render: 512,
    maximum_aggregate_module_source_bytes: 2097152,
    maximum_template_body_bytes: 262144,
    maximum_generated_output_bytes: 16777216,
    required_failure_property:
      "A rejected module must remain literal or fail through a controlled diagnostic without exposing partial generated output.",
  });
  assert.equal(artifact.verdict, "passed");
});
