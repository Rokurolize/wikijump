import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../ports/scripts/reconcile-interactive-audit.mjs',import.meta.url),'utf8');

test('audit reconciliation binds the exact per-state fixture contract',()=>{
  assert.match(source,/fixtureSha:spec\.fixture_contract_sha256/u);
  assert.match(source,/fixture_contract_sha256:spec\.fixture_contract_sha256/u);
  assert.doesNotMatch(source,/contracts\.fixture_contract_sha256/u);
});

test('audit reconciliation records every effective fixture URL',()=>{
  assert.match(source,/const fixtureUrls=\[\.\.\.new Set\(stateSpecs\.map/u);
  assert.match(source,/fixture_urls:fixtureUrls/u);
});
