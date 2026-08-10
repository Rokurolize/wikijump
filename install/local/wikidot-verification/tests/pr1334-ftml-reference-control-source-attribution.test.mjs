import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const artifactRelative = 'install/local/wikidot-verification/artifacts/pr1334-ftml-reference-control-source-attribution-20260810.json';
const artifactPath = new URL('../artifacts/pr1334-ftml-reference-control-source-attribution-20260810.json', import.meta.url);
let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
} catch (error) {
  if (error?.code === 'ENOENT') throw new Error(`artifact_missing: ${artifactRelative}`);
  throw error;
}

const fixturePath = new URL('../fixtures/pr1334-ftml-reference-control-source-attribution.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ftml = path.join(homedir(), '.cargo/git/checkouts/ftml-a724b9bc9f2959c8/62ebba4');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function verifyWitness(root, witness) {
  assert.equal(path.isAbsolute(witness.path), false);
  const bytes = await readFile(path.join(root, witness.path));
  assert.equal(witness.sha256, sha256(bytes));
  assert.match(witness.sha256, /^[0-9a-f]{64}$/);
  const lines = bytes.toString('utf8').split(/\r?\n/);
  const matches = lines.flatMap((line, index) => line.includes(witness.anchor_text) ? [index + 1] : []);
  assert.deepEqual(matches, [witness.line_range.start]);
  assert.deepEqual(witness.line_range, { start: matches[0], end: matches[0] });
}

test('exact base, dependency identities, and deterministic provenance identities', async () => {
  assert.equal(artifact.schema, 'wikijump.pr1334.ftml_reference_control_attribution.v1');
  assert.equal(artifact.wikijump_base_commit, fixture.wikijump_base_commit);
  assert.equal(artifact.pinned_ftml_revision, fixture.ftml_revision);
  assert.equal(artifact.pinned_ftml_git_tree, fixture.ftml_git_tree);
  assert.equal(artifact.pinned_ftml_package_version, fixture.ftml_package_version);
  for (const witness of [artifact.inventory_identity, artifact.fixture_identity, artifact.script_identity, artifact.cargo_manifest_pin_witness, artifact.cargo_lock_pin_witness]) {
    await verifyWitness(repo, witness);
  }
  assert.equal(artifact.inventory_identity.schema, 'wikijump.compatibility_surface_inventory.v1');
  assert.equal(artifact.cargo_manifest_pin_witness.anchor_text.includes(fixture.ftml_revision), true);
  assert.equal(artifact.cargo_lock_pin_witness.anchor_text.includes(fixture.ftml_revision), true);
  assert.deepEqual(artifact.ftml_checkout_cleanliness.other_status_entries, []);
  if (artifact.ftml_checkout_cleanliness.allowed_cache_marker !== null) {
    assert.deepEqual(artifact.ftml_checkout_cleanliness.allowed_cache_marker, {
      exclusion_reason: 'Cargo cache checkout marker; not FTML source, test, or fixture content',
      file_type: 'regular_file',
      git_status: '?? .cargo-ok',
      path: '.cargo-ok',
      size_bytes: 0,
    });
  }
});

test('exact ordered six-surface denominator and pending-empty inventory precondition', () => {
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.equal(artifact.surfaces.length, 6);
  assert.deepEqual(artifact.surfaces.map(({ surface_id }) => surface_id), fixture.surface_ids);
  assert.deepEqual(artifact.surfaces.map(({ catalog_specification }) => catalog_specification.path), fixture.surfaces.map(({ specification }) => specification));
  for (const record of artifact.surfaces) {
    assert.deepEqual(record.inventory_source_precondition, { references: [], status: 'pending' });
    assert.equal(record.source_owner, `Rokurolize/ftml@${fixture.ftml_revision}`);
    assert.equal(record.claim, 'pinned_source_public_test_and_fixture_attribution_only');
  }
});

test('every surface has complete-file source, public-test, fixture, and specification witnesses', async () => {
  for (const record of artifact.surfaces) {
    assert.ok(record.source_owner_witnesses.length >= 1);
    assert.ok(record.public_integration_test_witnesses.length >= 1);
    assert.ok(record.fixture_witnesses.length >= 1);
    await verifyWitness(repo, record.catalog_specification);
    for (const witness of record.source_owner_witnesses) {
      assert.match(witness.path, /^(?:src\/parsing\/rule\/impls\/(?:block\/blocks\/(?:button|date|file|user)|anchor|email|link_single|link_triple|url)\.rs|src\/render\/html\/element\/(?:button|date|file|link|user)\.rs|src\/tree\/button\.rs)$/);
      await verifyWitness(ftml, witness);
    }
    for (const witness of record.public_integration_test_witnesses) {
      assert.match(witness.path, /^tests\/.*\.rs$/);
      assert.equal(witness.anchor_text, `fn ${witness.test_name}()`);
      await verifyWitness(ftml, witness);
    }
    for (const witness of record.fixture_witnesses) {
      assert.match(witness.path, /^(?:test\/(?:file|date|link|user)\/|tests\/fixtures\/)/);
      await verifyWitness(ftml, witness);
    }
  }
});

test('counts are exact and attribution makes no behavior or closure claim', () => {
  const sourceCount = artifact.surfaces.reduce((total, record) => total + record.source_owner_witnesses.length, 0);
  const testCount = artifact.surfaces.reduce((total, record) => total + record.public_integration_test_witnesses.length, 0);
  const fixtureCount = artifact.surfaces.reduce((total, record) => total + record.fixture_witnesses.length, 0);
  assert.deepEqual(artifact.counts, {
    catalog_specifications: 6,
    fixture_backed: 6,
    fixture_witness_references: fixtureCount,
    ftml_pin_changes: 0,
    mutations: 0,
    network_requests: 0,
    public_test_backed: 6,
    public_test_witness_references: testCount,
    records_without_fixture_witness: 0,
    records_without_public_test_witness: 0,
    records_without_source_witness: 0,
    source_attributed: 6,
    source_witness_references: sourceCount,
    surface_count: 6,
    wikijump_shims_added: 0,
  });
  assert.equal(artifact.claim_scope, 'pinned_ftml_source_and_public_test_attribution_only');
  assert.equal(artifact.compatibility_verdict, 'not_evaluated');
  assert.equal(artifact.candidate_status, 'not_run');
  assert.equal(artifact.standing_status, 'not_run');
  assert.equal(artifact.closure_status, 'not_evaluated');
  assert.equal(artifact.global_ingestion_status, 'root_only_not_run');
  assert.equal(artifact.behavior_changed, false);
  assert.equal(artifact.ftml_pin_changed, false);
  assert.equal(artifact.wikijump_shim_added, false);
  assert.equal(artifact.network_requests, 0);
  assert.equal(artifact.mutations, 0);
});

test('artifact contains no absolute local path or secret-shaped field', () => {
  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /(?:\/home\/|\/mnt\/|[A-Za-z]:\\)/);
  assert.doesNotMatch(serialized, /(?:password|cookie|authorization|csrf|session_token)/i);
});
