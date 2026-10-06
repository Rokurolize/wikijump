import test from 'node:test';
import assert from 'node:assert/strict';
import {browserEnvironmentContractHashes,observationHasCurrentActionAndFixture} from '../src/current-browser-contracts.mjs';
import {createDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';

const backend=createDeepwellRuntimeIdentity({source_sha256:'b'.repeat(64),ftml_git_revision:'c'.repeat(40),container_id:'d'.repeat(64),image_id:`sha256:${'e'.repeat(64)}`,binary_sha256:'f'.repeat(64),config_sha256:'1'.repeat(64)});

const withBrowserVersion=contracts=>{
  contracts.browser_versions={chromium:'151.0',firefox:'155.0',webkit:'26.6'};
  contracts.target_site={slug:'fixture-site',origin:'https://fixture-site.wikijump.localhost:18443',locale:'ja'};
  contracts.expected_runtime_source_sha256='a'.repeat(64);
  contracts.expected_backend_runtime_identity=backend;
  return contracts;
};
const environment={target_site:'fixture-site',locale:'ja',transport_origin:'https://fixture-site.wikijump.localhost:3395',runtime_source_sha256:'a'.repeat(64),backend_runtime_identity:backend,backend_runtime_identity_sha256:backend.identity_sha256};

test('scoped actions and legacy broad actions require their respective exact current contract', () => {
  const contracts = withBrowserVersion(new Map([['page.normal.settled', {action_contract_sha256: 'action-only',
    legacy_action_contract_sha256: 'action-and-observer', fixture_contract_sha256: 'fixture'}]]));
  const row = {...environment,browser_engine:'chromium',browser_version:'151.0',session_state:'administrator',surface: 'page.normal', state: 'settled', fixture_contract_sha256: 'fixture', capture_state_action_contract_sha256: 'action-and-observer'};
  assert.equal(observationHasCurrentActionAndFixture(row, contracts), true);
  assert.equal(observationHasCurrentActionAndFixture({...row,runtime_source_sha256:'b'.repeat(64)},contracts),false);
  assert.equal(observationHasCurrentActionAndFixture({...row,backend_runtime_identity:{...backend,identity_sha256:'9'.repeat(64)}},contracts),false);
  assert.equal(observationHasCurrentActionAndFixture({...row, capture_state_action_contract_sha256: 'action-only'}, contracts), false);
  const scoped = {...row, capture_action_model: 'theme_lab_action_contract.v3', capture_state_action_contract_sha256: 'action-only'};
  assert.equal(observationHasCurrentActionAndFixture(scoped, contracts), true);
  assert.equal(observationHasCurrentActionAndFixture({...scoped, fixture_contract_sha256: 'old fixture'}, contracts), false);
  assert.equal(observationHasCurrentActionAndFixture({...scoped, capture_action_model: 'unknown'}, contracts), false);
});

test('an unrelated current action change cannot invalidate another state', () => {
  const contracts = withBrowserVersion(new Map([['page.normal.settled', {action_contract_sha256: 'normal', fixture_contract_sha256: 'fixture'}],
    ['shell.search.typed-focused', {action_contract_sha256: 'search', fixture_contract_sha256: 'fixture'}]]));
  const normal = {...environment,browser_engine:'chromium',browser_version:'151.0',session_state:'administrator',surface: 'page.normal', state: 'settled', capture_action_model: 'theme_lab_action_contract.v3',
    capture_state_action_contract_sha256: 'normal', fixture_contract_sha256: 'fixture'};
  contracts.get('shell.search.typed-focused').action_contract_sha256 = 'changed search';
  assert.equal(observationHasCurrentActionAndFixture(normal, contracts), true);
});

test('current browser observation requires the exact engine and browser version', () => {
  const contracts = new Map([['page.normal.settled', {action_contract_sha256: 'action',
    legacy_action_contract_sha256: 'action', legacy_action_contract_alternatives: ['action'], fixture_contract_sha256: 'fixture', guest: false}]]);
  contracts.browser_versions = {chromium:'151.0',firefox:'155.0',webkit:'26.6'};
  contracts.target_site={slug:'fixture-site',origin:'https://fixture-site.wikijump.localhost:18443',locale:'ja'};
  contracts.expected_runtime_source_sha256='a'.repeat(64);
  contracts.expected_backend_runtime_identity=backend;
  const row = {...environment,browser_engine: 'chromium', browser_version: '151.0', surface: 'page.normal', state: 'settled',
    capture_action_model: 'theme_lab_action_contract.v3', capture_state_action_contract_sha256: 'action', fixture_contract_sha256: 'fixture'};
  assert.equal(observationHasCurrentActionAndFixture({...row, session_state: 'administrator'}, contracts), true);
  assert.equal(observationHasCurrentActionAndFixture({...row, session_state: 'logged_out'}, contracts), true);
  assert.equal(observationHasCurrentActionAndFixture({...row, browser_version: '150.0'}, contracts), false);
  assert.equal(observationHasCurrentActionAndFixture({...row, browser_engine: 'firefox', browser_version:'155.0', session_state:'administrator'}, contracts), true);
  assert.equal(observationHasCurrentActionAndFixture({...row, browser_engine:'unknown',browser_version:'1.0',session_state:'administrator'},contracts),false);
  assert.equal(observationHasCurrentActionAndFixture({...row, session_state: 'unknown'}, contracts), false);
  assert.equal(observationHasCurrentActionAndFixture({...row, session_state: undefined}, contracts), false);
  contracts.get('page.normal.settled').guest = true;
  assert.equal(observationHasCurrentActionAndFixture({...row, session_state: 'logged_out'}, contracts), true);
  assert.equal(observationHasCurrentActionAndFixture({...row, session_state: 'administrator'}, contracts), false);
});

test('current browser observation is bound to the target site, locale, and logical transport host',()=>{
  const contracts=withBrowserVersion(new Map([['page.normal.settled',{action_contract_sha256:'action',fixture_contract_sha256:'fixture',guest:false}]]));
  const row={...environment,browser_engine:'chromium',browser_version:'151.0',session_state:'administrator',surface:'page.normal',state:'settled',capture_action_model:'theme_lab_action_contract.v3',capture_state_action_contract_sha256:'action',fixture_contract_sha256:'fixture'};
  assert.equal(observationHasCurrentActionAndFixture(row,contracts),true);
  assert.equal(observationHasCurrentActionAndFixture({...row,target_site:'other'},contracts),false);
  assert.equal(observationHasCurrentActionAndFixture({...row,locale:'en'},contracts),false);
  assert.equal(observationHasCurrentActionAndFixture({...row,transport_origin:'https://other.wikijump.localhost:3395'},contracts),false);
  assert.equal(observationHasCurrentActionAndFixture({...row,transport_origin:'http://fixture-site.wikijump.localhost:3395'},contracts),false);
});

test('environment hash binds the measured runtime source and rejects a different response identity',()=>{
  const contracts=withBrowserVersion(new Map([['page.normal.settled',{action_contract_sha256:'action',fixture_contract_sha256:'fixture'}]]));
  const runContract={target_site:contracts.target_site,baseline_theme:{name:'Sigma-9'},expected_runtime_source_sha256:'a'.repeat(64),
    expected_backend_runtime_identity:backend,
    viewports:{desktop:{width:1440,height:1000}},browser_engines:['chromium']};
  const row={...environment,browser_engine:'chromium',browser_version:'151.0',viewport:'desktop',viewport_size:{width:1440,height:1000},surface:'page.normal',state:'settled'};
  const hashes=browserEnvironmentContractHashes(row,contracts,runContract,'run-contract-sha',{assetDependencySha:'d'.repeat(64)});
  assert.equal(typeof hashes.scoped,'string');
  assert.equal(browserEnvironmentContractHashes({...row,runtime_source_sha256:'b'.repeat(64)},contracts,runContract,'run-contract-sha',{assetDependencySha:'d'.repeat(64)}),null);
  assert.equal(browserEnvironmentContractHashes({...row,backend_runtime_identity:{...backend,identity_sha256:'9'.repeat(64)}},contracts,runContract,'run-contract-sha',{assetDependencySha:'d'.repeat(64)}),null);
});
