import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_SIGMA10_RUN_CONTRACT,
  DEFAULT_SIGMA9_RUN_CONTRACT,
  auditMatchesRunContract,
  resolveRunContractOption,
} from '../src/current-run-contract-option.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-contract-option-'));
  fs.mkdirSync(path.join(root, 'ports/current-acceptance'), {recursive: true});
  fs.mkdirSync(path.join(root, 'sigma10-migration/current-campaign'), {recursive: true});
  return root;
}

test('the maintained shared contracts remain the default', () => {
  const root = fixtureRoot();
  assert.equal(resolveRunContractOption(root, undefined), DEFAULT_SIGMA9_RUN_CONTRACT);
  assert.equal(resolveRunContractOption(root, undefined, {generation: 'sigma10'}), DEFAULT_SIGMA10_RUN_CONTRACT);
});

test('a task-owned contract is accepted only inside its generation namespace and with the right schema', () => {
  const root = fixtureRoot();
  const sigma9 = path.join(root, 'ports/current-acceptance/run-contract-task-20261022.json');
  fs.writeFileSync(sigma9, JSON.stringify({schema: 'scp_jp_interactive_acceptance_run.v1'}));
  assert.equal(resolveRunContractOption(root, sigma9), 'ports/current-acceptance/run-contract-task-20261022.json');
  assert.throws(() => resolveRunContractOption(root, sigma9, {generation: 'sigma10'}), /task-owned/u);
  fs.writeFileSync(sigma9, JSON.stringify({schema: 'wrong'}));
  assert.throws(() => resolveRunContractOption(root, sigma9), /scp_jp_interactive_acceptance_run\.v1/u);

  const sigma10 = path.join(root, 'sigma10-migration/current-campaign/run-contract-task-20261022.json');
  fs.writeFileSync(sigma10, JSON.stringify({schema: 'scp_jp_sigma10_migration_run.v1'}));
  assert.equal(resolveRunContractOption(root, sigma10, {generation: 'sigma10'}),
    'sigma10-migration/current-campaign/run-contract-task-20261022.json');
  assert.throws(() => resolveRunContractOption(root, sigma10), /task-owned/u);
});

test('paths outside the Theme Lab tree and arbitrary filenames fail closed', () => {
  const root = fixtureRoot();
  assert.throws(() => resolveRunContractOption(root, '../outside.json'), /inside Theme Lab/u);
  assert.throws(() => resolveRunContractOption(root, path.join(root, 'ports/current-acceptance/other.json')), /task-owned/u);
  assert.throws(() => resolveRunContractOption(root, ''), /needs a path/u);
});

test('an alternate contract only applies to rows captured against exactly those bytes', () => {
  const contract = Buffer.from(JSON.stringify({schema: 'scp_jp_interactive_acceptance_run.v1'}));
  const current = sha(contract);
  assert.deepEqual(auditMatchesRunContract([{surface: 'page.normal', state: 'settled', run_contract_sha256: current}], contract), []);
  assert.deepEqual(auditMatchesRunContract([
    {surface: 'page.normal', state: 'settled', run_contract_sha256: current},
    {surface: 'page.edit', state: 'normal', run_contract_sha256: 'f'.repeat(64)},
  ], contract), ['audit row was not captured against the supplied run contract: page.edit.normal']);
});
