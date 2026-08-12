import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {gunzipSync} from "node:zlib";

const root = new URL("../../../../", import.meta.url);
const artifactRelative = "install/local/wikidot-verification/artifacts/pr1334-data-form-scalar-source-attribution-20260810.json";
const authorityRelative = "install/local/wikidot-verification/authority/pr1334-data-form-scalar-source-attribution-fa8e3f38.json.gz";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
let artifactBytes;
let artifact;
try {
  artifactBytes = await readFile(new URL(artifactRelative, root));
  artifact = JSON.parse(artifactBytes);
} catch (error) {
  if (error?.code === "ENOENT") throw new Error(`artifact_missing: ${artifactRelative}`);
  throw error;
}
const authorityArchive = await readFile(new URL(authorityRelative, root));
assert.equal(sha256(authorityArchive), "d9e9da9db47b2da26709ccfe0665761c3b021441d6cec74047ad55c3337e8982");
const authority = JSON.parse(gunzipSync(authorityArchive));
const fixtureRelative = "install/local/wikidot-verification/fixtures/pr1334-data-form-scalar-source-attribution.json";
const authorityBlob = (collection, relative) => {
  const encoded = collection[relative];
  assert.equal(typeof encoded, "string", `historical blob missing: ${relative}`);
  return Buffer.from(encoded, "base64");
};
const snapshotBlob = (relative) => authorityBlob(authority.snapshot_blobs, relative);
const snapshotSha256 = (relative) => sha256(snapshotBlob(relative));
const fixture = JSON.parse(snapshotBlob(fixtureRelative));
const historicalInventory = JSON.parse(snapshotBlob(fixture.inventory_path));
const snapshotPaths = [...new Set([
  artifact.inventory_identity.path,
  artifact.fixture_identity.path,
  artifact.script_identity.path,
  ...artifact.source_identity.paths,
  ...artifact.surfaces.map(({specification}) => specification.path),
  ...artifact.surfaces.flatMap(({evidence_provenance_witnesses}) => evidence_provenance_witnesses.map(({path}) => path)),
])].sort();

test("exact historical identities and ordered four-surface denominator", () => {
  assert.equal(authority.schema, "wikijump.pr1334.data_form_scalar_attribution_authority.v1");
  assert.equal(authority.artifact_path, artifactRelative);
  assert.equal(authority.artifact_sha256, sha256(artifactBytes));
  assert.equal(authority.snapshot_commit, "fa8e3f381e290caeff9e78bd8ab4468075e61469");
  assert.equal(authority.snapshot_tree, "8b889ed4899d6fdcffe299fa1dbae17af0404a00");
  assert.deepEqual(Object.keys(authority.snapshot_blobs).sort(), snapshotPaths);
  assert.equal(artifact.schema, "wikijump.pr1334.data_form_scalar_attribution.v1");
  assert.equal(artifact.wikijump_base_commit, fixture.wikijump_base_commit);
  assert.equal(artifact.wikijump_git_tree, fixture.wikijump_base_tree);
  assert.equal(authority.base_commit, artifact.wikijump_base_commit);
  assert.equal(authority.base_tree, artifact.wikijump_git_tree);
  assert.equal(authority.source_introduction_commit, artifact.source_introduction_commit);
  assert.deepEqual(Object.keys(authority.base_source_blobs).sort(), [...artifact.source_identity.paths].sort());
  assert.deepEqual(Object.keys(authority.source_introduction_blobs).sort(), [...artifact.source_identity.paths].sort());
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.deepEqual(artifact.surfaces.map(({surface_id}) => surface_id), fixture.surface_ids);
  assert.equal(artifact.surfaces.length, 4);
  assert.equal(artifact.inventory_identity.path, fixture.inventory_path);
  assert.equal(artifact.inventory_identity.sha256, snapshotSha256(fixture.inventory_path));
  assert.equal(artifact.fixture_identity.path, fixtureRelative);
  assert.equal(artifact.fixture_identity.sha256, snapshotSha256(fixtureRelative));
  const scriptRelative = "install/local/wikidot-verification/scripts/capture_pr1334_data_form_scalar_attribution.py";
  assert.equal(artifact.script_identity.path, scriptRelative);
  assert.equal(artifact.script_identity.sha256, snapshotSha256(scriptRelative));
});

