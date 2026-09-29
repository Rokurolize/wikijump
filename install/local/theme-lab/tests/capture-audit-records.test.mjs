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
