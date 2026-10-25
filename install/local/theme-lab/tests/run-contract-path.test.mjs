import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveManifestRelativePath, resolveRunContractPath} from '../src/run-contract-path.mjs';

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

test('run-contract paths reject an existing symlink that escapes Theme Lab', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-contract-path-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'run-contract-outside-'));
  try {
    const contractDir = path.join(root, 'campaign');
    await fs.mkdir(contractDir);
    await fs.writeFile(path.join(outside, 'outside.css'), 'outside');
    await fs.symlink(path.join(outside, 'outside.css'), path.join(contractDir, 'linked.css'));
    assert.throws(() => resolveRunContractPath(root, contractDir, 'linked.css'), /escapes Theme Lab through a symlink/u);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
    await fs.rm(outside, {recursive: true, force: true});
  }
});

// Sigma-10 layout: the identity manifest and its fixture files live in
// sigma10-migration/, while a task-owned contract lives in current-campaign/.
test('manifest-relative fixture files resolve from the manifest directory, not the contract directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-contract-manifest-path-'));
  try {
    const manifestDir = path.join(root, 'sigma10-migration');
    const contractDir = path.join(manifestDir, 'current-campaign');
    await fs.mkdir(path.join(manifestDir, 'fixtures'), {recursive: true});
    await fs.mkdir(contractDir, {recursive: true});
    await fs.writeFile(path.join(manifestDir, 'fixture-manifest.json'), '{}');
    await fs.writeFile(path.join(manifestDir, 'fixtures', 'run-owned-sigma10-main.wikidot.txt'), 'main');
    const manifestPath = path.join(manifestDir, 'fixture-manifest.json');
    const fixture = path.join(manifestDir, 'fixtures', 'run-owned-sigma10-main.wikidot.txt');

    // The identity manifest is named relative to the contract directory.
    assert.equal(resolveRunContractPath(root, contractDir, '../fixture-manifest.json'), manifestPath);
    // The fixture is named relative to the manifest. Resolving it from the contract directory misses the file.
    assert.equal(resolveManifestRelativePath(root, manifestPath, 'fixtures/run-owned-sigma10-main.wikidot.txt'), fixture);
    await assert.rejects(fs.access(path.join(contractDir, 'fixtures', 'run-owned-sigma10-main.wikidot.txt')));
    assert.notEqual(resolveRunContractPath(root, contractDir, 'fixtures/run-owned-sigma10-main.wikidot.txt'), fixture);
    // A manifest-relative path still cannot escape Theme Lab.
    assert.throws(() => resolveManifestRelativePath(root, manifestPath, '../../../outside.wikidot.txt'), /existing Theme Lab path/u);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
