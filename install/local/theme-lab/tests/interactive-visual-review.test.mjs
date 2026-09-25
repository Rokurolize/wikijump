import test from 'node:test';
import assert from 'node:assert/strict';
import {applyVisualReviews} from '../ports/scripts/record-interactive-visual-review.mjs';

const hash = 'a'.repeat(64);
const identity = new Map([['site', {candidate_sha256:'css-current', candidate_source_sha256:'source-current'}]]);
const row = () => ({theme:'site', candidate_sha256:'css-current', candidate_source_sha256:'source-current', screenshot_sha256:hash, classification:'UNCONFIRMED', visual_findings:[], intentional_differences:[], unconfirmed_items:['pending'], reviewed_after_last_change:false});

test('records exact-image review for duplicate rows only when both candidate identities are current', () => {
  const rows = [row(), row()];
  const result = applyVisualReviews(rows, [{screenshot_sha256:hash, classification:'PASS_NATURAL', note:'Text, logo and mobile masthead remain separate and legible.'}], identity, '2026-09-25T00:00:00Z');
  assert.deepEqual(result, {updated_rows:2, unique_images:1});
  assert.equal(rows[0].reviewed_after_last_change, true);
  assert.equal(rows[0].visual_review.method, 'direct-image-vision-review');
  assert.deepEqual(rows[1].unconfirmed_items, []);
});

test('rejects stale screenshot evidence without partially promoting rows', () => {
  const rows = [row(), {...row(), candidate_source_sha256:'old-source'}];
  assert.throws(() => applyVisualReviews(rows, [{screenshot_sha256:hash, classification:'PASS_NATURAL', note:'Text and controls look readable in this screenshot.'}], identity), /stale candidate evidence/u);
  assert.equal(rows[0].classification, 'UNCONFIRMED');
});

test('requires a specific reason for intentional divergence and never accepts unconfirmed as review', () => {
  assert.throws(() => applyVisualReviews([row()], [{screenshot_sha256:hash, classification:'PASS_INTENTIONAL_DIVERGENCE', note:'Visual result reviewed directly.'}], identity), /needs its reason/u);
  assert.throws(() => applyVisualReviews([row()], [{screenshot_sha256:hash, classification:'UNCONFIRMED', note:'Still need to inspect the screenshot.'}], identity), /invalid visual classification/u);
});
