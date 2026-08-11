import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const artifactPath = new URL('../artifacts/pr1334-ftml-inline-core-syntax-source-attribution-20260810.json', import.meta.url);
const fixturePath = new URL('../fixtures/pr1334-ftml-inline-core-syntax-source-attribution.json', import.meta.url);
let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
} catch (error) {
  if (error?.code === 'ENOENT') throw new Error('artifact_missing: run bounded pinned-FTML inline-core source-attribution capture');
  throw error;
}
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const manifest = await readFile(new URL('../../../../deepwell/Cargo.toml', import.meta.url), 'utf8');
const lockfile = await readFile(new URL('../../../../deepwell/Cargo.lock', import.meta.url), 'utf8');
const inventory = JSON.parse(await readFile(new URL('../../../../docs/development/compatibility-surface-inventory.json', import.meta.url), 'utf8'));

const exactSurfaceIds = [
  'catalog-feature:syntax-block-formatting-elements',
  'catalog-feature:syntax-definition-lists',
  'catalog-feature:syntax-horizontal-rules',
  'catalog-feature:syntax-inline-formatting',
  'catalog-feature:syntax-literal-text',
  'catalog-feature:syntax-paragraphs-and-newline',
  'catalog-feature:syntax-table-of-contents',
  'catalog-feature:syntax-text-size',
  'catalog-feature:syntax-typography',
  'catalog-feature:syntax-universal-escaping',
];

test('exact identities, Cargo pins, and clean-checkout evidence', () => {
  assert.equal(artifact.schema, 'wikijump.pr1334.ftml_inline_core_syntax_attribution.v1');
  assert.equal(artifact.wikijump_base_commit, fixture.wikijump_base_commit);
  assert.equal(artifact.wikijump_base_tree, fixture.wikijump_base_tree);
  assert.equal(artifact.pinned_ftml_revision, fixture.ftml_revision);
  assert.equal(artifact.pinned_ftml_package_version, fixture.ftml_package_version);
  assert.match(artifact.pinned_ftml_git_tree, /^[0-9a-f]{40}$/);
  assert.equal(artifact.cargo_manifest_pin_witness.anchor_text.includes(fixture.ftml_revision), true);
  assert.equal(artifact.cargo_lock_pin_witness.anchor_text.includes(fixture.ftml_revision), true);
  assert.equal(manifest.split(artifact.cargo_manifest_pin_witness.anchor_text).length - 1, 1);
  assert.equal(lockfile.split(artifact.cargo_lock_pin_witness.anchor_text).length - 1, 1);
  assert.deepEqual(artifact.ftml_checkout_cleanliness.other_status_entries, []);
  if (artifact.ftml_checkout_cleanliness.allowed_cache_marker !== null) {
    assert.deepEqual(artifact.ftml_checkout_cleanliness.allowed_cache_marker, {
      path: '.cargo-ok', git_status: '?? .cargo-ok', file_type: 'regular_file', size_bytes: 0,
      exclusion_reason: 'Cargo cache checkout marker; not FTML source, test, or fixture content',
    });
  }
});

test('exact ordered inline-core denominator and reconciliation', () => {
  assert.deepEqual(fixture.surface_ids, exactSurfaceIds);
  assert.deepEqual(artifact.surface_ids, exactSurfaceIds);
  assert.deepEqual(artifact.surfaces.map(({ surface_id }) => surface_id), exactSurfaceIds);
  assert.equal(artifact.surfaces.length, 10);
  assert.deepEqual(artifact.blocked_surface_ids, []);
  assert.deepEqual(artifact.missing_witness_classes, []);
  assert.equal(artifact.disposition, 'complete');
  assert.equal(artifact.blocked_reason, null);
  const inventoryMatches = inventory.surfaces.filter(({ surface_id }) => exactSurfaceIds.includes(surface_id));
  assert.equal(inventoryMatches.length, 10);
  for (const declaration of fixture.surfaces) {
    const entry = inventoryMatches.find(({ surface_id }) => surface_id === declaration.surface_id);
    assert.ok(entry);
    assert.equal(entry.public_owner, 'docs/wikidot-specifications');
    assert.deepEqual(entry.public_reference, [declaration.specification]);
  }
});

test('source, public-test, fixture, and catalog evidence reconcile without hidden gaps', () => {
  for (const [index, record] of artifact.surfaces.entries()) {
    const declaration = fixture.surfaces[index];
    assert.equal(record.inventory_public_owner, 'docs/wikidot-specifications');
    assert.equal(record.source_owner, `Rokurolize/ftml@${fixture.ftml_revision}`);
    assert.equal(record.source_status, 'source_attributed');
    assert.equal(record.test_status, 'test_backed');
    assert.equal(record.fixture_status, 'fixture_backed');
    assert.deepEqual(record.gap_reasons, []);
    assert.ok(record.source_owner_witnesses.length >= 1);
    assert.ok(record.public_integration_test_witnesses.length >= 1);
    assert.ok(record.fixture_witnesses.length >= 1);
    assert.match(record.catalog_specification.sha256, /^[0-9a-f]{64}$/);
    assert.equal(record.catalog_specification.path, declaration.specification);
    assert.deepEqual(record.source_owner_witnesses.map(({ path }) => path), declaration.source_witnesses.map(({ path }) => path).sort());
    assert.deepEqual(record.public_integration_test_witnesses.map(({ path, test_name, test_target }) => ({ path, test_name, test_target })), declaration.public_test_witnesses.toSorted((left, right) => left.path.localeCompare(right.path) || left.test_name.localeCompare(right.test_name)));
    assert.deepEqual(record.fixture_witnesses.map(({ path }) => path), declaration.fixture_witnesses.toSorted());
    for (const witness of record.source_owner_witnesses) {
      assert.match(witness.path, /^src\//);
      assert.ok(witness.anchor_text.length > 0);
      assert.ok(witness.line_range.start <= witness.line_range.end);
      assert.match(witness.sha256, /^[0-9a-f]{64}$/);
    }
    for (const witness of record.public_integration_test_witnesses) {
      assert.match(witness.path, /^tests\/.*\.rs$/);
      assert.equal(witness.test_target, 'integration');
      assert.ok(witness.test_name.includes('::'));
      assert.match(witness.sha256, /^[0-9a-f]{64}$/);
    }
    for (const witness of record.fixture_witnesses) {
      assert.match(witness.path, /^test\//);
      assert.match(witness.sha256, /^[0-9a-f]{64}$/);
    }
    assert.equal(record.claim, 'pinned_source_existing_test_and_fixture_attribution_only');
  }
  assert.deepEqual(artifact.counts, {
    surface_count: 10, source_attributed: 10, test_backed: 10, test_gap: 0, fixture_backed: 10, fixture_gap: 0,
  });
});

test('artifact is source-only and contains no local paths or compatibility overclaim', () => {
  assert.equal(artifact.claim_scope, 'pinned_ftml_source_attribution_only');
  assert.equal(artifact.compatibility_verdict, 'not_evaluated');
  assert.equal(artifact.candidate_status, 'not_run');
  assert.equal(artifact.standing_status, 'not_run');
  assert.equal(artifact.wikijump_shim_added, false);
  assert.equal(artifact.ftml_pin_changed, false);
  assert.equal(artifact.network_requests, 0);
  assert.equal(artifact.mutations, 0);
  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /(?:\/home\/|\/mnt\/|[A-Za-z]:\\)/);
  assert.doesNotMatch(serialized, /(?:password|cookie|authorization|csrf|session_token)/i);
});
