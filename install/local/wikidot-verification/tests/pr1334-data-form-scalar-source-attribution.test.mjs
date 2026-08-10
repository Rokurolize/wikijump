import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const artifactRelative = "install/local/wikidot-verification/artifacts/pr1334-data-form-scalar-source-attribution-20260810.json";
let artifact;
try {
  artifact = JSON.parse(await readFile(new URL(artifactRelative, root), "utf8"));
} catch (error) {
  if (error?.code === "ENOENT") throw new Error(`artifact_missing: ${artifactRelative}`);
  throw error;
}
const fixtureRelative = "install/local/wikidot-verification/fixtures/pr1334-data-form-scalar-source-attribution.json";
const fixture = JSON.parse(await readFile(new URL(fixtureRelative, root), "utf8"));
const sha256 = async (relative) => createHash("sha256").update(await readFile(new URL(relative, root))).digest("hex");

test("exact identities and ordered four-surface denominator", async () => {
  assert.equal(artifact.schema, "wikijump.pr1334.data_form_scalar_attribution.v1");
  assert.equal(artifact.wikijump_base_commit, fixture.wikijump_base_commit);
  assert.equal(artifact.wikijump_git_tree, fixture.wikijump_base_tree);
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.deepEqual(artifact.surfaces.map(({surface_id}) => surface_id), fixture.surface_ids);
  assert.equal(artifact.surfaces.length, 4);
  for (const [identity, relative] of [[artifact.inventory_identity, fixture.inventory_path], [artifact.fixture_identity, fixtureRelative], [artifact.script_identity, "install/local/wikidot-verification/scripts/capture_pr1334_data_form_scalar_attribution.py"]]) {
    assert.equal(identity.path, relative);
    assert.equal(identity.sha256, await sha256(relative));
  }
});

test("source last-touch, unchanged range, and inventory preconditions are exact", async () => {
  assert.deepEqual(artifact.source_identity.paths, [...fixture.source_paths, ...fixture.public_test_paths]);
  assert.equal(artifact.source_identity.last_touch.length, 7);
  for (const record of artifact.source_identity.last_touch) {
    assert.equal(record.commit, fixture.source_introduction_commit);
    assert.equal(record.matches_source_introduction_commit, true);
    assert.equal(record.diff_from_introduction_to_base, false);
    assert.equal(record.sha256, await sha256(record.path));
  }
  assert.deepEqual(artifact.inventory_preconditions.map(({surface_id}) => surface_id), fixture.surface_ids);
  for (const precondition of artifact.inventory_preconditions) {
    assert.equal(precondition.kind, "catalog_feature");
    assert.equal(precondition.source_status, "pending");
    assert.deepEqual(precondition.source_references, []);
  }
  assert.equal(artifact.rejected_adjacent_surface.surface_id, "catalog-feature:data-forms-tags");
  assert.equal(artifact.rejected_adjacent_surface.reason, "source_references_nonempty");
  assert.ok(artifact.rejected_adjacent_surface.source_references.length > 0);
  assert.deepEqual(artifact.source_attribution_artifact_scan.conflicting_target_ids, []);
  assert.equal(artifact.source_attribution_artifact_scan.tracked_artifact_paths.includes(artifactRelative), false);
  assert.deepEqual([...artifact.source_attribution_artifact_scan.tracked_artifact_paths].sort(), artifact.source_attribution_artifact_scan.tracked_artifact_paths);
});

test("each surface has complete source, public-test, specification, and provenance witnesses", async () => {
  for (const [record, declaration] of artifact.surfaces.map((record, index) => [record, fixture.surfaces[index]])) {
    assert.equal(record.specification.path, declaration.specification);
    assert.equal(record.specification.sha256, await sha256(declaration.specification));
    assert.ok(record.source_witnesses.length >= 1);
    assert.ok(record.public_test_witnesses.length >= 1);
    assert.equal(record.evidence_provenance_witnesses.length, fixture.evidence_chain_paths.length);
    assert.deepEqual(record.source_witnesses.map(({path, anchor_text}) => ({path, anchor_text})), declaration.source_witnesses);
    assert.deepEqual(record.public_test_witnesses.map(({path, anchor_text, test_name}) => ({path, anchor_text, test_name})), declaration.public_test_witnesses);
    for (const witness of [...record.source_witnesses, ...record.public_test_witnesses]) {
      assert.equal(witness.sha256, await sha256(witness.path));
      assert.ok(witness.anchor_text.length > 0);
      assert.deepEqual(witness.line_range, {start: witness.line_range.start, end: witness.line_range.start});
      const text = await readFile(new URL(witness.path, root), "utf8");
      assert.equal(text.split(witness.anchor_text).length - 1, 1);
    }
    assert.deepEqual(record.evidence_provenance_witnesses.map(({path}) => path), fixture.evidence_chain_paths);
    for (const witness of record.evidence_provenance_witnesses) {
      assert.equal(witness.sha256, await sha256(witness.path));
      const expectedKeys = witness.path.endsWith(".json") ? ["path", "schema", "sha256"] : ["path", "sha256"];
      assert.deepEqual(Object.keys(witness).sort(), expectedKeys.sort());
    }
  }
});

test("deterministic counts, privacy, and no behavior or closure overclaim", () => {
  assert.deepEqual(artifact.counts, {
    surface_count: 4,
    specification_witnesses: 4,
    source_witnesses: 4,
    public_test_witnesses: 4,
    evidence_provenance_witnesses: 16,
    missing_source_witnesses: 0,
    missing_public_test_witnesses: 0,
    network_requests: 0,
    mutations: 0
  });
  assert.equal(artifact.claim_scope, "current_wikijump_framerail_source_and_public_test_attribution_only");
  assert.equal(artifact.compatibility_verdict, "not_evaluated");
  assert.equal(artifact.candidate_status, "not_run");
  assert.equal(artifact.standing_status, "not_run");
  assert.equal(artifact.closure_status, "not_evaluated");
  assert.equal(artifact.global_ingestion_status, "root_only_not_run");
  assert.equal(artifact.behavior_changed, false);
  assert.equal(artifact.product_tests_run, false);
  assert.equal(artifact.network_requests, 0);
  assert.equal(artifact.mutations, 0);
  for (const record of artifact.surfaces) assert.equal(record.claim, "source_public_test_and_evidence_provenance_attribution_only");
  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /(?:\/home\/|\/mnt\/|[A-Za-z]:\\)/);
  assert.doesNotMatch(serialized, /(?:password|cookie|authorization|csrf|session_token)\s*[=:]/i);
  assert.doesNotMatch(serialized, /"(?:compatibility_verdict|candidate_status|standing_status|closure_status)":"(?:passed|compatible|implemented|complete|closed)"/);
});
