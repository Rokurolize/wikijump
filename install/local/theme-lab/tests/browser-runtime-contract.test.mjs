import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeFilesForObservation} from '../src/browser-runtime-contract.mjs';

test('normal page identity includes the rendered header and authenticated login shell',()=>{
  for(const viewport of ['desktop','mobile']){
    const files=runtimeFilesForObservation('page.normal',viewport);
    assert.ok(files.includes('framerail/src/lib/sigma-esque/wikidot.svelte'));
    assert.ok(files.includes('framerail/src/routes/+layout.svelte'));
    assert.ok(files.includes('framerail/src/routes/[slug]/[...extra]/PageView.svelte'));
    assert.equal(new Set(files).size,files.length);
  }
});
