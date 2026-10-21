import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ingest,
  materialize,
  verify
} from '../src/evidence-store.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixtureTree(root) {
  fs.mkdirSync(path.join(root, 'nested', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'emptydir'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a.txt'), 'alpha\n');
  fs.writeFileSync(path.join(root, 'nested', 'b.bin'), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(root, 'nested', 'deep', 'c.txt'), 'alpha\n');
  fs.symlinkSync('a.txt', path.join(root, 'link-to-a'));
}

function freshDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-evidence-store-'));
  return { base, source: path.join(base, 'src'), store: path.join(base, 'store'), view: path.join(base, 'view') };
}

test('ingest dedups by content and writes a deterministic manifest', async () => {
  const { source, store } = freshDirs();
  fs.mkdirSync(source, { recursive: true });
  fixtureTree(source);
  const manifestPath = path.join(source, '..', 'manifest.json');

  const first = await ingest(source, manifestPath, store);
  assert.equal(first.files, 3);
  assert.equal(first.skippedSymlinks, 1);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(Object.keys(manifest.files), ['a.txt', 'nested/b.bin', 'nested/deep/c.txt']);
  assert.equal(manifest.files['a.txt'].sha256, manifest.files['nested/deep/c.txt'].sha256);
  assert.equal(manifest.files['a.txt'].sha256, sha('alpha\n'));

  const second = await ingest(source, manifestPath, store);
  assert.equal(second.newObjects, 0);
  const objects = [];
  for (const shard of fs.readdirSync(path.join(store, 'objects'))) {
    for (const name of fs.readdirSync(path.join(store, 'objects', shard))) objects.push(name);
  }
  assert.equal(objects.length, 2);
});

test('materialize rebuilds the tree as hardlinks with identical bytes', async () => {
  const { source, store, view } = freshDirs();
  fs.mkdirSync(source, { recursive: true });
  fixtureTree(source);
  const manifestPath = path.join(source, '..', 'manifest.json');
  await ingest(source, manifestPath, store);

  const summary = await materialize(manifestPath, view, store);
  assert.equal(summary.files, 3);
  assert.equal(summary.linked, 3);
  assert.equal(summary.copied, 0);
  assert.equal(fs.readFileSync(path.join(view, 'a.txt'), 'utf8'), 'alpha\n');
  assert.deepEqual(
    [...fs.readFileSync(path.join(view, 'nested', 'b.bin'))],
    [0, 1, 2, 3]
  );
  assert.ok(fs.existsSync(path.join(view, 'emptydir')));
  assert.equal(fs.statSync(path.join(view, 'a.txt')).ino, fs.statSync(path.join(view, 'nested', 'deep', 'c.txt')).ino);
  // Linked views must not retarget the shared store object's mode.
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const entry of Object.values(manifest.files)) {
    const objectPath = path.join(store, 'objects', entry.sha256.slice(0, 2), entry.sha256);
    assert.equal(fs.statSync(objectPath).mode & 0o777, 0o444);
  }
});

test('materialize rejects manifest paths that escape the destination', async () => {
  const { source, store, view } = freshDirs();
  fs.mkdirSync(source, { recursive: true });
  fixtureTree(source);
  const manifestPath = path.join(source, '..', 'manifest.json');
  await ingest(source, manifestPath, store);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files['../../escape.txt'] = manifest.files['a.txt'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  await assert.rejects(materialize(manifestPath, view, store), /escapes destination/);
  assert.ok(!fs.existsSync(path.join(view, '..', 'escape.txt')));
});

test('materialize refuses symlinked destination parents without changing outside files', async () => {
  const { base, source, store, view } = freshDirs();
  fs.mkdirSync(source, { recursive: true });
  fixtureTree(source);
  const manifestPath = path.join(base, 'manifest.json');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(view, { recursive: true });
  fs.writeFileSync(path.join(outside, 'escape.txt'), 'sentinel\n');

  await ingest(source, manifestPath, store);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files = { 'pivot/escape.txt': manifest.files['a.txt'] };
  manifest.dirs = ['pivot'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.symlinkSync(outside, path.join(view, 'pivot'), 'dir');

  await assert.rejects(materialize(manifestPath, view, store), /contains a symlink/);
  assert.equal(fs.readFileSync(path.join(outside, 'escape.txt'), 'utf8'), 'sentinel\n');
});

test('verify re-hashes objects and resolves manifests, failing closed', async () => {
  const { source, store, view } = freshDirs();
  fs.mkdirSync(source, { recursive: true });
  fixtureTree(source);
  const manifestPath = path.join(source, '..', 'manifest.json');
  await ingest(source, manifestPath, store);
  await materialize(manifestPath, view, store);

  const clean = await verify(store, manifestPath);
  assert.equal(clean.objects, 2);
  assert.equal(clean.manifestResolved, 3);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const victim = manifest.files['a.txt'].sha256;
  const victimPath = path.join(store, 'objects', victim.slice(0, 2), victim);
  fs.rmSync(victimPath);
  fs.writeFileSync(victimPath, 'tampered\n');
  await assert.rejects(verify(store, manifestPath), /hash mismatch/);
});
