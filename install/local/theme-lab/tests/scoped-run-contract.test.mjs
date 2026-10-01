import test from 'node:test';
import assert from 'node:assert/strict';
import {scopedRunContractSha, captureRunContractIsCurrent} from '../src/scoped-run-contract.mjs';
const contract = {network_policy: 'block before send', baseline_theme: {sha256: 'base'},
  additional_candidates: {a: {sha256: 'a'}, b: {sha256: 'b'}},
  current_candidate_inventory: [{package: 'a', sha256: 'a'}, {package: 'b', sha256: 'b'}],
  viewports: {desktop: {width: 1440}, mobile: {width: 390}}, browser_engines: ['chromium', 'firefox']};
const row = {theme: 'a', viewport: 'desktop', browser_engine: 'chromium'};
test('unrelated candidate and viewport changes do not invalidate an acceptance fact', () => {
  const changed = structuredClone(contract);
  changed.additional_candidates.b.sha256 = 'new';
  changed.current_candidate_inventory[1].sha256 = 'new';
  changed.viewports.mobile.width = 320;
  changed.audit_path = 'different-output.json';
  assert.equal(scopedRunContractSha(contract, row), scopedRunContractSha(changed, row));
});
test('own candidate, shared authority, network policy, engine eligibility and unknown dependencies fail closed', () => {
  for (const change of [c => c.additional_candidates.a.sha256 = 'new', c => c.baseline_theme.sha256 = 'new',
    c => c.network_policy = 'send', c => c.browser_engines = ['firefox'], c => c.future_dependency = 'new']) {
    const changed = structuredClone(contract); change(changed);
    assert.notEqual(scopedRunContractSha(contract, row), scopedRunContractSha(changed, row));
  }
});
test('legacy captures remain reusable only under their exact retained run contract', () => {
  assert.equal(captureRunContractIsCurrent({...row, run_contract_sha256: 'old'}, contract, 'new'), false);
  assert.equal(captureRunContractIsCurrent({...row, run_contract_sha256: 'old'}, contract, 'old'), true);
  assert.equal(captureRunContractIsCurrent({...row, scoped_run_contract_sha256: scopedRunContractSha(contract, row)}, contract, 'new'), true);
});

test('an exact retained legacy contract proves unrelated changes without inferring changed dependencies',()=>{
  const history=new Map([['old',contract]]),old={...row,run_contract_sha256:'old'};
  const changed=structuredClone(contract);changed.additional_candidates.b.sha256='new';
  assert.equal(captureRunContractIsCurrent(old,changed,'new',history),true);
  for(const mutate of [c=>c.additional_candidates.a.sha256='new',c=>c.baseline_theme.sha256='new',c=>c.future_dependency='new',c=>c.viewports.desktop.width=1000]){
    const actual=structuredClone(changed);mutate(actual);
    assert.equal(captureRunContractIsCurrent(old,actual,'new',history),false);
  }
  assert.equal(captureRunContractIsCurrent({...old,run_contract_sha256:'unretained'},changed,'new',history),false);
});
