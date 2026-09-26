import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyExactVisualReviewReuseToRows,
  visualReviewRowKey
} from '../ports/scripts/visual-review-reuse.mjs';

const base = {
  theme: 'example',
  browser_engine: 'chromium',
  viewport: 'mobile',
  surface: 'page.history',
  state: 'list',
  screenshot: 'example.png',
  screenshot_sha256: 'a'.repeat(64),
  candidate_sha256: 'new-candidate',
  candidate_source_sha256: 'new-source',
  classification: 'UNCONFIRMED',
  reviewed_after_last_change: false,
  unconfirmed_items: ['screenshot captured but awaiting image review'],
  asset_failures: [],
  page_errors: [],
  external_requests_sent: 0
};

const prior = overrides => ({
  ...base,
  candidate_sha256: 'old-candidate',
  candidate_source_sha256: 'old-source',
  classification: 'PASS_NATURAL',
  reviewed_after_last_change: true,
  unconfirmed_items: [],
  visual_review: {
    method: 'direct-image-vision-review',
    reviewed_at: '2026-09-25T12:00:00.000Z',
    reviewer: 'Codex visual capability',
    screenshot_sha256: 'a'.repeat(64),
    note: 'Reviewed the exact screenshot bytes.'
  },
  ...overrides
});

test('exact-byte same-state review reuse preserves current provenance', () => {
  const row = {...base};
  const reused = applyExactVisualReviewReuseToRows([row], [prior()]);
  assert.equal(reused, 1);
  assert.equal(row.classification, 'PASS_NATURAL');
  assert.equal(row.reviewed_after_last_change, true);
  assert.deepEqual(row.unconfirmed_items, []);
  assert.equal(row.candidate_sha256, 'new-candidate');
  assert.equal(row.candidate_source_sha256, 'new-source');
  assert.deepEqual(row.visual_review_reuse, {
    reason: 'byte-identical',
    source_screenshot_sha256: 'a'.repeat(64),
    source_candidate_sha256: 'old-candidate',
    source_classification: 'PASS_NATURAL',
    source_reviewed_at: '2026-09-25T12:00:00.000Z',
    source_reviewer: 'Codex visual capability',
    source_review_method: 'direct-image-vision-review',
    source_review_screenshot_sha256: 'a'.repeat(64)
  });
  assert.equal(row.review_provenance.reviewed_at, '2026-09-25T12:00:00.000Z');
});

test('intentional-divergence reason is retained across exact-byte reuse', () => {
  const row = {...base};
  const source = prior({
    classification: 'PASS_INTENTIONAL_DIVERGENCE',
    intentional_differences: ['The localized chrome intentionally differs.'],
    visual_findings: ['Localized navigation is expected.']
  });
  assert.equal(applyExactVisualReviewReuseToRows([row], [source]), 1);
  assert.equal(row.classification, 'PASS_INTENTIONAL_DIVERGENCE');
  assert.deepEqual(row.intentional_differences, ['The localized chrome intentionally differs.']);
  assert.deepEqual(row.visual_findings, ['Localized navigation is expected.']);
});

test('same bytes from another state are not reused', () => {
  const row = {...base};
  const source = prior({state: 'diff'});
  assert.notEqual(visualReviewRowKey(row), visualReviewRowKey(source));
  assert.equal(applyExactVisualReviewReuseToRows([row], [source]), 0);
  assert.equal(row.classification, 'UNCONFIRMED');
});

test('changed screenshot bytes are not reused', () => {
  const row = {...base};
  assert.equal(
    applyExactVisualReviewReuseToRows([row], [prior({screenshot_sha256: 'b'.repeat(64)})]),
    0
  );
});

test('unreviewed prior evidence is not reused', () => {
  const row = {...base};
  assert.equal(
    applyExactVisualReviewReuseToRows([row], [prior({
      classification: 'UNCONFIRMED',
      reviewed_after_last_change: false
    })]),
    0
  );
});

test('current capture failures prevent visual reuse', () => {
  for (const patch of [
    {unconfirmed_items: ['action/capture failed: timeout']},
    {unconfirmed_items: ['screenshot predates a current candidate/runtime dependency; recapture needed']},
    {unconfirmed_items: []},
    {asset_failures: [{name: 'missing.png'}]},
    {page_errors: ['runtime error']},
    {external_requests_sent: 1}
  ]) {
    const row = {...base, ...patch};
    assert.equal(applyExactVisualReviewReuseToRows([row], [prior()]), 0);
    assert.equal(row.classification, 'UNCONFIRMED');
  }
});

test('a repeated NEEDS_FIX image keeps the actionable finding without overwriting provenance', () => {
  const row = {...base};
  const source = prior({
    classification: 'NEEDS_FIX',
    visual_findings: ['The History controls overlap.']
  });
  assert.equal(applyExactVisualReviewReuseToRows([row], [source]), 1);
  assert.equal(row.classification, 'NEEDS_FIX');
  assert.deepEqual(row.visual_findings, ['The History controls overlap.']);
  assert.equal(row.candidate_sha256, 'new-candidate');
});

