import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const artifactPath = new URL('../artifacts/pr1334-ftml-structural-syntax-source-attribution-20260810.json', import.meta.url);
const fixturePath = new URL('../fixtures/pr1334-ftml-structural-syntax-source-attribution.json', import.meta.url);
let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
} catch (error) {
  if (error?.code === 'ENOENT') throw new Error('artifact_missing: run bounded pinned-FTML structural source-attribution capture');
  throw error;
}
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

function validateCheckoutStatusEvidence(value) {
  assert.deepEqual(value.other_status_entries, []);
  if (value.allowed_cache_marker !== null) {
    assert.deepEqual(value.allowed_cache_marker, {
      path: '.cargo-ok',
      git_status: '?? .cargo-ok',
      file_type: 'regular_file',
      size_bytes: 0,
      exclusion_reason: 'Cargo cache checkout marker; not FTML source, test, or fixture content',
    });
  }
}

test('Wikijump base, fixture, script, inventory, Cargo pin, and privacy identity', () => {
  assert.equal(artifact.schema, 'wikijump.pr1334.ftml_structural_syntax_attribution.v1');
  assert.equal(artifact.wikijump_base_commit, fixture.wikijump_base_commit);
  assert.match(artifact.fixture_identity.sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.script_identity.sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.inventory_identity.sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.cargo_manifest_pin_witness.sha256, /^[0-9a-f]{64}$/);
  assert.match(artifact.cargo_lock_pin_witness.sha256, /^[0-9a-f]{64}$/);
  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /(?:\/home\/|\/mnt\/|[A-Za-z]:\\)/);
  assert.doesNotMatch(serialized, /(?:password|cookie|authorization|csrf|session_token)/i);
  validateCheckoutStatusEvidence(artifact.ftml_checkout_cleanliness);
  const nonempty = structuredClone(artifact.ftml_checkout_cleanliness);
  nonempty.allowed_cache_marker.size_bytes = 1;
  assert.throws(() => validateCheckoutStatusEvidence(nonempty));
  const nested = structuredClone(artifact.ftml_checkout_cleanliness);
  nested.allowed_cache_marker.path = 'nested/.cargo-ok';
  nested.allowed_cache_marker.git_status = '?? nested/.cargo-ok';
  assert.throws(() => validateCheckoutStatusEvidence(nested));
  const additional = structuredClone(artifact.ftml_checkout_cleanliness);
  additional.other_status_entries = ['?? unexpected'];
  assert.throws(() => validateCheckoutStatusEvidence(additional));
});

test('exact ten-surface denominator and ownership', () => {
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.equal(artifact.surfaces.length, 10);
  assert.deepEqual(artifact.surfaces.map(({ surface_id }) => surface_id), fixture.surface_ids);
  for (const record of artifact.surfaces) {
    assert.equal(record.inventory_public_owner, 'docs/wikidot-specifications');
    assert.equal(record.source_owner, `Rokurolize/ftml@${fixture.ftml_revision}`);
    assert.match(record.catalog_specification.sha256, /^[0-9a-f]{64}$/);
  }
});

test('exact pinned FTML revision, tree, and version attribution', () => {
  assert.equal(artifact.pinned_ftml_revision, fixture.ftml_revision);
  assert.match(artifact.pinned_ftml_git_tree, /^[0-9a-f]{40}$/);
  assert.equal(artifact.pinned_ftml_package_version, fixture.ftml_package_version);
  assert.equal(artifact.cargo_manifest_pin_witness.anchor_text.includes(fixture.ftml_revision), true);
  assert.equal(artifact.cargo_lock_pin_witness.anchor_text.includes(fixture.ftml_revision), true);
});

test('source, public integration-test, and fixture witness minimums for every record', () => {
  for (const record of artifact.surfaces) {
    assert.ok(record.source_owner_witnesses.length >= 1);
    assert.ok(record.public_integration_test_witnesses.length >= 1);
    assert.ok(record.fixture_witnesses.length >= 1);
    for (const witness of record.source_owner_witnesses) {
      assert.match(witness.path, /^src\//);
      assert.ok(witness.line_range.start <= witness.line_range.end);
      assert.ok(witness.anchor_text.length > 0);
      assert.match(witness.sha256, /^[0-9a-f]{64}$/);
    }
    for (const witness of record.public_integration_test_witnesses) {
      assert.match(witness.path, /^tests\/.*\.rs$/);
      assert.ok(witness.test_name.length > 0);
      assert.match(witness.sha256, /^[0-9a-f]{64}$/);
    }
    for (const witness of record.fixture_witnesses) {
      assert.match(witness.path, /^test\//);
      assert.match(witness.sha256, /^[0-9a-f]{64}$/);
    }
  }
});

test('aggregate counts, zero shim or pin changes, and no compatibility overclaim', () => {
  assert.deepEqual({
    surface_count: artifact.counts.surface_count,
    catalog_specifications: artifact.counts.catalog_specifications,
    source_attributed: artifact.counts.source_attributed,
    public_test_backed: artifact.counts.public_test_backed,
    fixture_backed: artifact.counts.fixture_backed,
    records_without_source_witness: artifact.counts.records_without_source_witness,
    records_without_public_test_witness: artifact.counts.records_without_public_test_witness,
    records_without_fixture_witness: artifact.counts.records_without_fixture_witness,
    wikijump_shims_added: artifact.counts.wikijump_shims_added,
    ftml_pin_changes: artifact.counts.ftml_pin_changes,
    network_requests: artifact.counts.network_requests,
    mutations: artifact.counts.mutations,
  }, {
    surface_count: 10, catalog_specifications: 10, source_attributed: 10, public_test_backed: 10, fixture_backed: 10,
    records_without_source_witness: 0, records_without_public_test_witness: 0, records_without_fixture_witness: 0,
    wikijump_shims_added: 0, ftml_pin_changes: 0, network_requests: 0, mutations: 0,
  });
  assert.ok(artifact.counts.source_witness_references >= 10);
  assert.ok(artifact.counts.public_test_witness_references >= 10);
  assert.ok(artifact.counts.fixture_witness_references >= 10);
  assert.equal(artifact.claim_scope, 'pinned_ftml_source_and_public_test_attribution_only');
  assert.equal(artifact.compatibility_verdict, 'not_evaluated');
  assert.equal(artifact.candidate_status, 'not_run');
  assert.equal(artifact.standing_status, 'not_run');
  assert.equal(artifact.wikijump_shim_added, false);
  assert.equal(artifact.ftml_pin_changed, false);
  for (const record of artifact.surfaces) assert.equal(record.claim, 'pinned_source_public_test_and_fixture_attribution_only');
});
