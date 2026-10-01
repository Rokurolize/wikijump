import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner = fs.readFileSync(new URL('../ports/interactive-visual-fixture/capture-interactive.mjs', import.meta.url), 'utf8');

test('credit view scroll targets one visible modal when hidden modal markup is duplicated', () => {
  const action = runner.match(/\{surface:'credit\.view',state:'scrolled-bottom',[^\n]+/u)?.[0] ?? '';

  assert.match(action, /#u-credit-view \.modalbox:visible'\)\.last\(\)\.evaluate/u);
  assert.doesNotMatch(action, /#u-credit-view \.modalbox'\)\.evaluate/u);
});