test('source capture failures and missing review provenance prevent reuse', () => {
  for (const source of [
    prior({asset_failures: [{name: 'missing.png'}]}),
    prior({page_errors: ['runtime error']}),
    prior({external_requests_sent: 1}),
    prior({visual_review: undefined})
  ]) {
    const row = {...base};
    assert.equal(applyExactVisualReviewReuseToRows([row], [source]), 0);
    assert.equal(row.classification, 'UNCONFIRMED');
  }
});

test('legacy compact history without safety evidence fails closed', () => {
  const row = {...base};
  const source = prior({
    superseded_at: '2026-09-25T13:00:00.000Z',
    visual_review: undefined,
    review_provenance: {
      method: 'direct-image-vision-review',
      reviewed_at: '2026-09-25T12:00:00.000Z',
      reviewer: 'Codex visual capability',
      screenshot_sha256: 'a'.repeat(64),
      note: 'Reviewed the exact screenshot bytes.'
    },
    asset_failures: undefined,
    page_errors: undefined,
    external_requests_sent: undefined
  });
  assert.equal(applyExactVisualReviewReuseToRows([row], [source]), 0);
});

test('compact history with explicit clean capture evidence remains reusable even if old image is gone', () => {
  const row = {...base};
  const source = prior({
    superseded_at: '2026-09-25T13:00:00.000Z',
    screenshot: 'old-image-no-longer-present.png',
    visual_review: undefined,
    review_provenance: {
      method: 'direct-image-vision-review',
      reviewed_at: '2026-09-25T12:00:00.000Z',
      reviewer: 'Codex visual capability',
      screenshot_sha256: 'a'.repeat(64),
      note: 'Reviewed the exact screenshot bytes.'
    },
    asset_failures: undefined,
    page_errors: undefined,
    asset_failure_count: 0,
    page_error_count: 0,
    external_requests_sent: 0,
    historical_screenshot_valid: false,
    historical_screenshot_status: 'missing',
    failure: null
  });
  assert.equal(applyExactVisualReviewReuseToRows([row], [source]), 1);
  assert.equal(row.classification, 'PASS_NATURAL');
});

test('historical hash mismatch is never reused even when the recorded review hash matches', () => {
  const row = {...base};
  const source = prior({
    superseded_at: '2026-09-25T13:00:00.000Z',
    visual_review: undefined,
    review_provenance: {
      method: 'direct-image-vision-review',
      reviewed_at: '2026-09-25T12:00:00.000Z',
      reviewer: 'Codex visual capability',
      screenshot_sha256: 'a'.repeat(64),
      note: 'Reviewed the exact screenshot bytes.'
    },
    asset_failures: undefined,
    page_errors: undefined,
    asset_failure_count: 0,
    page_error_count: 0,
    external_requests_sent: 0,
    historical_screenshot_valid: false,
    historical_screenshot_status: 'hash-mismatch',
    failure: null
  });
  assert.equal(applyExactVisualReviewReuseToRows([row], [source]), 0);
});

test('review provenance must be bound to the exact reviewed screenshot hash', () => {
  const row = {...base};
  const source = prior({
    visual_review: {
      method: 'direct-image-vision-review',
      reviewed_at: '2026-09-25T12:00:00.000Z',
      reviewer: 'Codex visual capability',
      screenshot_sha256: 'b'.repeat(64)
    }
  });
  assert.equal(applyExactVisualReviewReuseToRows([row], [source]), 0);
});

test('all logical identity components are required and isolated, including delimiter collisions', () => {
  for (const field of ['theme', 'browser_engine', 'viewport', 'surface', 'state']) {
    for (const value of [undefined, '', `other-${base[field]}`]) {
      assert.equal(applyExactVisualReviewReuseToRows([{...base, [field]: value}], [prior()]), 0);
    }
  }
  assert.notEqual(visualReviewRowKey({...base, theme: 'a|b', browser_engine: 'c'}),
    visualReviewRowKey({...base, theme: 'a', browser_engine: 'b|c'}));
});

test('unknown, malformed and contradictory safety evidence fails closed', () => {
  for (const patch of [
    {failure: 'timeout'}, {action_responses: [{status: 500}]},
    {action_responses: [{type: 'failure', status: 200}]}, {screenshot: null}, {screenshot_sha256: 'invalid'},
    {asset_failures: undefined}, {page_errors: undefined}, {external_requests_sent: undefined},
    {external_requests_sent: -1}, {external_requests_sent: '0'},
    {asset_failure_count: 1}, {page_error_count: 1}
  ]) assert.equal(applyExactVisualReviewReuseToRows([{...base, ...patch}], [prior()]), 0);
  for (const patch of [
    {asset_failure_count: 0, asset_failures: ['failed']},
    {page_error_count: 0, page_errors: ['failed']},
    {external_requests_sent: -1}, {external_requests_sent: '0'},
    {reviewed_after_last_change: 'true'}
  ]) assert.equal(applyExactVisualReviewReuseToRows([{...base}], [prior(patch)]), 0);
});

