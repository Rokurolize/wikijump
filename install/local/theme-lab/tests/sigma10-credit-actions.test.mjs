import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {openSigma10CreditOtherwise,openSigma10CreditView,returnSigma10CreditView,sigma10CreditActions} from '../src/sigma10-credit-actions.mjs';

test('Sigma-10 credit actions exercise native fold state instead of manufacturing hash state',()=>{
  assert.match(openSigma10CreditView.toString(),/\.rateBox\.unfolded/u);
  assert.match(openSigma10CreditOtherwise.toString(),/creditRateOtherwise > li\.unfolded/u);
  assert.match(returnSigma10CreditView.toString(),/creditRateOtherwise > li\.folded/u);
  for(const action of Object.values(sigma10CreditActions))assert.doesNotMatch(action.toString(),/location\.hash/u);
  assert.match(sigma10CreditActions['credit.close-back.restored'].toString(),/close\.focus\(\)[\s\S]*close\.press\('Enter'\)/u);
});

test('Sigma-10 credit action map covers every maintained saved-credit interaction state',()=>{
  assert.deepEqual(Object.keys(sigma10CreditActions).sort(),[
    'credit.close-back.restored',
    'credit.otherwise.back-control-click',
    'credit.otherwise.back-to-view',
    'credit.otherwise.open',
    'credit.otherwise.scrolled-bottom',
    'credit.view.open',
    'credit.view.scrolled-bottom',
  ]);
  const runner=fs.readFileSync(new URL('../ports/interactive-visual-fixture/capture-interactive.mjs',import.meta.url),'utf8');
  assert.match(runner,/if\(migrationFixture\)for\(const spec of states\).*sigma10CreditActions/u);
  assert.match(runner,/contract\.sigma10CreditActions=sigma10CreditActionsSha/u);
});
