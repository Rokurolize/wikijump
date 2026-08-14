import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { historicalSha256, historicalText } from './historical-git.mjs';

process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));

const artifactPath = 'install/local/wikidot-verification/artifacts/pr1334-deepwell-page-revision-jsonrpc-attribution-20260810.json';
const fixturePath = 'install/local/wikidot-verification/fixtures/pr1334-deepwell-page-revision-jsonrpc-attribution.json';
const scriptPath = 'install/local/wikidot-verification/scripts/capture_pr1334_deepwell_page_revision_jsonrpc_attribution.py';
const inventoryPath = 'docs/development/compatibility-surface-inventory.json';
const baseCommit = 'c78561b3f6dc35198658f618fc01d10e4bcad6d0';
const baseTree = '9f236023be41fd9c807272bbb16dd060b500b140';
const captureCommit = 'afa21954f81c3e1271ce8f77258aedfe00abf719';
const claim = 'registry_endpoint_owner_and_existing_test_attribution_only';
const missingSentinel = 'artifact_missing: run bounded Deepwell page revision JSON-RPC source-attribution capture';

if (!existsSync(artifactPath)) {
  process.stderr.write(`${missingSentinel}\n`);
  process.exit(1);
}

const expected = [
  ['deepwell-jsonrpc:page_create', 'page_create', 'page_create', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_get', 'page_get', 'page_get', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_get_deleted', 'page_get_deleted', 'page_get_deleted', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs'], ['PermissionService', 'deepwell/src/services/permission/service.rs']], 'test_gap'],
  ['deepwell-jsonrpc:page_get_direct', 'page_get_direct', 'page_get_direct', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_gap'],
  ['deepwell-jsonrpc:page_select', 'page_select', 'page_select', 'deepwell/src/endpoints/page.rs', [['PageQueryService', 'deepwell/src/services/page_query/service.rs']], 'test_gap'],
  ['deepwell-jsonrpc:page_edit', 'page_edit', 'page_edit', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_delete', 'page_delete', 'page_delete', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_move', 'page_move', 'page_move', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_gap'],
  ['deepwell-jsonrpc:page_restore', 'page_restore', 'page_restore', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_gap'],
  ['deepwell-jsonrpc:page_rollback', 'page_rollback', 'page_rollback', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_gap'],
  ['deepwell-jsonrpc:page_rerender', 'page_rerender', 'page_rerender', 'deepwell/src/endpoints/page.rs', [['MutationAuthorization', 'deepwell/src/services/mutation_authorization.rs'], ['PageRevisionService', 'deepwell/src/services/page_revision/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_set_layout', 'page_set_layout', 'page_set_layout', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_gap'],
  ['deepwell-jsonrpc:page_view', 'page_view', 'page_view', 'deepwell/src/endpoints/view.rs', [['ViewService', 'deepwell/src/services/view/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_view_permission', 'page_view_permission', 'page_view_permission', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs'], ['PermissionService', 'deepwell/src/services/permission/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_edit_permission', 'page_edit_permission', 'page_edit_permission', 'deepwell/src/endpoints/page.rs', [['PageService', 'deepwell/src/services/page/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_revision_create', 'page_revision_create', 'page_revision_edit', 'deepwell/src/endpoints/page_revision.rs', [['MutationAuthorization', 'deepwell/src/services/mutation_authorization.rs'], ['PageRevisionService', 'deepwell/src/services/page_revision/service.rs'], ['PageService', 'deepwell/src/services/page/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_revision_get', 'page_revision_get', 'page_revision_get', 'deepwell/src/endpoints/page_revision.rs', [['PageRevisionService', 'deepwell/src/services/page_revision/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_revision_get_by_id', 'page_revision_get_by_id', 'page_revision_get_by_id', 'deepwell/src/endpoints/page_revision.rs', [['PageRevisionService', 'deepwell/src/services/page_revision/service.rs']], 'test_gap'],
  ['deepwell-jsonrpc:page_revision_count', 'page_revision_count', 'page_revision_count', 'deepwell/src/endpoints/page_revision.rs', [['PageRevisionService', 'deepwell/src/services/page_revision/service.rs']], 'test_gap'],
  ['deepwell-jsonrpc:page_revision_diff', 'page_revision_diff', 'page_revision_diff', 'deepwell/src/endpoints/page_revision.rs', [['PageRevisionService', 'deepwell/src/services/page_revision/service.rs']], 'test_backed'],
  ['deepwell-jsonrpc:page_revision_range', 'page_revision_range', 'page_revision_range', 'deepwell/src/endpoints/page_revision.rs', [['PageRevisionService', 'deepwell/src/services/page_revision/service.rs']], 'test_gap'],
];

const artifactText = readFileSync(artifactPath, 'utf8');
const artifact = JSON.parse(artifactText);
const fixture = JSON.parse(historicalText(captureCommit, fixturePath));
const inventory = JSON.parse(historicalText(captureCommit, inventoryPath));
const sha256 = (path) => historicalSha256(captureCommit, path);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineNumber = (text, offset) => text.slice(0, offset).split('\n').length;

function blockRange(text, declarationPattern) {
  const matches = [...text.matchAll(declarationPattern)];
  assert.equal(matches.length, 1);
  const match = matches[0];
  const opening = text.indexOf('{', match.index + match[0].length);
  assert.notEqual(opening, -1);
  let depth = 0;
  for (let index = opening; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') depth -= 1;
    if (depth === 0) {
      return {
        lineRange: { start: lineNumber(text, match.index), end: lineNumber(text, index) },
        body: text.slice(match.index, index + 1),
      };
    }
  }
  assert.fail(`unterminated definition: ${declarationPattern}`);
}

test('base identity, bounded claim, and privacy are exact', () => {
  assert.equal(artifact.schema, 'wikijump.pr1334.deepwell_page_revision_jsonrpc_attribution.v1');
  assert.equal(artifact.base_commit, baseCommit);
  assert.equal(artifact.base_tree, baseTree);
  assert.equal(artifact.claim_scope, 'source_attribution_only');
  assert.equal(artifact.compatibility_verdict, 'not_evaluated');
  assert.equal(artifact.candidate_status, 'not_run');
  assert.equal(artifact.standing_status, 'not_run');
  assert.equal(artifact.disposition, 'attributed');
  assert.deepEqual(artifact.blocked_surface_ids, []);
  assert.equal(artifact.blocked_reason, '');
  assert.deepEqual(artifact.missing_witnesses, []);
  assert.deepEqual(artifact.observed_refs, []);
  assert.deepEqual(artifact.blockers, []);
  assert.equal(artifact.network_requests, 0);
  assert.equal(artifact.mutations, 0);
  assert.equal(artifact.private_output_retained, false);
  assert.deepEqual(artifact.identities.fixture, { path: fixturePath, sha256: sha256(fixturePath) });
  assert.deepEqual(artifact.identities.script, { path: scriptPath, sha256: sha256(scriptPath) });
  assert.deepEqual(artifact.identities.inventory, { path: inventoryPath, sha256: sha256(inventoryPath) });
  assert.doesNotMatch(artifactText, /(?:^|["\s])\/(?:home|Users|tmp)\//m);
  assert.doesNotMatch(artifactText, /\bBearer\s+[A-Za-z0-9._~-]+/i);
  assert.doesNotMatch(artifactText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const forbiddenKeys = /^(?:password|authorization|authorization_header|cookie|csrf|secret|session_token|environment|environment_dump|runtime_output|candidate_output|standing_output|browser_output)$/i;
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        assert.doesNotMatch(key, forbiddenKeys);
        visit(child);
      }
    }
  };
  visit(artifact);
});

test('exact ordered 21-ID denominator and count reconciliation', () => {
  const expectedIds = expected.map(([surfaceId]) => surfaceId);
  assert.deepEqual(fixture.surfaces.map(({ surface_id }) => surface_id), expectedIds);
  assert.deepEqual(artifact.surface_ids, expectedIds);
  assert.equal(new Set(artifact.surface_ids).size, 21);
  assert.equal(artifact.records.length, 21);
  assert.equal(artifact.counts.inventory_rows, 21);
  assert.equal(artifact.counts.registrations, 21);
  assert.equal(artifact.counts.endpoint_mappings, 21);
  assert.equal(artifact.counts.records, 21);
  assert.equal(artifact.counts.test_backed, 11);
  assert.equal(artifact.counts.test_gap, 10);
  assert.equal(artifact.counts.test_backed_plus_test_gap, 21);
  assert.equal(artifact.counts.network_requests, 0);
  assert.equal(artifact.counts.mutations, 0);
});

test('inventory references and unique registry declarations match repository source', () => {
  const registryPath = 'deepwell/src/api.rs';
  const registryText = historicalText(captureCommit, registryPath);
  const inventoryById = new Map(inventory.surfaces.map((row) => [row.surface_id, row]));
  const recordsById = new Map(artifact.records.map((record) => [record.surface_id, record]));
  assert.equal(recordsById.size, 21);
  for (const [surfaceId, registryName, endpointSymbol] of expected) {
    const record = recordsById.get(surfaceId);
    const row = inventoryById.get(surfaceId);
    assert.ok(record);
    assert.ok(row);
    assert.equal(row.kind, 'deepwell_jsonrpc_method');
    assert.equal(row.public_owner, 'deepwell');
    assert.deepEqual(row.public_reference, [`deepwell/src/api.rs#register:${registryName}`]);
    assert.equal(row.source.status, 'implemented');
    assert.equal(record.inventory_public_owner, row.public_owner);
    assert.deepEqual(record.inventory_public_reference, row.public_reference);
    assert.equal(record.inventory_source_status, row.source.status);
    const registrationPattern = new RegExp(`register!\\(\\s*"${escapeRegex(registryName)}"\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\);`, 'gs');
    const registrations = [...registryText.matchAll(registrationPattern)];
    assert.equal(registrations.length, 1);
    const registration = registrations[0];
    assert.equal(registration[1], endpointSymbol);
    assert.equal(record.registered_endpoint_symbol, endpointSymbol);
    assert.equal(record.registry.path, registryPath);
    assert.equal(record.registry.declaration, registration[0]);
    assert.equal(record.registry.sha256, sha256(registryPath));
    assert.deepEqual(record.registry.line_range, {
      start: lineNumber(registryText, registration.index),
      end: lineNumber(registryText, registration.index + registration[0].length - 1),
    });
  }
});

test('endpoint definitions and referenced service owners match repository source', () => {
  const recordsById = new Map(artifact.records.map((record) => [record.surface_id, record]));
  for (const [surfaceId, , endpointSymbol, endpointPath, expectedOwners] of expected) {
    const record = recordsById.get(surfaceId);
    const endpointText = historicalText(captureCommit, endpointPath);
    const definition = blockRange(endpointText, new RegExp(`^pub async fn ${escapeRegex(endpointSymbol)}\\s*\\(`, 'gm'));
    assert.equal(record.endpoint_definition.path, endpointPath);
    assert.equal(record.endpoint_definition.sha256, sha256(endpointPath));
    assert.deepEqual(record.endpoint_definition.line_range, definition.lineRange);
    assert.deepEqual(record.service_owners.map(({ symbol, path }) => [symbol, path]), expectedOwners);
    for (const [ownerSymbol, ownerPath] of expectedOwners) {
      assert.match(definition.body, new RegExp(`\\b${escapeRegex(ownerSymbol)}\\b`));
      const ownerText = historicalText(captureCommit, ownerPath);
      assert.match(ownerText, new RegExp(`pub struct ${escapeRegex(ownerSymbol)}\\b|impl ${escapeRegex(ownerSymbol)}\\b`));
      const owner = record.service_owners.find(({ symbol }) => symbol === ownerSymbol);
      assert.equal(owner.path, ownerPath);
      assert.equal(owner.sha256, sha256(ownerPath));
    }
  }
});

test('test attribution is exhaustive and makes no runtime or compatibility claim', () => {
  const fixtureById = new Map(fixture.surfaces.map((surface) => [surface.surface_id, surface]));
  const recordsById = new Map(artifact.records.map((record) => [record.surface_id, record]));
  for (const [surfaceId, , endpointSymbol, , , expectedStatus] of expected) {
    const fixtureSurface = fixtureById.get(surfaceId);
    const record = recordsById.get(surfaceId);
    assert.equal(record.test_status, expectedStatus);
    assert.equal(record.claim, claim);
    if (expectedStatus === 'test_gap') {
      assert.deepEqual(record.test_witnesses, []);
      assert.equal(record.gap_reason, `No allowed existing Deepwell integration test invokes ${endpointSymbol} through the endpoint seam.`);
      assert.equal(fixtureSurface.gap_reason, record.gap_reason);
      const invocation = new RegExp(`run_endpoint(?:_err)?!\\(\\s*[^,\\n]+\\s*,\\s*${escapeRegex(endpointSymbol)}\\b`);
      for (const path of fixture.allowed_read_only_paths.filter((value) => value.startsWith('deepwell/tests/'))) {
        assert.doesNotMatch(historicalText(captureCommit, path), invocation);
      }
      continue;
    }
    assert.equal(record.gap_reason, '');
    assert.ok(record.test_witnesses.length > 0);
    assert.equal(record.test_witnesses.length, fixtureSurface.test_witnesses.length);
    for (const witness of record.test_witnesses) {
      assert.equal(witness.seam, 'deepwell_endpoint_integration_test');
      const witnessText = historicalText(captureCommit, witness.path);
      const definition = blockRange(witnessText, new RegExp(`^async fn ${escapeRegex(witness.function)}\\s*\\(`, 'gm'));
      const invocation = new RegExp(`run_endpoint(?:_err)?!\\(\\s*[^,\\n]+\\s*,\\s*${escapeRegex(endpointSymbol)}\\b`);
      assert.match(definition.body, invocation);
      assert.deepEqual(witness.line_range, definition.lineRange);
      assert.equal(witness.sha256, sha256(witness.path));
    }
  }
  for (const input of artifact.source_inputs) {
    assert.ok(fixture.allowed_read_only_paths.includes(input.path));
    assert.equal(input.sha256, sha256(input.path));
  }
});
