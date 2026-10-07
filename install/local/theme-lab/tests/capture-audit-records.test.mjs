import assert from 'node:assert/strict';
import test from 'node:test';
import {compactAuditRecord, compactSupersededRecord} from '../ports/scripts/capture-audit-records.mjs';

const baseRecord = overrides => ({
  theme: 'sigma10-baseline',
  browser_engine: 'chromium',
  viewport: 'mobile',
  surface: 'page.normal',
  state: 'settled',
  classification: 'UNCONFIRMED',
  reviewed_after_last_change: false,
  asset_dependencies: [],
  action_sequence: [],
  visual_diagnostics: {
    viewport: {width: 390, height: 844, document_width: 503, scroll_x: 0, scroll_y: 0},
    topFixedNavigationInset: 0,
    elements: {},
    historyInstances: [],
    titleOverlaps: [],
    headerText: [],
    headerChildren: []
  },
  ...overrides
});

test('compaction retains the horizontal-overflow detail when a state overflows', () => {
  const overflow = [
    {tag: 'DIV', id: 'main-content', class: 'content', rect: {x: 0, y: 0, width: 503, height: 100, right: 503, bottom: 100}, text: 'wide'},
    {tag: 'TABLE', id: '', class: '', rect: {x: 4, y: 0, width: 520, height: 40, right: 524, bottom: 40}, text: 'table'}
  ];
  const compact = compactAuditRecord(baseRecord({
    visual_diagnostics: {...baseRecord().visual_diagnostics, horizontalOverflow: overflow}
  }));
  assert.deepEqual(compact.visual_diagnostics.horizontal_overflow, overflow);
});

test('compaction omits horizontal-overflow detail for states that do not overflow', () => {
  for (const horizontalOverflow of [undefined, []]) {
    const compact = compactAuditRecord(baseRecord({
      visual_diagnostics: {...baseRecord().visual_diagnostics, horizontalOverflow}
    }));
    assert.equal('horizontal_overflow' in compact.visual_diagnostics, false);
  }
});

test('compaction still preserves the existing viewport and header diagnostics', () => {
  const compact = compactAuditRecord(baseRecord());
  assert.equal(compact.visual_diagnostics.viewport.documentWidth, 503);
  assert.deepEqual(compact.visual_diagnostics.header_text, []);
  assert.deepEqual(compact.visual_diagnostics.header_children, []);
  assert.equal(compact.asset_dependency_count, 0);
});

test('current and superseded SCP-JP captures retain local-only decision authority', () => {
  const current = compactAuditRecord(baseRecord({
    decision_authority: 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY',
    port_conclusion_eligible: false
  }));
  const superseded = compactSupersededRecord(baseRecord());
  for (const record of [current, superseded]) {
    assert.equal(record.decision_authority, 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY');
    assert.equal(record.port_conclusion_eligible, false);
  }
});

test('superseded history preserves the measured Deepwell identity for later risk comparison',()=>{
  const backend={schema:'wikijump_deepwell_runtime_identity.v1',source_sha256:'a'.repeat(64),ftml_git_revision:'b'.repeat(40),container_id:'c'.repeat(64),image_id:`sha256:${'d'.repeat(64)}`,binary_sha256:'e'.repeat(64),config_sha256:'f'.repeat(64),identity_sha256:'1'.repeat(64)};
  const superseded=compactSupersededRecord(baseRecord({backend_runtime_identity:backend,backend_runtime_identity_sha256:backend.identity_sha256,scoped_run_contract_sha256:'2'.repeat(64)}));
  assert.equal(superseded.backend_runtime_identity_sha256,backend.identity_sha256);
  assert.equal(superseded.backend_runtime_identity.container_id,backend.container_id);
  assert.equal(superseded.scoped_run_contract_sha256,'2'.repeat(64));
});
