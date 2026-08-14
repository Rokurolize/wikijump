import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { resolvePinnedFtmlCheckout } from '../src/pinned-ftml-checkout.mjs';
import { historicalSha256, historicalText } from './historical-git.mjs';

const artifactRelative = 'install/local/wikidot-verification/artifacts/pr1334-ftml-embed-conditional-source-attribution-20260810.json';
const artifactPath = new URL(`../artifacts/${artifactRelative.split('/').at(-1)}`, import.meta.url);
let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
} catch (error) {
  if (error?.code === 'ENOENT') throw new Error(`artifact_missing: ${artifactRelative}`);
  throw error;
}

const captureCommit = 'fa8e3f381e290caeff9e78bd8ab4468075e61469';
const fixture = JSON.parse(historicalText(captureCommit, 'install/local/wikidot-verification/fixtures/pr1334-ftml-embed-conditional-source-attribution.json'));
const ftmlRoot = resolvePinnedFtmlCheckout({ revision: fixture.ftml_revision, tree: fixture.ftml_tree });
const hex64 = /^[0-9a-f]{64}$/;

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function validateWitness(witness) {
  const isFtml = witness.repository === 'Rokurolize/ftml';
  const path = isFtml ? join(ftmlRoot, witness.path) : null;
  const text = isFtml ? await readFile(path, 'utf8') : historicalText(captureCommit, witness.path);
  assert.equal(text.split(witness.anchor_text).length - 1, 1);
  const line = text.slice(0, text.indexOf(witness.anchor_text)).split('\n').length;
  assert.deepEqual(witness.line_range, { start: line, end: line });
  assert.equal(witness.sha256, isFtml ? await sha256(path) : historicalSha256(captureCommit, witness.path));
}

test('exact identities, denominator, preconditions, and non-claim statuses', async () => {
  assert.equal(artifact.schema, 'wikijump.pr1334.ftml_embed_conditional_attribution.v1');
  assert.equal(artifact.wikijump_base_commit, fixture.wikijump_base_commit);
  assert.equal(artifact.pinned_ftml_revision, fixture.ftml_revision);
  assert.equal(artifact.pinned_ftml_git_tree, fixture.ftml_tree);
  assert.equal(artifact.pinned_ftml_package_version, fixture.ftml_package_version);
  assert.deepEqual(artifact.surface_ids, fixture.surface_ids);
  assert.deepEqual(artifact.surfaces.map(({ surface_id }) => surface_id), fixture.surface_ids);
  assert.equal(artifact.claim_scope, 'pinned_ftml_syntax_and_named_leaf_runtime_source_attribution_only');
  assert.equal(artifact.compatibility_verdict, 'not_evaluated');
  assert.equal(artifact.candidate_status, 'not_run');
  assert.equal(artifact.standing_status, 'not_run');
  assert.equal(artifact.closure_status, 'not_evaluated');
  assert.equal(artifact.global_ingestion_status, 'root_only_not_run');
  assert.equal(artifact.runtime_exhaustiveness, 'not_claimed');
  assert.equal(artifact.behavior_changed, false);
  assert.equal(artifact.ftml_pin_changed, false);
  assert.equal(artifact.wikijump_shim_added, false);
  assert.equal(artifact.network_requests, 0);
  assert.equal(artifact.mutations, 0);
  for (const identity of [artifact.inventory_identity, artifact.fixture_identity, artifact.script_identity, artifact.cargo_manifest_pin_witness, artifact.cargo_lock_pin_witness]) {
    assert.match(identity.sha256, hex64);
  }
  assert.equal(artifact.inventory_identity.sha256, historicalSha256(captureCommit, artifact.inventory_identity.path));
  assert.equal(artifact.fixture_identity.sha256, historicalSha256(captureCommit, 'install/local/wikidot-verification/fixtures/pr1334-ftml-embed-conditional-source-attribution.json'));
  assert.equal(artifact.script_identity.sha256, historicalSha256(captureCommit, artifact.script_identity.path));
});

test('each surface has bounded ownership, source, public test, fixture, and pending inventory evidence', async () => {
  const declarations = new Map(fixture.surfaces.map((surface) => [surface.surface_id, surface]));
  for (const record of artifact.surfaces) {
    const declaration = declarations.get(record.surface_id);
    assert.equal(record.ownership_class, declaration.ownership_class);
    assert.deepEqual(record.inventory_source_precondition, { status: 'pending', references: [] });
    assert.ok(record.source_owner_witnesses.some(({ repository, owner_role }) => repository === 'Rokurolize/ftml' && owner_role === 'syntax_parse_or_representation'));
    assert.ok(record.public_integration_test_witnesses.length >= 1);
    assert.ok(record.fixture_witnesses.length >= 1);
    if (record.ownership_class === 'split') {
      assert.ok(record.source_owner_witnesses.some(({ repository, owner_role }) => repository === 'Rokurolize/wikijump' && owner_role === 'runtime_resolution'));
    } else {
      assert.ok(record.source_owner_witnesses.every(({ owner_role }) => owner_role === 'syntax_parse_or_representation'));
    }
    for (const witness of record.source_owner_witnesses) await validateWitness(witness);
    for (const witness of record.public_integration_test_witnesses) {
      assert.equal(witness.repository, 'Rokurolize/ftml');
      assert.equal(witness.revision, fixture.ftml_revision);
      await validateWitness(witness);
    }
    for (const witness of record.fixture_witnesses) {
      assert.equal(witness.repository, 'Rokurolize/ftml');
      assert.equal(witness.revision, fixture.ftml_revision);
      assert.match(witness.path, /^test\/(?:embed|video|iframe|html|iftags|include)\//);
      assert.equal(witness.sha256, await sha256(join(ftmlRoot, witness.path)));
    }
  }
});

test('split ownership and deterministic counts reject exhaustive FTML claims', () => {
  const byId = new Map(artifact.surfaces.map((surface) => [surface.surface_id, surface]));
  assert.equal(byId.get('catalog-feature:syntax-iftags').ownership_class, 'split');
  assert.equal(byId.get('catalog-feature:syntax-include').ownership_class, 'split');
  assert.equal(artifact.runtime_exhaustiveness, 'not_claimed');
  assert.deepEqual(artifact.counts, {
    fixture_witness_references: 6,
    public_test_witness_references: 5,
    source_witness_references: 9,
    split_surfaces: 2,
    surface_count: 5,
    syntax_surfaces: 3
  });
  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /(?:\/home\/|\/mnt\/|[A-Za-z]:\\)/);
  assert.doesNotMatch(serialized, /(?:password|cookie|authorization|csrf|session_token)/i);
  assert.doesNotMatch(serialized, /(?:include|iftags).*exhaustive(?:ly)?[_ -]?ftml[_ -]?owned/i);
});