test('divergence and defect reviews require meaningful explanations', () => {
  for (const [classification, field] of [
    ['PASS_INTENTIONAL_DIVERGENCE', 'intentional_differences'], ['NEEDS_FIX', 'visual_findings']
  ]) for (const value of [undefined, [], [''], ['  '], 'not an array', [null]]) {
    assert.equal(applyExactVisualReviewReuseToRows([{...base}], [prior({classification, [field]: value})]), 0);
  }
});

test('reuse chains remain attributable and do not alias historical findings', () => {
  const first = {...base};
  const source = prior({classification: 'NEEDS_FIX', visual_findings: ['Overlapping controls']});
  assert.equal(applyExactVisualReviewReuseToRows([first], [source]), 1);
  const second = {...base};
  assert.equal(applyExactVisualReviewReuseToRows([second], [first]), 1);
  second.visual_findings.push('New finding');
  assert.deepEqual(source.visual_findings, ['Overlapping controls']);
  assert.deepEqual(first.visual_findings, ['Overlapping controls']);
  assert.equal(second.review_provenance.reviewer, source.visual_review.reviewer);
});

test('compacted history retains review evidence, reasons and safety across repeated captures', async () => {
  const {compactSupersededRecord} = await import('../ports/scripts/capture-audit-records.mjs');
  for (const patch of [
    {}, {classification: 'NEEDS_FIX', visual_findings: ['Controls overlap']},
    {classification: 'PASS_INTENTIONAL_DIVERGENCE', intentional_differences: ['Localized navigation']}
  ]) {
    const source = prior({...patch, superseded_at: '2026-09-26', historical_screenshot_status: 'missing'});
    const compact = JSON.parse(JSON.stringify(compactSupersededRecord(source)));
    const row = {...base};
    assert.equal(applyExactVisualReviewReuseToRows([row], [compact]), 1);
    assert.equal(row.classification, source.classification);
    const again = compactSupersededRecord({...row, superseded_at: '2026-09-27', historical_screenshot_status: 'valid'});
    assert.equal(applyExactVisualReviewReuseToRows([{...base}], [again]), 1);
  }
});

test('legacy reuse rows without attributable provenance fail closed', () => {
  const row = {...base};
  const legacy = prior({
    visual_review: undefined,
    visual_review_reuse: {
      reason: 'byte-identical',
      source_screenshot_sha256: 'a'.repeat(64),
      source_candidate_sha256: 'older-candidate',
      source_classification: 'PASS_NATURAL'
    }
  });
  assert.equal(applyExactVisualReviewReuseToRows([row], [legacy]), 0);
  assert.equal(row.classification, 'UNCONFIRMED');
});

test('malformed companion explanations are dropped instead of copied forward', () => {
  for (const [classification, field, companion] of [
    ['PASS_INTENTIONAL_DIVERGENCE', 'intentional_differences', 'visual_findings'],
    ['NEEDS_FIX', 'visual_findings', 'intentional_differences']
  ]) {
    const row = {...base};
    const source = prior({classification, [field]: ['Concrete reason'], [companion]: 'not-an-array'});
    assert.equal(applyExactVisualReviewReuseToRows([row], [source]), 1);
    assert.deepEqual(row[field], ['Concrete reason']);
    assert.deepEqual(row[companion], []);
  }
});

test('nonvisual reviews are ineligible and stale direct attribution cannot shadow reuse', () => {
  for(const method of ['geometry-only','',null]){
    const source=prior();source.visual_review.method=method;
    assert.equal(applyExactVisualReviewReuseToRows([{...base}],[source]),0);
  }
  const row={...base,visual_review:{method:'obsolete',screenshot_sha256:'b'.repeat(64)}};
  assert.equal(applyExactVisualReviewReuseToRows([row],[prior()]),1);
  assert.equal(row.visual_review,undefined);
  assert.equal(applyExactVisualReviewReuseToRows([{...base}],[row]),1);
});

test('compaction cannot turn contradictory failure counts into clean historical evidence',async()=>{
 const {compactSupersededRecord}=await import('../ports/scripts/capture-audit-records.mjs');
 for(const patch of [
  {asset_failure_count:0,asset_failures:['missing']}, {page_error_count:0,page_errors:['error']},
  {asset_failure_count:1,asset_failures:[]}, {page_error_count:'0',page_errors:[]}
 ]){
  const compact=compactSupersededRecord(prior({...patch,superseded_at:'2026-09-26',historical_screenshot_status:'valid'}));
  assert.equal(applyExactVisualReviewReuseToRows([{...base}],[compact]),0);
 }
});
