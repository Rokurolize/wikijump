import test from 'node:test';
import assert from 'node:assert/strict';
import {observationHasCurrentActionAndFixture} from '../src/current-browser-contracts.mjs';

test('scoped actions and legacy broad actions require their respective exact current contract', () => {
  const contracts = new Map([['page.normal.settled', {action_contract_sha256: 'action-only',
    legacy_action_contract_sha256: 'action-and-observer', fixture_contract_sha256: 'fixture'}]]);
  const row = {surface: 'page.normal', state: 'settled', fixture_contract_sha256: 'fixture', capture_state_action_contract_sha256: 'action-and-observer'};
  assert.equal(observationHasCurrentActionAndFixture(row, contracts), true);
  assert.equal(observationHasCurrentActionAndFixture({...row, capture_state_action_contract_sha256: 'action-only'}, contracts), false);
  const scoped = {...row, capture_action_model: 'theme_lab_action_contract.v3', capture_state_action_contract_sha256: 'action-only'};
  assert.equal(observationHasCurrentActionAndFixture(scoped, contracts), true);
  assert.equal(observationHasCurrentActionAndFixture({...scoped, fixture_contract_sha256: 'old fixture'}, contracts), false);
  assert.equal(observationHasCurrentActionAndFixture({...scoped, capture_action_model: 'unknown'}, contracts), false);
});

test('an unrelated current action change cannot invalidate another state', () => {
  const contracts = new Map([['page.normal.settled', {action_contract_sha256: 'normal', fixture_contract_sha256: 'fixture'}],
    ['shell.search.typed-focused', {action_contract_sha256: 'search', fixture_contract_sha256: 'fixture'}]]);
  const normal = {surface: 'page.normal', state: 'settled', capture_action_model: 'theme_lab_action_contract.v3',
    capture_state_action_contract_sha256: 'normal', fixture_contract_sha256: 'fixture'};
  contracts.get('shell.search.typed-focused').action_contract_sha256 = 'changed search';
  assert.equal(observationHasCurrentActionAndFixture(normal, contracts), true);
});
