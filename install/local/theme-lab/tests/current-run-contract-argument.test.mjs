import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditMatchesRunContract,
  resolveRunContractOption,
  runContractArgument,
} from '../src/current-run-contract-option.mjs';

test('the run-contract option is read from both argv spellings and fails closed on bare, empty or repeated flags', () => {
  assert.equal(runContractArgument(['--package', 'basalt']), null);
  assert.equal(runContractArgument(['--run-contract=ports/current-acceptance/run-contract-a1.json']), 'ports/current-acceptance/run-contract-a1.json');
  assert.equal(runContractArgument(['--run-contract', 'ports/current-acceptance/run-contract-a1.json']), 'ports/current-acceptance/run-contract-a1.json');
  assert.throws(() => runContractArgument(['--run-contract']), /needs a path/u);
  assert.throws(() => runContractArgument(['--run-contract=']), /needs a path/u);
  assert.throws(() => runContractArgument(['--run-contract', '--generation']), /needs a path/u);
  assert.throws(() => runContractArgument(['--run-contract=a.json', '--run-contract=b.json']), /only once/u);
});

test('a missing explicit contract is rejected rather than replaced by the shared contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-contract-argument-'));
  try {
    fs.mkdirSync(path.join(root, 'ports/current-acceptance'), {recursive: true});
    assert.throws(() => resolveRunContractOption(root, 'ports/current-acceptance/run-contract-absent-check.json'), /ENOENT|Task-owned run contract|no such file/iu);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('an audit with no rows cannot vacuously prove that it was captured against a contract', () => {
  const contract = Buffer.from('{"schema":"scp_jp_interactive_acceptance_run.v1"}');
  assert.deepEqual(auditMatchesRunContract([], contract), ['audit has no rows bound to the supplied run contract']);
  assert.deepEqual(auditMatchesRunContract(undefined, contract), ['audit has no rows bound to the supplied run contract']);
});
