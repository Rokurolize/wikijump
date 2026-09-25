import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner = fs.readFileSync(new URL('../ports/interactive-visual-fixture/capture-interactive.mjs', import.meta.url), 'utf8');

test('rename and delete captures wait for settled pane controls and frame the pane', () => {
  const rename = runner.match(/\{surface:'page\.rename',[^\n]+/u)?.[0] ?? '';
  const deletion = runner.match(/\{surface:'page\.delete',[^\n]+/u)?.[0] ?? '';

  assert.match(rename, /#page-move/u);
  assert.match(rename, /\.buttons, \.page-move-actions/u);
  assert.match(rename, /revealBelowFixedMobileNavigation\(p,'\.page-move-header'\)/u);
  assert.doesNotMatch(rename, /revealPagePane\(p\)/u);

  assert.match(deletion, /#page-delete/u);
  assert.match(deletion, /\.buttons, \.page-delete-actions/u);
  assert.match(deletion, /revealBelowFixedMobileNavigation\(p,'\.page-delete-header'\)/u);
  assert.doesNotMatch(deletion, /revealPagePane\(p\)/u);
});
