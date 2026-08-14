import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { pinnedFtmlBytes } from '../src/pinned-ftml-checkout.mjs';
import { historicalBytes, historicalSha256 } from './historical-git.mjs';

const artifactRelative = 'install/local/wikidot-verification/artifacts/pr1334-ftml-lexical-text-source-attribution-20260810.json';
const artifactPath = new URL('../artifacts/pr1334-ftml-lexical-text-source-attribution-20260810.json', import.meta.url);
let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
} catch (error) {
  if (error?.code === 'ENOENT') throw new Error(`artifact_missing: ${artifactRelative}`);
  throw error;
}

const captureCommit = 'fa8e3f381e290caeff9e78bd8ab4468075e61469';
const fixture = JSON.parse(historicalBytes(captureCommit, 'install/local/wikidot-verification/fixtures/pr1334-ftml-lexical-text-source-attribution.json'));

async function validateWitness(repository, witness) {
  const bytes = repository === 'ftml'
    ? pinnedFtmlBytes({ revision: fixture.ftml_revision, tree: fixture.ftml_tree, sourcePath: witness.path })
    : historicalBytes(captureCommit, witness.path);
  assert.equal(witness.sha256, createHash('sha256').update(bytes).digest('hex'));
  const lines = bytes.toString('utf8').split(/\r?\n/);
  const matches = lines.flatMap((line, index) => line.includes(witness.anchor_text) ? [index + 1] : []);
  assert.deepEqual(matches, [witness.line_range.start]);
  assert.deepEqual(witness.line_range, { start: matches[0], end: matches[0] });
}

function visitStrings(value, callback) {
  if (typeof value === 'string') callback(value);
  else if (Array.isArray(value)) value.forEach((item) => visitStrings(item, callback));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
    assert.doesNotMatch(key, /(?:password|cookie|authorization|csrf|session_token)/i);
    visitStrings(item, callback);
  });
}

test('exact identities, denominator, inventory preconditions, and non-claim statuses', () => {
  assert.equal(artifact.schema, 'wikijump.pr1334.ftml_lexical_text_attribution.v1');
  assert.equal(artifact.wikijump_base_commit, fixture.wikijump_base_commit);
  assert.equal(artifact.pinned_ftml_revision, fixture.ftml_revision);
  assert.equal(artifact.pinned_ftml_git_tree, fixture.ftml_tree);
  assert.equal(artifact.pinned_ftml_package_version, fixture.ftml_package_version);
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.deepEqual(artifact.surfaces.map(({ surface_id }) => surface_id), fixture.surface_ids);
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
  for (const record of artifact.surfaces) {
    assert.deepEqual(record.inventory_source_precondition, { status: 'pending', references: [] });
    assert.equal(record.source_owner, `Rokurolize/ftml@${fixture.ftml_revision}`);
  }
  visitStrings(artifact, (value) => {
    assert.doesNotMatch(value, /(?:^|[\s"'])(?:\/home\/|\/mnt\/|[A-Za-z]:\\)/);
  });
});

test('complete-file hashes and unique anchors resolve for every witness', async () => {
  assert.equal(artifact.fixture_identity.sha256, historicalSha256(captureCommit, 'install/local/wikidot-verification/fixtures/pr1334-ftml-lexical-text-source-attribution.json'));
  assert.equal(artifact.script_identity.sha256, historicalSha256(captureCommit, artifact.script_identity.path));
  assert.equal(artifact.inventory_identity.sha256, historicalSha256(captureCommit, artifact.inventory_identity.path));
  await validateWitness('wikijump', artifact.cargo_manifest_pin_witness);
  await validateWitness('wikijump', artifact.cargo_lock_pin_witness);
  for (const record of artifact.surfaces) {
    await validateWitness('wikijump', record.catalog_specification);
    for (const witness of record.source_owner_witnesses) await validateWitness('ftml', witness);
    for (const witness of record.public_integration_test_witnesses) await validateWitness('ftml', witness);
    for (const witness of record.fixture_witnesses) await validateWitness('ftml', witness);
  }
});

test('all witness classes, bounded paths, and deterministic aggregate counts are exact', () => {
  let sourceReferences = 0;
  let testReferences = 0;
  let fixtureReferences = 0;
  for (const record of artifact.surfaces) {
    assert.ok(record.source_owner_witnesses.length >= 1);
    assert.ok(record.public_integration_test_witnesses.length >= 1);
    assert.ok(record.fixture_witnesses.length >= 1);
    for (const witness of record.source_owner_witnesses) assert.match(witness.path, /^src\/(?:parsing|preproc|render\/html|tree)\//);
    for (const witness of record.public_integration_test_witnesses) assert.match(witness.path, /^tests\/.*\.rs$/);
    for (const witness of record.fixture_witnesses) assert.match(witness.path, /^test\/(?:align|bold|center|color|definition-list|div|italics|line-breaks|misc|monospace|paragraph|raw|size|span|strikethrough|subscript|superscript|underline|underscore)\//);
    sourceReferences += record.source_owner_witnesses.length;
    testReferences += record.public_integration_test_witnesses.length;
    fixtureReferences += record.fixture_witnesses.length;
  }
  assert.deepEqual(artifact.counts, {
    catalog_specifications: 9,
    fixture_backed: 9,
    fixture_witness_references: fixtureReferences,
    ftml_pin_changes: 0,
    mutations: 0,
    network_requests: 0,
    public_test_backed: 9,
    public_test_witness_references: testReferences,
    records_without_fixture_witness: 0,
    records_without_public_test_witness: 0,
    records_without_source_witness: 0,
    source_attributed: 9,
    source_witness_references: sourceReferences,
    surface_count: 9,
    wikijump_shims_added: 0,
  });
});

test('checkout cleanliness and source attribution claim remain narrowly scoped', () => {
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
  for (const record of artifact.surfaces) assert.equal(record.claim, 'pinned_source_public_test_and_fixture_attribution_only');
});
