import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../../../', import.meta.url)));

const artifactPath = 'install/local/wikidot-verification/artifacts/pr1334-join-membership-source-attribution-20260810.json';
const fixturePath = 'install/local/wikidot-verification/fixtures/pr1334-join-membership-source-attribution.json';
const scriptPath = 'install/local/wikidot-verification/scripts/capture_pr1334_join_membership_source_attribution.py';
const inventoryPath = 'docs/development/compatibility-surface-inventory.json';
const auditPath = 'docs/development/open43-a-actions-membership-closure-audit.json';
const expectedIds = [
  'catalog-feature:module-join',
  'catalog-feature:site-membership',
  'deepwell-jsonrpc:membership_join',
  'framerail-server-action:/?/membershipJoin',
  'framerail-server-action:/{slug}/{*extra}?/membershipJoin',
  'open43-audit-case:A1029_JOIN_RENDER_ARGUMENT_MATRIX',
  'open43-audit-case:A1029_SAVED_RENDERER_BINDING',
  'open43-audit-case:A1029_ACTOR_BOUND_OPEN_SELF_JOIN',
  'open43-audit-case:A1060_EDITABLE_SITE_PUBLIC_JOIN_ROUTE',
  'open43-audit-case:A1060_ORDINARY_MEMBER_PAGE_CREATE',
];
const expectedTestStatus = new Map([
  ['catalog-feature:module-join', 'test_backed'],
  ['catalog-feature:site-membership', 'test_backed'],
  ['deepwell-jsonrpc:membership_join', 'test_backed'],
  ['framerail-server-action:/?/membershipJoin', 'test_gap'],
  ['framerail-server-action:/{slug}/{*extra}?/membershipJoin', 'test_gap'],
  ['open43-audit-case:A1029_JOIN_RENDER_ARGUMENT_MATRIX', 'test_gap'],
  ['open43-audit-case:A1029_SAVED_RENDERER_BINDING', 'test_backed'],
  ['open43-audit-case:A1029_ACTOR_BOUND_OPEN_SELF_JOIN', 'test_backed'],
  ['open43-audit-case:A1060_EDITABLE_SITE_PUBLIC_JOIN_ROUTE', 'test_backed'],
  ['open43-audit-case:A1060_ORDINARY_MEMBER_PAGE_CREATE', 'test_backed'],
]);
const missingSentinel = 'artifact_missing: run bounded Join membership source-attribution capture';

if (!existsSync(artifactPath)) {
  process.stderr.write(`${missingSentinel}\n`);
  process.exit(1);
}

const artifactText = readFileSync(artifactPath, 'utf8');
const artifact = JSON.parse(artifactText);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
const read = (path) => readFileSync(path, 'utf8');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const count = (text, literal) => text.split(literal).length - 1;
const objectsWithKey = (value, key, output = []) => {
  if (Array.isArray(value)) value.forEach((child) => objectsWithKey(child, key, output));
  else if (value && typeof value === 'object') {
    if (Object.hasOwn(value, key)) output.push(value);
    Object.values(value).forEach((child) => objectsWithKey(child, key, output));
  }
  return output;
};