test("source last-touch, unchanged range, and historical inventory preconditions are exact", () => {
  assert.deepEqual(artifact.source_identity.paths, [...fixture.source_paths, ...fixture.public_test_paths]);
  assert.equal(artifact.source_identity.last_touch.length, 7);
  for (const record of artifact.source_identity.last_touch) {
    assert.equal(record.commit, fixture.source_introduction_commit);
    assert.equal(record.matches_source_introduction_commit, true);
    assert.equal(record.diff_from_introduction_to_base, false);
    assert.equal(record.sha256, snapshotSha256(record.path));
    assert.deepEqual(
      authorityBlob(authority.base_source_blobs, record.path),
      authorityBlob(authority.source_introduction_blobs, record.path),
    );
  }
  assert.deepEqual(artifact.inventory_preconditions.map(({surface_id}) => surface_id), fixture.surface_ids);
  const inventoryById = new Map(historicalInventory.surfaces.map((row) => [row.surface_id, row]));
  for (const precondition of artifact.inventory_preconditions) {
    assert.equal(precondition.kind, "catalog_feature");
    assert.equal(precondition.source_status, "pending");
    assert.deepEqual(precondition.source_references, []);
    const row = inventoryById.get(precondition.surface_id);
    assert.ok(row, precondition.surface_id);
    assert.equal(row.kind, precondition.kind);
    assert.equal(row.source.status, precondition.source_status);
    assert.deepEqual(row.source.references, precondition.source_references);
  }
  assert.equal(artifact.rejected_adjacent_surface.surface_id, "catalog-feature:data-forms-tags");
  assert.equal(artifact.rejected_adjacent_surface.reason, "source_references_nonempty");
  assert.ok(artifact.rejected_adjacent_surface.source_references.length > 0);
  const rejectedRow = inventoryById.get(artifact.rejected_adjacent_surface.surface_id);
  assert.equal(rejectedRow.source.status, artifact.rejected_adjacent_surface.source_status);
  assert.deepEqual(rejectedRow.source.references, artifact.rejected_adjacent_surface.source_references);
  assert.deepEqual(artifact.source_attribution_artifact_scan.conflicting_target_ids, []);
  assert.equal(artifact.source_attribution_artifact_scan.tracked_artifact_paths.includes(artifactRelative), false);
  assert.deepEqual([...artifact.source_attribution_artifact_scan.tracked_artifact_paths].sort(), artifact.source_attribution_artifact_scan.tracked_artifact_paths);
});

test("each surface has complete pinned source, public-test, specification, and provenance witnesses", () => {
  for (const [record, declaration] of artifact.surfaces.map((record, index) => [record, fixture.surfaces[index]])) {
    assert.equal(record.specification.path, declaration.specification);
    assert.equal(record.specification.sha256, snapshotSha256(declaration.specification));
    assert.ok(record.source_witnesses.length >= 1);
    assert.ok(record.public_test_witnesses.length >= 1);
    assert.equal(record.evidence_provenance_witnesses.length, fixture.evidence_chain_paths.length);
    assert.deepEqual(record.source_witnesses.map(({path, anchor_text}) => ({path, anchor_text})), declaration.source_witnesses);
    assert.deepEqual(record.public_test_witnesses.map(({path, anchor_text, test_name}) => ({path, anchor_text, test_name})), declaration.public_test_witnesses);
    for (const witness of [...record.source_witnesses, ...record.public_test_witnesses]) {
      assert.equal(witness.sha256, snapshotSha256(witness.path));
      assert.ok(witness.anchor_text.length > 0);
      assert.deepEqual(witness.line_range, {start: witness.line_range.start, end: witness.line_range.start});
      const text = snapshotBlob(witness.path).toString("utf8");
      assert.equal(text.split(witness.anchor_text).length - 1, 1);
    }
    assert.deepEqual(record.evidence_provenance_witnesses.map(({path}) => path), fixture.evidence_chain_paths);
    for (const witness of record.evidence_provenance_witnesses) {
      assert.equal(witness.sha256, snapshotSha256(witness.path));
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
