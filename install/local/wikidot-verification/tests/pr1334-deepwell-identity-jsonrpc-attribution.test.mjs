import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));

const artifactPath = 'install/local/wikidot-verification/artifacts/pr1334-deepwell-identity-jsonrpc-attribution-20260810.json';
const fixturePath = 'install/local/wikidot-verification/fixtures/pr1334-deepwell-identity-jsonrpc-attribution.json';
const scriptPath = 'install/local/wikidot-verification/scripts/capture_pr1334_deepwell_identity_jsonrpc_attribution.py';
const inventoryPath = 'docs/development/compatibility-surface-inventory.json';
const missingSentinel = 'artifact_missing: run bounded Deepwell identity JSON-RPC source-attribution capture';

if (!existsSync(artifactPath)) {
  process.stderr.write(`${missingSentinel}\n`);
  process.exit(1);
}

const artifactText = readFileSync(artifactPath, 'utf8');
const artifact = JSON.parse(artifactText);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const expectedIds = fixture.surfaces.map((surface) => surface.surface_id);

test('base, fixture, script, inventory identity, and privacy', () => {
  assert.equal(artifact.schema, 'wikijump.pr1334.deepwell_identity_jsonrpc_attribution.v1');
  assert.equal(artifact.identities.base_commit, 'f2b5769e1ff6206c31cc2b66a03675c64fba6318');
  for (const [key, path] of Object.entries({ fixture: fixturePath, script: scriptPath, inventory: inventoryPath })) {
    assert.deepEqual(artifact.identities[key], { path, sha256: sha256(path) });
  }
  assert.equal(artifact.network_requests, 0);
  assert.equal(artifact.mutations, 0);
  assert.equal(artifact.private_output_retained, false);
  assert.doesNotMatch(artifactText, /(?:^|["\s])\/(?:home|Users|tmp)\//m);
  assert.doesNotMatch(artifactText, /\bBearer\s+[A-Za-z0-9._~-]+/i);
  assert.doesNotMatch(artifactText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const forbiddenKeys = /^(?:password|authorization|authorization_header|cookie|csrf|secret|totp_seed|recovery_code|session_token|environment|environment_dump|runtime_output|candidate_output|standing_output|browser_output)$/i;
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        assert.doesNotMatch(key, forbiddenKeys);
        visit(child);
      }
    }
  };
  visit(artifact);
});

test('exact 19-ID denominator and category counts', () => {
  assert.deepEqual(artifact.surface_ids, expectedIds);
  assert.equal(new Set(artifact.surface_ids).size, 19);
  assert.equal(artifact.counts.surface_count, 19);
  assert.deepEqual(
    {
      authorization_token: artifact.counts.authorization_token_surfaces,
      email: artifact.counts.email_surfaces,
      login_logout: artifact.counts.login_logout_surfaces,
      mfa: artifact.counts.mfa_surfaces,
      session: artifact.counts.session_surfaces,
      user: artifact.counts.user_surfaces,
    },
    fixture.expected_category_counts,
  );
});

test('exact 19 registry declarations', () => {
  assert.equal(artifact.counts.registry_declarations, 19);
  assert.equal(artifact.records.length, 19);
  for (const record of artifact.records) {
    assert.equal(record.registry.path, 'deepwell/src/api.rs');
    assert.match(record.registry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(record.registry.line_range.start <= record.registry.line_range.end);
    assert.match(record.registered_endpoint_symbol, /^[a-z][a-z0-9_]*$/);
  }
});

test('exact 19 endpoint definitions and source owners', () => {
  assert.equal(artifact.counts.endpoint_definitions, 19);
  assert.equal(artifact.counts.source_gaps, 0);
  for (const record of artifact.records) {
    assert.equal(record.inventory_public_owner, 'deepwell');
    assert.equal(record.source_owner, 'deepwell');
    assert.match(record.endpoint_definition.path, /^deepwell\/src\/endpoints\/(?:auth|email|user|view)\.rs$/);
    assert.match(record.endpoint_definition.sha256, /^[0-9a-f]{64}$/);
    assert.ok(record.endpoint_definition.line_range.start <= record.endpoint_definition.line_range.end);
    assert.ok(record.service_owners.length > 0);
    for (const owner of record.service_owners) {
      assert.match(owner.path, /^deepwell\/src\/services\//);
      assert.match(owner.sha256, /^[0-9a-f]{64}$/);
      assert.match(owner.symbol, /^[A-Z][A-Za-z]+$/);
    }
  }
});

test('exhaustive existing-test/test-gap classification and no behavior overclaim', () => {
  assert.equal(artifact.claim_scope, 'source_attribution_only');
  assert.equal(artifact.compatibility_verdict, 'not_evaluated');
  assert.equal(artifact.candidate_status, 'not_run');
  assert.equal(artifact.standing_status, 'not_run');
  assert.equal(artifact.counts.test_backed, 16);
  assert.equal(artifact.counts.test_gap, 3);
  assert.equal(artifact.counts.test_backed + artifact.counts.test_gap, 19);
  assert.equal(artifact.counts.test_backed_plus_test_gap, 19);
  const recordsById = new Map(artifact.records.map((record) => [record.surface_id, record]));
  for (const expected of fixture.surfaces) {
    const record = recordsById.get(expected.surface_id);
    assert.ok(record);
    assert.equal(record.test_status, expected.test_witnesses.length > 0 ? 'test_backed' : 'test_gap');
    assert.equal(record.claim, 'registry_endpoint_and_existing_test_attribution_only');
    assert.ok(['test_backed', 'test_gap'].includes(record.test_status));
    if (record.test_status === 'test_backed') {
      assert.ok(record.test_witnesses.length > 0);
      assert.equal(record.gap_reason, '');
      for (const witness of record.test_witnesses) {
        assert.equal(witness.seam, 'deepwell_endpoint_integration_test');
        assert.match(witness.path, /^deepwell\/tests\/[a-z_]+\.rs$/);
        assert.ok(witness.line_range.start <= witness.line_range.end);
      }
    } else {
      assert.deepEqual(record.test_witnesses, []);
      assert.ok(record.gap_reason.length > 0);
    }
  }
});