test('pinned identities, exact denominator, and privacy contract', () => {
  assert.equal(artifact.schema, 'wikijump.pr1334.join_membership_source_attribution.v1');
  assert.equal(artifact.base_commit, 'c78561b3f6dc35198658f618fc01d10e4bcad6d0');
  assert.equal(artifact.base_tree, '9f236023be41fd9c807272bbb16dd060b500b140');
  assert.deepEqual(artifact.surface_ids, expectedIds);
  assert.deepEqual(fixture.surfaces.map(({ surface_id }) => surface_id), expectedIds);
  assert.equal(new Set(artifact.surface_ids).size, 10);
  assert.equal(artifact.records.length, 10);
  for (const [key, path] of Object.entries({ fixture: fixturePath, script: scriptPath, inventory: inventoryPath, audit: auditPath })) {
    assert.deepEqual(artifact.identities[key], { path, sha256: sha256(path) });
  }
  assert.equal(artifact.network_requests, 0);
  assert.equal(artifact.mutations, 0);
  assert.equal(artifact.private_output_retained, false);
  assert.doesNotMatch(artifactText, /(?:^|["\s])\/(?:home|Users|tmp)\//m);
  assert.doesNotMatch(artifactText, /\bBearer\s+[A-Za-z0-9._~-]+/iu);
  assert.doesNotMatch(artifactText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
  const forbiddenKeys = /^(?:password|authorization|authorization_header|cookie|csrf|secret|token|environment|environment_dump|runtime_output|candidate_output|standing_output|browser_output)$/iu;
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

test('inventory and audit identities reconcile all 10 surfaces', () => {
  const inventoryById = new Map(inventory.surfaces.map((row) => [row.surface_id, row]));
  assert.equal(inventoryById.get(expectedIds[0]).public_owner, 'docs/wikidot-specifications');
  assert.deepEqual(inventoryById.get(expectedIds[0]).public_reference, ['docs/wikidot-specifications/specifications/module/module-join.md']);
  assert.equal(inventoryById.get(expectedIds[1]).public_owner, 'docs/wikidot-specifications');
  assert.deepEqual(inventoryById.get(expectedIds[1]).public_reference, ['docs/wikidot-specifications/specifications/platform/site-membership.md']);
  assert.equal(inventoryById.get(expectedIds[2]).public_owner, 'deepwell');
  assert.deepEqual(inventoryById.get(expectedIds[2]).public_reference, ['deepwell/src/api.rs#register:membership_join']);
  for (const id of expectedIds.slice(3, 5)) {
    assert.equal(inventoryById.get(id).public_owner, 'framerail');
    assert.ok(inventoryById.get(id).public_reference.includes('framerail/src/lib/server/load/page/page-actions.ts#action:membershipJoin'));
  }
  const auditById = new Map(objectsWithKey(audit, 'case_id').map((row) => [`open43-audit-case:${row.case_id}`, row]));
  assert.deepEqual(expectedIds.slice(5).map((id) => auditById.get(id).owner), ['deepwell', 'deepwell-and-framerail', 'deepwell', 'deepwell-seeder-and-view', 'deepwell']);
});

test('registry, endpoint, owner, renderer binding, and browser request are independently present', () => {
  const api = read('deepwell/src/api.rs');
  const endpoint = read('deepwell/src/endpoints/site_member.rs');
  const service = read('deepwell/src/services/membership/service.rs');
  const binding = read('deepwell/src/services/render/membership_actions.rs');
  const request = read('framerail/src/lib/wikidot/wikidot-membership-action-request.js');
  assert.equal(count(api, 'register!("membership_join", membership_join);'), 1);
  assert.match(endpoint, /pub async fn membership_join\([\s\S]*?MembershipService::join\(ctx, parse!\(params, SiteMembership\)\)\.await\n\}/u);
  assert.match(service, /pub struct MembershipService;[\s\S]*?pub async fn join\(/u);
  assert.match(service, /ctx\.request\(\)\.site_id\(\)[\s\S]*?MutationAuthorization::require_permission[\s\S]*?MembershipActionRegistry::from_wikidot_source[\s\S]*?RelationService::create_site_member/u);
  assert.match(binding, /rendered_count == self\.join_count[\s\S]*?fingerprint:\s*self[\s\S]*?\.fingerprint\(index\)/u);
  assert.match(binding, /self\.fingerprint\(index\)\.as_deref\(\) == Some\(fingerprint\)/u);
  assert.match(request, /runtime\.fetch\("\?\/membershipJoin"[\s\S]*?body:\s*JSON\.stringify\(\{\s*actionFingerprint:\s*input\.actionFingerprint,\s*actionIndex:\s*input\.actionIndex,\s*lastRevisionId:\s*input\.lastRevisionId,\s*pageId:\s*input\.pageId\s*\}\)/u);
});

test('both route identities resolve to one fixed bounded adapter', () => {
  const registry = read('framerail/src/lib/server/load/page/page-actions.ts');
  const adapter = read('framerail/src/lib/server/load/page/page-membership-actions.ts');
  const deepwellAdapter = read('framerail/src/lib/server/deepwell/membership.ts');
  assert.equal(count(registry, 'membershipJoin: membershipJoinAction,'), 1);
  assert.equal(count(adapter, 'export function membershipJoinAction(event: RequestEvent) {'), 1);
  assert.match(adapter, /const membershipJoinSchema = object\(\{\s*pageId: number\(\),\s*lastRevisionId: number\(\),\s*actionIndex:[\s\S]*?actionFingerprint: string\(\)\s*\}\)/u);
  assert.match(adapter, /return membershipJoin\(\s*pageId,\s*lastRevisionId,\s*actionIndex,\s*actionFingerprint,\s*context\.requestContext\s*\)/u);
  assert.equal(count(deepwellAdapter, '"membership_join"'), 1);
  const records = new Map(artifact.records.map((record) => [record.surface_id, record]));
  for (const id of expectedIds.slice(3, 5)) {
    assert.ok(records.get(id).source_witnesses.some(({ path, anchor }) => path.endsWith('page-actions.ts') && anchor === '  membershipJoin: membershipJoinAction,'));
  }
});

test('editable seed and ordinary-user integration witnesses remain exact', () => {
  const seed = read('deepwell/src/database/seeder/data.rs');
  const role = read('deepwell/tests/role.rs');
  assert.match(seed, /fn editable_site_seeds_the_public_self_join_route\(\)[\s\S]*?page\.slug == "system:join"[\s\S]*?assert_eq!\(join\.wikitext\.trim\(\), "\[\[module Join\]\]"\)/u);
  assert.match(role, /async fn ordinary_user_joins_only_the_editable_site_then_creates_a_page\(\)[\s\S]*?membership_join[\s\S]*?MembershipJoinOutcome::Joined[\s\S]*?page_create/u);
});

test('source and existing-test classification is exhaustive without promotion', () => {
  assert.equal(artifact.disposition, 'attributed');
  assert.deepEqual(artifact.blocked_surface_ids, []);
  assert.deepEqual(artifact.missing_witnesses, []);
  assert.equal(artifact.blocked_reason, '');
  assert.equal(artifact.claim_scope, 'source_attribution_only');
  assert.equal(artifact.compatibility_verdict, 'not_evaluated');
  assert.equal(artifact.candidate_status, 'not_run');
  assert.equal(artifact.standing_status, 'not_run');
  assert.deepEqual(artifact.promotions, { source: false, catalog: false, ledger: false, candidate: false, standing: false, closure: false });
  assert.deepEqual(artifact.counts, { surface_count: 10, source_present: 10, source_missing: 0, test_backed: 7, test_gap: 3 });
  for (const record of artifact.records) {
    assert.equal(record.source_status, 'source_present');
    assert.equal(record.test_status, expectedTestStatus.get(record.surface_id));
    assert.equal(record.claim, 'source_and_existing_test_attribution_only');
    assert.ok(record.source_witnesses.length > 0);
    if (record.test_status === 'test_gap') assert.ok(record.gap_reason.length > 0);
    else assert.equal(record.gap_reason, '');
    for (const witness of [...record.source_witnesses, ...record.test_witnesses]) {
      assert.equal(witness.source_present, true);
      assert.equal(witness.sha256, sha256(witness.path));
      assert.equal(count(read(witness.path), witness.anchor), 1);
      assert.equal(witness.line_range.start, witness.line_range.end);
    }
  }
  for (const input of artifact.source_inputs) assert.equal(input.sha256, sha256(input.path));
});
