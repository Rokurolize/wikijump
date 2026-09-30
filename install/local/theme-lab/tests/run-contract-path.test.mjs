import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveRunContractPath} from '../src/run-contract-path.mjs';

test('run-contract paths accept existing contract-relative and Theme Lab-root-relative artifacts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-contract-path-'));
  try {
    const contractDir = path.join(root, 'campaign');
    await fs.mkdir(contractDir);
    await fs.writeFile(path.join(contractDir, 'local.json'), '{}');
    await fs.mkdir(path.join(root, 'authority'));
    await fs.writeFile(path.join(root, 'authority', 'frozen.json'), '{}');
    assert.equal(resolveRunContractPath(root, contractDir, 'local.json'), path.join(contractDir, 'local.json'));
    assert.equal(resolveRunContractPath(root, contractDir, 'authority/frozen.json'), path.join(root, 'authority', 'frozen.json'));
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('run-contract paths reject missing and escaping artifacts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-contract-path-'));
  try {
    const contractDir = path.join(root, 'campaign');
    await fs.mkdir(contractDir);
    assert.throws(() => resolveRunContractPath(root, contractDir, '../../outside'), /existing Theme Lab path/u);
    assert.equal(resolveRunContractPath(root, contractDir, 'missing.json'), path.join(contractDir, 'missing.json'));
    assert.throws(() => resolveRunContractPath(root, contractDir, path.join(root, 'absolute')), /relative path/u);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
